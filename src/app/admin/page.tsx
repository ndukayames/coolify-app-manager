import { notFound } from "next/navigation";
import { AccessGate } from "@/components/access-gate";
import { AdminConsole } from "@/components/admin/admin-console";
import { getAdminSession, getTenantSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const admin = await getAdminSession();
  if (admin) return <AdminConsole adminEmail={admin.user.email} />;

  // A signed-in client user gets a plain 404: /admin isn't advertised to them.
  if (await getTenantSession()) notFound();
  return <AccessGate variant="admin" />;
}
