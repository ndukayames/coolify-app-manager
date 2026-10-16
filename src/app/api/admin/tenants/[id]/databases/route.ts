import { NextResponse } from "next/server";
import { badRequest, optionalPositive, readJson } from "@/lib/admin-api";
import { privateJson } from "@/lib/api-response";
import { requireAdminSession } from "@/lib/auth";
import { addDatabase } from "@/lib/databases";
import { getTenant } from "@/lib/tenants";

type RouteContext = { params: Promise<{ id: string }> };

type Body = {
  name: string;
  server: string;
  cluster: string;
  instance: string;
  pgbouncerUnit: string;
  replica: string; // "server/instance" or empty
  cpu: number | string;
  memoryMb: number | string;
  storageGb: number | string;
};

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const session = await requireAdminSession();
  if (session instanceof NextResponse) return session;

  const tenant = getTenant((await context.params).id);
  if (!tenant) return privateJson({ message: "Client not found." }, { status: 404 });
  const body = await readJson<Body>(request);

  try {
    const [replicaServer, replicaInstance] = body.replica ? body.replica.split("/") : [null, null];
    const id = addDatabase({
      tenantId: tenant.id,
      displayName: body.name ?? "",
      server: body.server ?? "",
      cluster: body.cluster?.trim() ?? "",
      exporterInstance: body.instance ?? "",
      pgbouncerUnit: body.pgbouncerUnit?.trim() || null,
      replicaServer: replicaServer || null,
      replicaInstance: replicaInstance || null,
      cpuAllocation: optionalPositive(body.cpu, "vCPU"),
      memoryMbAllocation: optionalPositive(body.memoryMb, "Memory", true),
      storageGbAllocation: optionalPositive(body.storageGb, "Storage", true),
    });
    return privateJson({ id, message: "Database registered." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The database could not be registered.";
    return badRequest(message.includes("UNIQUE") ? "That instance is already registered." : message);
  }
}
