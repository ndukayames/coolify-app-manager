import { NextResponse } from "next/server";
import { badRequest, optionalPositive, readJson } from "@/lib/admin-api";
import { privateJson } from "@/lib/api-response";
import { requireAdminSession } from "@/lib/auth";
import { getApplications } from "@/lib/coolify";
import { getAllocations, getTenant, removeAllocation, setAllocation } from "@/lib/tenants";

type RouteContext = { params: Promise<{ id: string }> };

// The client's apps (via their own Coolify token) with their agreed plan, if any.
export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const session = await requireAdminSession();
  if (session instanceof NextResponse) return session;

  const tenant = getTenant((await context.params).id);
  if (!tenant) return privateJson({ message: "Client not found." }, { status: 404 });
  try {
    const allocations = getAllocations(tenant.id);
    const apps = (await getApplications(tenant.coolifyToken))
      .map((app) => ({ uuid: app.uuid, name: app.name, plan: allocations.get(app.uuid) ?? null }))
      .sort((left, right) => left.name.localeCompare(right.name));
    return privateJson({ apps });
  } catch {
    return privateJson({ message: "The client's apps could not be loaded from Coolify." }, { status: 502 });
  }
}

// PUT { appUuid, cpu, memoryMb } — both empty clears the plan.
export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  const session = await requireAdminSession();
  if (session instanceof NextResponse) return session;

  const tenant = getTenant((await context.params).id);
  if (!tenant) return privateJson({ message: "Client not found." }, { status: 404 });
  const body = await readJson<{ appUuid: string; cpu: number | string | null; memoryMb: number | string | null }>(request);

  try {
    // Only the client's own apps can carry their plan.
    const apps = await getApplications(tenant.coolifyToken);
    if (!apps.some((app) => app.uuid === body.appUuid)) return badRequest("That app doesn't belong to this client.");
    const cpu = optionalPositive(body.cpu, "vCPU");
    const memoryMb = optionalPositive(body.memoryMb, "Memory", true);
    if (cpu === null && memoryMb === null) {
      removeAllocation(tenant.id, body.appUuid as string);
      return privateJson({ message: "Plan cleared." });
    }
    if (cpu === null || memoryMb === null) return badRequest("Set both vCPU and memory, or clear both.");
    setAllocation(tenant.id, body.appUuid as string, { cpu, memoryMb });
    return privateJson({ message: "Plan saved." });
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "The plan could not be saved.");
  }
}
