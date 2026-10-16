import { NextResponse } from "next/server";
import { badRequest, checkCoolifyToken, checkGrafanaToken, readJson } from "@/lib/admin-api";
import { privateJson } from "@/lib/api-response";
import { requireAdminSession } from "@/lib/auth";
import { listTenantDatabases, toAdminDatabase } from "@/lib/databases";
import { deleteTenant, getTenant, getTenantByName, renameTenant, setTenantGrafanaToken, setTenantToken } from "@/lib/tenants";
import { listUsers } from "@/lib/users";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const session = await requireAdminSession();
  if (session instanceof NextResponse) return session;

  const tenant = getTenant((await context.params).id);
  if (!tenant) return privateJson({ message: "Client not found." }, { status: 404 });

  // Tokens are never returned, only whether they are set; the project list confirms the Coolify one.
  const projects = await checkCoolifyToken(tenant.coolifyToken).catch((error: Error) => ({ error: error.message }));
  return privateJson({
    id: tenant.id,
    name: tenant.name,
    hasGrafanaToken: tenant.grafanaToken !== null,
    coolify: Array.isArray(projects) ? { ok: true, projects } : { ok: false, error: projects.error },
    users: listUsers({ tenantId: tenant.id }),
    databases: listTenantDatabases(tenant.id).map(toAdminDatabase),
  });
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const session = await requireAdminSession();
  if (session instanceof NextResponse) return session;

  const tenant = getTenant((await context.params).id);
  if (!tenant) return privateJson({ message: "Client not found." }, { status: 404 });
  const body = await readJson<{ name: string; coolifyToken: string; grafanaToken: string | null }>(request);

  try {
    if (body.name !== undefined) {
      const name = body.name.trim();
      if (!name || name.length > 80) return badRequest("Client name must be 1-80 characters.");
      const clash = getTenantByName(name);
      if (clash && clash.id !== tenant.id) return badRequest(`A client named "${name}" already exists.`);
      renameTenant(tenant.id, name);
    }
    let projects: string[] | undefined;
    if (body.coolifyToken) {
      projects = await checkCoolifyToken(body.coolifyToken.trim());
      setTenantToken(tenant.id, body.coolifyToken.trim());
    }
    if (body.grafanaToken !== undefined) {
      const grafanaToken = body.grafanaToken?.trim() || null;
      if (grafanaToken) await checkGrafanaToken(grafanaToken);
      setTenantGrafanaToken(tenant.id, grafanaToken);
    }
    return privateJson({ message: "Client updated.", projects });
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "The client could not be updated.");
  }
}

export async function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  const session = await requireAdminSession();
  if (session instanceof NextResponse) return session;

  const tenant = getTenant((await context.params).id);
  if (!tenant) return privateJson({ message: "Client not found." }, { status: 404 });
  deleteTenant(tenant.id);
  return privateJson({ message: `${tenant.name} and its users were removed.` });
}
