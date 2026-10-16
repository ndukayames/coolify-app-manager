import { randomBytes } from "node:crypto";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

// Account management for /admin and scripts/. Passwords are generated here and returned once;
// only the hash is stored, so they can't be shown again.

export type Role = "admin" | "client";

export type ManagedUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  createdAt: string;
  activeSessions: number;
};

const generatePassword = (): string => randomBytes(18).toString("base64url");

export const listUsers = (filter: { tenantId: string } | { role: "admin" }): ManagedUser[] => {
  const where = "tenantId" in filter ? "u.tenantId = ?" : "u.role = ?";
  const value = "tenantId" in filter ? filter.tenantId : filter.role;
  return db.prepare(`
    SELECT u.id, u.email, u.name, COALESCE(u.role, 'client') AS role, u.createdAt,
      (SELECT COUNT(*) FROM session s WHERE s.userId = u.id AND s.expiresAt > ?) AS activeSessions
    FROM user u WHERE ${where} ORDER BY u.email
  `).all(new Date().toISOString(), value) as ManagedUser[];
};

export const getUser = (id: string): (ManagedUser & { tenantId: string | null }) | null =>
  (db.prepare(`SELECT id, email, name, COALESCE(role, 'client') AS role, createdAt, tenantId, 0 AS activeSessions
    FROM user WHERE id = ?`).get(id) as (ManagedUser & { tenantId: string | null }) | undefined) ?? null;

export class UserError extends Error {}

// Sign-up is disabled over HTTP, so accounts are created through Better Auth's adapter directly.
export const createUser = async (input: {
  email: string;
  name?: string;
  role: Role;
  tenantId: string | null;
}): Promise<{ id: string; password: string }> => {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new UserError("Enter a valid email address.");
  if (input.role === "client" && !input.tenantId) throw new UserError("A client user must belong to a client.");
  if (input.role === "admin" && input.tenantId) throw new UserError("Admins don't belong to a client.");

  const ctx = await auth.$context;
  if (await ctx.internalAdapter.findUserByEmail(email)) throw new UserError(`${email} already has an account.`);

  const password = generatePassword();
  const user = await ctx.internalAdapter.createUser({
    email,
    name: input.name?.trim() || email,
    emailVerified: true,
    tenantId: input.tenantId,
    role: input.role,
  }, { method: "admin" });
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: await ctx.password.hash(password),
  });
  return { id: user.id, password };
};

export const resetUserPassword = async (userId: string): Promise<string> => {
  const ctx = await auth.$context;
  const password = generatePassword();
  await ctx.internalAdapter.updatePassword(userId, await ctx.password.hash(password));
  await ctx.internalAdapter.deleteUserSessions(userId);
  return password;
};

export const signOutUser = async (userId: string): Promise<void> => {
  const ctx = await auth.$context;
  await ctx.internalAdapter.deleteUserSessions(userId);
};

export const deleteUser = (userId: string): void => {
  db.transaction(() => {
    db.prepare("DELETE FROM session WHERE userId = ?").run(userId);
    db.prepare("DELETE FROM account WHERE userId = ?").run(userId);
    db.prepare("DELETE FROM user WHERE id = ?").run(userId);
  })();
};
