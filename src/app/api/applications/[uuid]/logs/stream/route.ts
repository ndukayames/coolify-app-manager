import { NextResponse } from "next/server";
import { buildAppLogQuery } from "@/lib/app-logs";
import { requireTenantSession } from "@/lib/auth";
import { subscribeTail } from "@/lib/log-tail";
import { requireOwnedApp } from "@/lib/ownership";

type RouteContext = { params: Promise<{ uuid: string }> };

export const dynamic = "force-dynamic";

// Server-Sent Events: each event carries a batch of new log lines, oldest first.
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const session = await requireTenantSession();
  if (session instanceof NextResponse) return session;

  const app = await requireOwnedApp(session, (await context.params).uuid);
  if (app instanceof NextResponse) return app;

  const query = buildAppLogQuery(app.uuid, new URL(request.url).searchParams.get("q") ?? "");
  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      // Comment lines keep proxies (ngrok, Traefik) from closing an idle stream.
      const keepAlive = setInterval(() => send(": keep-alive\n\n"), 15_000);

      try {
        const unsubscribe = await subscribeTail(query, (lines) => send(`data: ${JSON.stringify(lines)}\n\n`), session.tenant.grafanaToken);
        cleanup = () => {
          clearInterval(keepAlive);
          unsubscribe();
        };
      } catch (error) {
        clearInterval(keepAlive);
        console.error(`Log tail failed for ${app.name}: ${(error as Error).message}`);
        send(`event: error\ndata: ${JSON.stringify({ message: "Live logs are unavailable right now." })}\n\n`);
        controller.close();
        return;
      }

      request.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "private, no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
