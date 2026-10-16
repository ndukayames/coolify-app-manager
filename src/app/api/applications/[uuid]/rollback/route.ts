import { NextResponse } from "next/server";
import { apiErrorResponse, privateJson } from "@/lib/api-response";
import { requireTenantSession } from "@/lib/auth";
import { getRollbackImages, rollbackApplication } from "@/lib/coolify";
import { invalidateOverview } from "@/lib/overview-cache";

type RouteContext = { params: Promise<{ uuid: string }> };

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const session = await requireTenantSession();
  if (session instanceof NextResponse) return session;

  try {
    const { uuid } = await context.params;
    return privateJson({ images: await getRollbackImages(session.tenant.coolifyToken, uuid) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const session = await requireTenantSession();
  if (session instanceof NextResponse) return session;

  try {
    const { uuid } = await context.params;
    const { tag } = (await request.json().catch(() => ({}))) as { tag?: unknown };
    // Only a tag Coolify itself lists for this app is accepted.
    const images = await getRollbackImages(session.tenant.coolifyToken, uuid);
    const image = images.find((candidate) => candidate.tag === tag);
    if (!image) return privateJson({ message: "That version is no longer available." }, { status: 400 });
    if (image.isCurrent) return privateJson({ message: "That version is already running." }, { status: 400 });

    const { deployment_uuid: deploymentUuid } = await rollbackApplication(session.tenant.coolifyToken, uuid, image.tag);
    invalidateOverview(session.tenant.id);
    return privateJson({ message: `Rollback to ${image.tag.slice(0, 7)} queued.`, deploymentUuid });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
