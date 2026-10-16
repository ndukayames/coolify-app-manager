import { NextResponse } from "next/server";
import type { TenantSession } from "@/lib/auth";
import { CoolifyApiError, getApplicationDetails, type CoolifyApplicationDetails } from "@/lib/coolify";

// Metrics and logs are read with a Grafana token that can see every client. Before any such
// query, the app is fetched with the tenant's own Coolify token: Coolify only returns apps in
// that client's team, so a UUID from another client fails here with 404.
export const requireOwnedApp = async (
  session: TenantSession,
  uuid: string,
): Promise<CoolifyApplicationDetails | NextResponse> => {
  if (!/^[a-z0-9]{8,64}$/.test(uuid)) {
    return NextResponse.json({ message: "That resource was not found." }, { status: 404 });
  }
  try {
    return await getApplicationDetails(session.tenant.coolifyToken, uuid);
  } catch (error) {
    if (error instanceof CoolifyApiError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    throw error;
  }
};
