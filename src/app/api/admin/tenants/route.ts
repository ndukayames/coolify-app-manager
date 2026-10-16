import { NextResponse } from "next/server";
import { badRequest, checkCoolifyToken, checkGrafanaToken, readJson } from "@/lib/admin-api";
import { privateJson } from "@/lib/api-response";
import { requireAdminSession } from "@/lib/auth";
import { createTenant, getTenantByName, listTenantOverviews, setTenantGrafanaToken } from "@/lib/tenants";

export async function GET(): Promise<Response> {
  const session = await requireAdminSession();
  if (session instanceof NextResponse) return session;
  return privateJson({ tenants: listTenantOverviews() });
}

export async function POST(request: Request): Promise<Response> {
  const session = await requireAdminSession();
  if (session instanceof NextResponse) return session;

  const body = await readJson<{ name: string; coolifyToken: string; grafanaToken: string }>(request);
  const name = body.name?.trim() ?? "";
  const coolifyToken = body.coolifyToken?.trim() ?? "";
  const grafanaToken = body.grafanaToken?.trim() || null;
  if (!name || name.length > 80) return badRequest("Client name must be 1-80 characters.");
  if (!coolifyToken) return badRequest("A Coolify team token is required.");
  if (getTenantByName(name)) return badRequest(`A client named "${name}" already exists.`);

  try {
    const projects = await checkCoolifyToken(coolifyToken);
    if (grafanaToken) await checkGrafanaToken(grafanaToken);
    const id = createTenant(name, coolifyToken);
    if (grafanaToken) setTenantGrafanaToken(id, grafanaToken);
    return privateJson({ id, projects });
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "The client could not be created.");
  }
}
