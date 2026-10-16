// Creates a Codeva admin account (for the first admin; later ones can be added in /admin).
//   npm run admin:add -- --email you@thecodeva.com
import { migrate } from "@/lib/migrate";
import { createUser } from "@/lib/users";
import { parseArgs } from "./prompt";

const main = async () => {
  const { email, name } = parseArgs(process.argv.slice(2));
  if (!email) throw new Error("Usage: npm run admin:add -- --email you@thecodeva.com [--name \"Your Name\"]");

  await migrate();
  const { password } = await createUser({ email, name, role: "admin", tenantId: null });
  console.log(`Admin ${email} created. Sign in at /admin.`);
  console.log(`Password (shown once): ${password}`);
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
