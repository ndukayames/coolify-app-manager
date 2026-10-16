import { NextResponse } from "next/server";
import { apiErrorResponse, privateJson } from "@/lib/api-response";
import { requireTenantSession } from "@/lib/auth";
import { requireOwnedDatabase, toPublicDatabase } from "@/lib/databases";
import { getDatabaseDetail } from "@/lib/db-metrics";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const session = await requireTenantSession();
  if (session instanceof NextResponse) return session;

  const database = requireOwnedDatabase(session, (await context.params).id);
  if (database instanceof NextResponse) return database;

  try {
    return privateJson({ ...toPublicDatabase(database), ...(await getDatabaseDetail(database, session.tenant.grafanaToken)), refreshedAt: new Date().toISOString() });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
