import { NextResponse } from "next/server";
import { apiErrorResponse, privateJson } from "@/lib/api-response";
import { requireTenantSession } from "@/lib/auth";
import { requireOwnedApp } from "@/lib/ownership";
import { getAppMetrics, metricRanges, type MetricRange } from "@/lib/usage";

type RouteContext = { params: Promise<{ uuid: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const session = await requireTenantSession();
  if (session instanceof NextResponse) return session;

  try {
    const app = await requireOwnedApp(session, (await context.params).uuid);
    if (app instanceof NextResponse) return app;

    const requested = new URL(request.url).searchParams.get("range") ?? "6h";
    const range: MetricRange = requested in metricRanges ? (requested as MetricRange) : "6h";
    return privateJson(await getAppMetrics(session.tenant, app.uuid, range));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
