import { NextResponse } from "next/server";
import { apiErrorResponse, privateJson } from "@/lib/api-response";
import { requireTenantSession } from "@/lib/auth";
import { deployApplication } from "@/lib/coolify";
import { invalidateOverview } from "@/lib/overview-cache";

type RouteContext = { params: Promise<{ uuid: string }> };

export async function POST(_request: Request, context: RouteContext): Promise<Response> {
  const session = await requireTenantSession();
  if (session instanceof NextResponse) return session;

  try {
    const { uuid } = await context.params;
    const { deployment_uuid: deploymentUuid } = await deployApplication(session.tenant.coolifyToken, uuid);
    invalidateOverview(session.tenant.id);
    return privateJson({ message: "Deployment queued.", deploymentUuid });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
