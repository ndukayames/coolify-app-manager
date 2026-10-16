import { NextResponse } from "next/server";
import { apiErrorResponse, privateJson } from "@/lib/api-response";
import { requireTenantSession } from "@/lib/auth";
import { buildAppLogQuery } from "@/lib/app-logs";
import { lokiQueryRange } from "@/lib/grafana";
import { requireOwnedApp } from "@/lib/ownership";
import type { AppLogLine } from "@/lib/types";

type RouteContext = { params: Promise<{ uuid: string }> };

const ranges: Record<string, number> = { "15m": 900, "1h": 3600, "6h": 21600, "24h": 86400, "7d": 604800 };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const session = await requireTenantSession();
  if (session instanceof NextResponse) return session;

  try {
    const app = await requireOwnedApp(session, (await context.params).uuid);
    if (app instanceof NextResponse) return app;

    const params = new URL(request.url).searchParams;
    const range = ranges[params.get("range") ?? "1h"] ?? ranges["1h"];
    const limit = Math.min(Math.max(Number(params.get("limit")) || 300, 1), 1000);

    const query = buildAppLogQuery(app.uuid, params.get("q") ?? "");

    const end = Math.floor(Date.now() / 1000);
    const entries = await lokiQueryRange(query, { start: end - range, end, limit }, session.tenant.grafanaToken);
    const lines: AppLogLine[] = entries.map((entry) => ({
      timestamp: new Date(Number(entry.timestamp.slice(0, 13))).toISOString(),
      message: entry.line,
    }));
    return privateJson({ lines, refreshedAt: new Date().toISOString() });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
