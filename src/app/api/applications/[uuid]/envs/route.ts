import { NextResponse } from "next/server";
import { apiErrorResponse, privateJson } from "@/lib/api-response";
import { requireTenantSession } from "@/lib/auth";
import { CoolifyApiError, deployApplication, getEnvironmentVariables, updateEnvironmentVariables } from "@/lib/coolify";
import { invalidateOverview } from "@/lib/overview-cache";
import type { EnvironmentVariable } from "@/lib/types";

type RouteContext = { params: Promise<{ uuid: string }> };

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const session = await requireTenantSession();
  if (session instanceof NextResponse) return session;

  try {
    const { uuid } = await context.params;
    return privateJson(await getEnvironmentVariables(session.tenant.coolifyToken, uuid));
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const session = await requireTenantSession();
  if (session instanceof NextResponse) return session;

  try {
    const { variables, redeploy } = (await request.json()) as {
      variables?: EnvironmentVariable[];
      redeploy?: boolean;
    };

    if (!Array.isArray(variables)) {
      return privateJson({ message: "Environment variables are required." }, { status: 400 });
    }

    if (variables.some((variable) => !variable.key.trim())) {
      return privateJson({ message: "Every variable needs a key." }, { status: 400 });
    }

    const { uuid } = await context.params;
    await updateEnvironmentVariables(session.tenant.coolifyToken, uuid, variables);

    if (redeploy === true) {
      try {
        await deployApplication(session.tenant.coolifyToken, uuid);
      } catch (deployError) {
        const detail = deployError instanceof CoolifyApiError ? ` ${deployError.message}` : "";
        return privateJson(
          { message: `Environment variables were saved, but deployment could not be queued.${detail}` },
          { status: deployError instanceof CoolifyApiError ? deployError.status : 500 },
        );
      }

      invalidateOverview(session.tenant.id);
      return privateJson({ message: "Environment variables saved and deployment queued." });
    }

    return privateJson({ message: "Environment variables saved." });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
