import { NextResponse } from "next/server";
import { apiErrorResponse, privateJson } from "@/lib/api-response";
import { requireTenantSession } from "@/lib/auth";
import { listTenantDatabases, toPublicDatabase } from "@/lib/databases";
import { getDatabaseSummary } from "@/lib/db-metrics";

export async function GET(): Promise<Response> {
  const session = await requireTenantSession();
  if (session instanceof NextResponse) return session;

  try {
    const databases = await Promise.all(
      listTenantDatabases(session.tenant.id).map(async (database) => ({
        ...toPublicDatabase(database),
        ...(await getDatabaseSummary(database, session.tenant.grafanaToken)),
      })),
    );
    return privateJson({ databases, refreshedAt: new Date().toISOString() });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
