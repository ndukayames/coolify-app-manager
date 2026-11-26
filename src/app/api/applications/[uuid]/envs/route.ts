import { NextResponse } from "next/server";
import { apiErrorResponse, privateJson } from "@/lib/api-response";
import { requireTenantSession } from "@/lib/auth";
import { CoolifyApiError, deployApplication, getEnvironmentVariables, updateEnvironmentVariables } from "@/lib/coolify";
import { invalidateOverview } from "@/lib/overview-cache";
import type { EnvironmentVariable } from "@/lib/types";

type RouteContext = { params: Promise<{ uuid: string }> };

// Mirrors the upstream rules for each variable, so a rejected save names the variable at fault
// instead of failing the whole batch with no detail. Returns a message, or null when all pass.
const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_.]*$/;
const BOOLEAN_FIELDS = ["isPreview", "isBuildTime", "isLiteral", "isMultiline"] as const;

const findInvalidVariable = (variables: unknown[]): string | null => {
  for (const [index, entry] of variables.entries()) {
    const variable = entry as Partial<EnvironmentVariable> | null;
    const position = `Variable ${index + 1}`;
    if (!variable || typeof variable !== "object") return `${position} is not valid.`;

    const key = typeof variable.key === "string" ? variable.key.trim() : "";
    if (!key) return `${position} needs a key.`;
    if (key.length > 255) return `${position} has a key longer than 255 characters.`;
    if (!KEY_PATTERN.test(key)) {
      return `${key} is not a valid name. Use letters, digits, underscores or dots, and do not start with a digit.`;
    }
    if (variable.value !== undefined && variable.value !== null && typeof variable.value !== "string") {
      return `${key} must have a text value.`;
    }
    for (const field of BOOLEAN_FIELDS) {
      if (variable[field] !== undefined && typeof variable[field] !== "boolean") return `${key} has an invalid setting.`;
    }
  }
  return null;
};

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

    const problem = findInvalidVariable(variables);
    if (problem) return privateJson({ message: problem }, { status: 400 });

    const { uuid } = await context.params;
    try {
      await updateEnvironmentVariables(session.tenant.coolifyToken, uuid, variables);
    } catch (saveError) {
      if (saveError instanceof CoolifyApiError && saveError.fieldErrors?.length) {
        return privateJson(
          { message: `Environment variables were not saved: ${saveError.fieldErrors.join(" ")}` },
          { status: 400 },
        );
      }
      throw saveError;
    }

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
