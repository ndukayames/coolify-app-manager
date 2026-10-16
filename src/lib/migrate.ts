import { getMigrations } from "better-auth/db/migration";
import { auth } from "@/lib/auth";

// Creates or updates Better Auth's tables (user, session, account, verification).
// The tenant table is created in lib/db.ts. Safe to run on every boot.
export const migrate = async (): Promise<void> => {
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
};
