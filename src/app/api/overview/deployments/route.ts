import { NextResponse } from "next/server";
import { apiErrorResponse, privateJson } from "@/lib/api-response";
import { requireTenantSession } from "@/lib/auth";
import { getLatestDeployments } from "@/lib/overview";

export async function GET(): Promise<Response> {
  const session = await requireTenantSession();
  if (session instanceof NextResponse) return session;

  try {
    return privateJson({ deployments: await getLatestDeployments(session.tenant), refreshedAt: new Date().toISOString() });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
