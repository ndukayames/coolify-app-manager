import { NextResponse } from "next/server";
import { privateJson } from "@/lib/api-response";
import { requireTenantSession } from "@/lib/auth";
import { requireOwnedDatabase } from "@/lib/databases";
import { agentRequest, hasAgent, type AgentCluster } from "@/lib/db-agent";
import { toSettingsView } from "@/lib/db-parameters";

type RouteContext = { params: Promise<{ id: string }> };

// Current Postgres and PgBouncer settings for one of the tenant's databases, read through the
// db-agent on its server. Read-only for now.
export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const session = await requireTenantSession();
  if (session instanceof NextResponse) return session;

  const database = requireOwnedDatabase(session, (await context.params).id);
  if (database instanceof NextResponse) return database;

  if (!hasAgent(database.server)) {
    return privateJson({ available: false, message: "Settings aren't available for this database yet." });
  }
  try {
    const raw = await agentRequest<AgentCluster>(database.server, "GET", `/v1/clusters/${database.cluster}`);
    return privateJson(toSettingsView(raw));
  } catch (error) {
    console.error(`Settings for ${database.server}/${database.cluster}: ${(error as Error).message}`);
    return privateJson({ available: false, message: "Settings are temporarily unavailable. Try again shortly." });
  }
}
