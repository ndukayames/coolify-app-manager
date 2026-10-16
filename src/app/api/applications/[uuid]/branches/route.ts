import { NextResponse } from "next/server";
import { privateJson } from "@/lib/api-response";
import { requireTenantSession } from "@/lib/auth";
import { getRepositoryBranches } from "@/lib/coolify";
import { requireOwnedApp } from "@/lib/ownership";

type RouteContext = { params: Promise<{ uuid: string }> };

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const session = await requireTenantSession();
  if (session instanceof NextResponse) return session;

  const app = await requireOwnedApp(session, (await context.params).uuid).catch(() => null);
  if (!app || app instanceof NextResponse) return privateJson({ branches: [] });

  // An empty list tells the UI to fall back to typing the branch name.
  const branches = await getRepositoryBranches(session.tenant.coolifyToken, app).catch((error: unknown) => {
    console.error(`Branch listing failed for ${app.name}: ${(error as Error).message}`);
    return [];
  });
  return privateJson({ branches });
}
