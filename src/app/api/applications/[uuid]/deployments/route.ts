import { NextResponse } from "next/server";
import { apiErrorResponse, privateJson } from "@/lib/api-response";
import { requireTenantSession } from "@/lib/auth";
import { getDeployments } from "@/lib/coolify";
import { requireOwnedApp } from "@/lib/ownership";

type RouteContext = { params: Promise<{ uuid: string }> };

// Full history for one app, loaded only when its Deployments tab is opened.
export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const session = await requireTenantSession();
  if (session instanceof NextResponse) return session;

  try {
    const app = await requireOwnedApp(session, (await context.params).uuid);
    if (app instanceof NextResponse) return app;

    const application = {
      uuid: app.uuid,
      name: app.name,
      description: "",
      fqdn: "",
      gitRepository: "",
      gitBranch: "",
      gitCommitSha: "",
      status: "unknown" as const,
      updatedAt: "",
      environmentId: null,
      projectUuid: null,
      projectName: null,
    };
    return privateJson({ deployments: await getDeployments(session.tenant.coolifyToken, [application], 25) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
