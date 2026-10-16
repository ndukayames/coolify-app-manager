// Sets a new password for an existing user and signs them out everywhere.
//   npm run user:password -- --email dev@client.com
// Prompts for the password (hidden). Leave it empty to generate one, printed once.
import { randomBytes } from "node:crypto";
import { auth } from "@/lib/auth";
import { migrate } from "@/lib/migrate";
import { parseArgs, promptSecret } from "./prompt";

const main = async () => {
  const { email } = parseArgs(process.argv.slice(2));
  if (!email) throw new Error("Usage: npm run user:password -- --email dev@client.com");

  await migrate();
  const ctx = await auth.$context;
  const found = await ctx.internalAdapter.findUserByEmail(email.toLowerCase());
  if (!found) throw new Error(`No user with email ${email}.`);

  const entered = await promptSecret("New password (blank to generate): ");
  const password = entered || randomBytes(18).toString("base64url");
  if (password.length < 12) throw new Error("Password must be at least 12 characters.");

  await ctx.internalAdapter.updatePassword(found.user.id, await ctx.password.hash(password));
  await ctx.internalAdapter.deleteUserSessions(found.user.id);

  console.log(`Password updated for ${found.user.email}; existing sessions signed out.`);
  if (!entered) console.log(`Generated password (shown once): ${password}`);
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
