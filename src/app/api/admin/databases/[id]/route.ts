import { NextResponse } from "next/server";
import { badRequest, optionalPositive, readJson } from "@/lib/admin-api";
import { privateJson } from "@/lib/api-response";
import { requireAdminSession } from "@/lib/auth";
import { removeDatabaseById, updateDatabase } from "@/lib/databases";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const session = await requireAdminSession();
  if (session instanceof NextResponse) return session;

  const body = await readJson<{ name: string; cpu: number | string | null; memoryMb: number | string | null; storageGb: number | string | null }>(request);
  try {
    updateDatabase((await context.params).id, {
      displayName: body.name,
      cpuAllocation: body.cpu === undefined ? undefined : optionalPositive(body.cpu, "vCPU"),
      memoryMbAllocation: body.memoryMb === undefined ? undefined : optionalPositive(body.memoryMb, "Memory", true),
      storageGbAllocation: body.storageGb === undefined ? undefined : optionalPositive(body.storageGb, "Storage", true),
    });
    return privateJson({ message: "Database updated." });
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "The database could not be updated.");
  }
}

export async function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  const session = await requireAdminSession();
  if (session instanceof NextResponse) return session;
  removeDatabaseById((await context.params).id);
  return privateJson({ message: "Database unregistered. The database itself is untouched." });
}
