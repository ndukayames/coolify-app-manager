import { NextResponse } from "next/server";
import { badRequest, readJson } from "@/lib/admin-api";
import { privateJson } from "@/lib/api-response";
import { requireAdminSession } from "@/lib/auth";
import { deleteUser, getUser, resetUserPassword, signOutUser } from "@/lib/users";

type RouteContext = { params: Promise<{ id: string }> };

// POST { action: "reset-password" | "sign-out" }
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const session = await requireAdminSession();
  if (session instanceof NextResponse) return session;

  const user = getUser((await context.params).id);
  if (!user) return privateJson({ message: "User not found." }, { status: 404 });
  const { action } = await readJson<{ action: string }>(request);

  if (action === "reset-password") {
    return privateJson({ message: `New password set for ${user.email}. They were signed out.`, password: await resetUserPassword(user.id) });
  }
  if (action === "sign-out") {
    await signOutUser(user.id);
    return privateJson({ message: `${user.email} was signed out everywhere.` });
  }
  return badRequest("Unknown action.");
}

export async function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  const session = await requireAdminSession();
  if (session instanceof NextResponse) return session;

  const user = getUser((await context.params).id);
  if (!user) return privateJson({ message: "User not found." }, { status: 404 });
  if (user.id === session.user.id) return badRequest("You can't remove your own account.");
  deleteUser(user.id);
  return privateJson({ message: `${user.email} was removed.` });
}
