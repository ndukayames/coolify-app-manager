import { NextResponse } from "next/server";
import { apiErrorResponse, privateJson } from "@/lib/api-response";
import { requireTenantSession } from "@/lib/auth";
import { getApplications } from "@/lib/coolify";
import { getUsageSummary } from "@/lib/usage";

export async function GET(): Promise<Response> {
  const session = await requireTenantSession();
  if (session instanceof NextResponse) return session;

  try {
    // The app list comes from the tenant's own Coolify token, so only their apps are measured.
    const apps = await getApplications(session.tenant.coolifyToken);
    return privateJson(await getUsageSummary(session.tenant, apps.map(({ uuid, name }) => ({ uuid, name }))));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
