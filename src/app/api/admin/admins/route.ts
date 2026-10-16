import { NextResponse } from "next/server";
import { badRequest, readJson } from "@/lib/admin-api";
import { privateJson } from "@/lib/api-response";
import { requireAdminSession } from "@/lib/auth";
import { createUser, listUsers, UserError } from "@/lib/users";

export async function GET(): Promise<Response> {
  const session = await requireAdminSession();
  if (session instanceof NextResponse) return session;
  return privateJson({ admins: listUsers({ role: "admin" }), currentUserId: session.user.id });
}

export async function POST(request: Request): Promise<Response> {
  const session = await requireAdminSession();
  if (session instanceof NextResponse) return session;
  const body = await readJson<{ email: string; name: string }>(request);
  try {
    const { password } = await createUser({ email: body.email ?? "", name: body.name, role: "admin", tenantId: null });
    return privateJson({ message: "Admin created.", password });
  } catch (error) {
    return badRequest(error instanceof UserError ? error.message : "The admin could not be created.");
  }
}
