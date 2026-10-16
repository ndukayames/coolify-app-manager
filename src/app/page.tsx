import { redirect } from "next/navigation";
import { AccessGate } from "@/components/access-gate";
import { Dashboard } from "@/components/dashboard";
import { getTenantSession, isAdminSignedIn } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  // Admins have no client view; they work in /admin.
  if (await isAdminSignedIn()) redirect("/admin");
  if (!(await getTenantSession())) return <AccessGate />;

  return <Dashboard />;
}
