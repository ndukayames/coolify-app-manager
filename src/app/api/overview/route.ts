import { NextResponse } from "next/server";
import { apiErrorResponse, privateJson } from "@/lib/api-response";
import { requireTenantSession } from "@/lib/auth";
import { getAppsOverview } from "@/lib/overview";

export async function GET(): Promise<Response> {
  const session = await requireTenantSession();
  if (session instanceof NextResponse) return session;

  try {
    const { applications, projects } = await getAppsOverview(session.tenant);
    return privateJson({ applications, projects, instanceName: session.tenant.name, refreshedAt: new Date().toISOString() });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
