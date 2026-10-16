import { betterAuth } from "better-auth";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getTenant, type Tenant } from "@/lib/tenants";

// BETTER_AUTH_SECRET and BETTER_AUTH_URL are read from the environment by Better Auth.
export const auth = betterAuth({
  database: db,
  emailAndPassword: {
    enabled: true,
    // No self-service accounts: admins create users in /admin (or scripts/) and tie them to a tenant.
    disableSignUp: true,
    minPasswordLength: 12,
  },
  user: {
    additionalFields: {
      // Both are set server-side only, never accepted from the client.
      tenantId: { type: "string", required: false, input: false },
      // "client": a client's developer, scoped to one tenant. "admin": Codeva staff, no tenant,
      // only ever sees /admin.
      role: { type: "string", required: false, defaultValue: "client", input: false },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
  },
});

type SessionUser = { id: string; email: string; name: string; tenantId?: string | null; role?: string | null };

const currentUser = async (): Promise<SessionUser | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  return session ? (session.user as SessionUser) : null;
};

export type TenantSession = {
  user: { id: string; email: string; name: string };
  tenant: Tenant;
};

// Resolves a client user and their tenant. Admins, users with no tenant, and users whose
// tenant was deleted get no access rather than a fallback.
export const getTenantSession = async (): Promise<TenantSession | null> => {
  const user = await currentUser();
  if (!user || user.role === "admin") return null;

  const tenant = user.tenantId ? getTenant(user.tenantId) : null;
  if (!tenant) return null;

  return { user: { id: user.id, email: user.email, name: user.name }, tenant };
};

export const requireTenantSession = async (): Promise<TenantSession | NextResponse> => {
  const session = await getTenantSession();
  if (session) return session;

  return NextResponse.json({ message: "Authentication is required." }, { status: 401 });
};

export type AdminSession = { user: { id: string; email: string; name: string } };

export const getAdminSession = async (): Promise<AdminSession | null> => {
  const user = await currentUser();
  return user?.role === "admin" ? { user: { id: user.id, email: user.email, name: user.name } } : null;
};

// Admin APIs answer 404 to anyone else, so their existence isn't revealed to client users.
export const requireAdminSession = async (): Promise<AdminSession | NextResponse> => {
  const session = await getAdminSession();
  if (session) return session;

  return NextResponse.json({ message: "That resource was not found." }, { status: 404 });
};

export const isAdminSignedIn = async (): Promise<boolean> => (await currentUser())?.role === "admin";
