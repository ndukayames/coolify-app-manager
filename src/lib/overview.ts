import { getApplications, getDeployments, getProjectContext } from "@/lib/coolify";
import { getOverview } from "@/lib/overview-cache";
import type { Tenant } from "@/lib/tenants";
import type { Application, Deployment, Project } from "@/lib/types";

// The overview is split in two so the page can render before the slow part:
//  - apps: one Coolify list call (plus projects), shown immediately.
//  - deployments: one call per app for its last deploy, filled in when ready.

type AppsOverview = { applications: Application[]; projects: Project[] };

export const getAppsOverview = (tenant: Tenant): Promise<AppsOverview> =>
  getOverview(`${tenant.id}:apps`, async () => {
    const [rawApplications, projectContext] = await Promise.all([
      getApplications(tenant.coolifyToken),
      getProjectContext(tenant.coolifyToken),
    ]);
    const applications = rawApplications.map((application) => {
      const project = application.environmentId === null
        ? undefined
        : projectContext.projectByEnvironmentId.get(application.environmentId);
      return { ...application, projectUuid: project?.uuid ?? null, projectName: project?.name ?? null };
    });
    return { applications, projects: projectContext.projects };
  });

export const getLatestDeployments = (tenant: Tenant): Promise<Deployment[]> =>
  getOverview(`${tenant.id}:deployments`, async () => {
    const { applications } = await getAppsOverview(tenant);
    return getDeployments(tenant.coolifyToken, applications);
  });
