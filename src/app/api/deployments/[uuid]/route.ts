import { NextResponse } from "next/server";
import { apiErrorResponse, privateJson } from "@/lib/api-response";
import { requireTenantSession } from "@/lib/auth";
import { getDeploymentLogs } from "@/lib/coolify";

type RouteContext = { params: Promise<{ uuid: string }> };

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const session = await requireTenantSession();
  if (session instanceof NextResponse) return session;

  try {
    const { uuid } = await context.params;
    return privateJson(await getDeploymentLogs(session.tenant.coolifyToken, uuid));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
