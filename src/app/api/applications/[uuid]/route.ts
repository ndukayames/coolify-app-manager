import { NextResponse } from "next/server";
import { toAppDetails, toCoolifyChanges, ValidationError } from "@/lib/app-details";
import { apiErrorResponse, privateJson } from "@/lib/api-response";
import { requireTenantSession } from "@/lib/auth";
import { updateApplication } from "@/lib/coolify";
import { requireOwnedApp } from "@/lib/ownership";

type RouteContext = { params: Promise<{ uuid: string }> };

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const session = await requireTenantSession();
  if (session instanceof NextResponse) return session;

  try {
    const app = await requireOwnedApp(session, (await context.params).uuid);
    if (app instanceof NextResponse) return app;
    return privateJson(toAppDetails(app));
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const session = await requireTenantSession();
  if (session instanceof NextResponse) return session;

  try {
    const { uuid } = await context.params;
    const changes = toCoolifyChanges(await request.json().catch(() => null));
    await updateApplication(session.tenant.coolifyToken, uuid, changes);
    return privateJson({ message: "Settings saved. Redeploy to apply build and runtime changes." });
  } catch (error) {
    if (error instanceof ValidationError) return privateJson({ message: error.message }, { status: 400 });
    return apiErrorResponse(error);
  }
}
