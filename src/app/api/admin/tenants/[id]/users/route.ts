import { NextResponse } from "next/server";
import { badRequest, readJson } from "@/lib/admin-api";
import { privateJson } from "@/lib/api-response";
import { requireAdminSession } from "@/lib/auth";
import { getTenant } from "@/lib/tenants";
import { createUser, UserError } from "@/lib/users";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const session = await requireAdminSession();
  if (session instanceof NextResponse) return session;

  const tenant = getTenant((await context.params).id);
  if (!tenant) return privateJson({ message: "Client not found." }, { status: 404 });
  const body = await readJson<{ email: string; name: string }>(request);

  try {
    const { password } = await createUser({ email: body.email ?? "", name: body.name, role: "client", tenantId: tenant.id });
    return privateJson({ message: "User created.", password });
  } catch (error) {
    return badRequest(error instanceof UserError ? error.message : "The user could not be created.");
  }
}
