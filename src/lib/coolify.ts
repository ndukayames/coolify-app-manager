import { sanitizeDeploymentLogs } from "@/lib/deployment-logs";
import type {
  Application,
  ApplicationStatus,
  Deployment,
  DeploymentLogs,
  DeploymentStatus,
  EnvironmentVariable,
  Project,
} from "@/lib/types";

type CoolifyApplication = {
  uuid: string;
  name: string;
  description?: string | null;
  fqdn?: string | null;
  git_repository?: string | null;
  git_branch?: string | null;
  git_commit_sha?: string | null;
  status?: string | null;
  updated_at?: string | null;
  environment_id?: number | null;
};

type CoolifyEnvironment = {
  id: number;
  name?: string | null;
  project_id?: number | null;
};

type CoolifyProject = {
  id: number;
  uuid: string;
  name: string;
  environments?: CoolifyEnvironment[];
};

export type ProjectContext = {
  projects: Project[];
  projectByEnvironmentId: Map<number, Project>;
};

type CoolifyDeployment = {
  deployment_uuid?: string | null;
  uuid?: string | null;
  application_id?: string | number | null;
  application_name?: string | null;
  server_name?: string | null;
  status?: string | null;
  commit?: string | null;
  commit_message?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  logs?: string | null;
};

type CoolifyDeploymentHistory =
  | CoolifyDeployment[]
  | {
      count?: number;
      deployments?: CoolifyDeployment[];
    };

type CoolifyEnvironmentVariable = {
  uuid?: string;
  key: string;
  value: string;
  is_preview?: boolean;
  is_buildtime?: boolean;
  is_literal?: boolean;
  is_multiline?: boolean;
};

export class CoolifyApiError extends Error {
  status: number;
  retryAfterSeconds?: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "CoolifyApiError";
    this.status = status;
  }
}

const getApiBaseUrl = (): string => {
  const origin = process.env.COOLIFY_BASE_URL?.replace(/\/$/, "").replace(/\/api\/v1$/, "");

  if (!origin) {
    console.error("COOLIFY_BASE_URL is not set.");
    throw new CoolifyApiError(unavailableMessage, 503);
  }

  return `${origin}/api/v1`;
};

const unavailableMessage = "The service is temporarily unavailable. Try again shortly.";

// Users must not see upstream details (the platform name, internal errors), so each
// upstream status maps to a neutral message. The real error is logged server-side.
const toClientError = (status: number): CoolifyApiError => {
  if (status === 404) return new CoolifyApiError("That resource was not found.", 404);
  if (status === 429) return new CoolifyApiError("Too many requests. Try again shortly.", 429);
  // Raised when a domain is already used by another resource. The upstream body names that
  // resource, which may belong to another client, so only a generic message is returned.
  if (status === 409) return new CoolifyApiError("That domain is already in use.", 409);
  if (status === 400 || status === 422) {
    return new CoolifyApiError("The request was rejected. Check your input and try again.", 400);
  }
  // 401/403 here mean our tenant token is wrong or under-scoped, which is our problem, not the user's.
  return new CoolifyApiError(unavailableMessage, 502);
};

// `token` is the caller's tenant token (see lib/tenants.ts). There is deliberately no
// instance-wide token fallback, so a missing tenant can never widen access.
export const coolifyRequest = async <T>(token: string, path: string, options: RequestInit = {}): Promise<T> => {
  const send = () => fetch(`${getApiBaseUrl()}${path}`, {
    ...options,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  let response: Response;
  try {
    response = await send();
  } catch (networkError) {
    // Connections to the instance occasionally time out. Reads are retried once; writes are not,
    // because the first attempt may have reached the server (a retried deploy could run twice).
    if ((options.method ?? "GET") !== "GET") throw networkError;
    const cause = (networkError as Error).cause as { code?: string } | undefined;
    console.warn(`Coolify GET ${path} failed (${cause?.code ?? (networkError as Error).message}), retrying once`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    response = await send();
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    console.error(`Coolify ${options.method ?? "GET"} ${path} returned ${response.status}: ${body?.message ?? "no message"}`);
    const clientError = toClientError(response.status);
    clientError.retryAfterSeconds = Number(response.headers.get("retry-after")) || undefined;
    throw clientError;
  }

  return (await response.json()) as T;
};

// Fan-out calls (one per app or project) run at most this many at a time. Firing 100 at once
// queues on Coolify's PHP workers and slows Coolify down for every client and deploy.
const maxParallel = 8;

const mapLimit = async <T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> => {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = await fn(items[index]);
      } catch (error) {
        // Don't start the remaining calls: the whole fan-out has already failed.
        next = items.length;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(maxParallel, items.length) }, worker));
  return results;
};

const normalizeApplicationStatus = (status?: string | null): ApplicationStatus => {
  const value = status?.toLowerCase() ?? "";

  if (value.includes("running")) return "running";
  if (value.includes("degraded") || value.includes("unhealthy")) return "degraded";
  if (value.includes("stopped") || value.includes("exited")) return "stopped";
  return "unknown";
};

const normalizeDeploymentStatus = (status?: string | null): DeploymentStatus => {
  const value = status?.toLowerCase() ?? "";

  if (value.includes("finish") || value.includes("success")) return "finished";
  if (value.includes("progress") || value.includes("running")) return "in_progress";
  if (value.includes("fail")) return "failed";
  if (value.includes("queue") || value.includes("pending")) return "queued";
  return "cancelled";
};

export const getApplications = async (token: string): Promise<Application[]> => {
  const applications = await coolifyRequest<CoolifyApplication[]>(token, "/applications");

  return applications.map((application) => ({
    uuid: application.uuid,
    name: application.name,
    description: application.description ?? "No description",
    fqdn: application.fqdn?.split(",")[0] ?? "",
    gitRepository: application.git_repository ?? "Repository unavailable",
    gitBranch: application.git_branch ?? "main",
    gitCommitSha: application.git_commit_sha?.slice(0, 7) ?? "unknown",
    status: normalizeApplicationStatus(application.status),
    updatedAt: application.updated_at ?? new Date().toISOString(),
    environmentId: application.environment_id ?? null,
    projectUuid: null,
    projectName: null,
  }));
};

const getProjectEnvironments = async (token: string, project: CoolifyProject): Promise<CoolifyEnvironment[]> => {
  if (project.environments) return project.environments;

  try {
    return await coolifyRequest<CoolifyEnvironment[]>(
      token,
      `/projects/${encodeURIComponent(project.uuid)}/environments`,
    );
  } catch (error) {
    if (!(error instanceof CoolifyApiError) || ![404, 405].includes(error.status)) throw error;

    const projectDetails = await coolifyRequest<CoolifyProject>(token, `/projects/${encodeURIComponent(project.uuid)}`);
    return projectDetails.environments ?? [];
  }
};

export const getProjectContext = async (token: string): Promise<ProjectContext> => {
  const rawProjects = await coolifyRequest<CoolifyProject[]>(token, "/projects");
  const environmentsByProject = await mapLimit(rawProjects, (project) => getProjectEnvironments(token, project));
  const projects: Project[] = rawProjects.map((project, index) => ({
    id: project.id,
    uuid: project.uuid,
    name: project.name,
    environments: environmentsByProject[index].map((environment) => ({
      id: environment.id,
      name: environment.name ?? `environment-${environment.id}`,
    })),
  }));
  const projectByEnvironmentId = new Map<number, Project>();

  environmentsByProject.forEach((environments, index) => {
    const project = projects[index];
    environments.forEach((environment) => projectByEnvironmentId.set(environment.id, project));
  });

  return { projects, projectByEnvironmentId };
};

const normalizeDeployment = (deployment: CoolifyDeployment, application: Application): Deployment | null => {
  const uuid = deployment.deployment_uuid ?? deployment.uuid;
  if (!uuid) return null;

  return {
    uuid,
    applicationUuid: application.uuid,
    applicationName: deployment.application_name ?? application.name,
    status: normalizeDeploymentStatus(deployment.status),
    commit: deployment.commit?.slice(0, 7) ?? "unknown",
    commitMessage: deployment.commit_message ?? "Deployment triggered",
    createdAt: deployment.created_at ?? new Date().toISOString(),
    updatedAt: deployment.updated_at ?? deployment.created_at ?? new Date().toISOString(),
    projectUuid: application.projectUuid,
    projectName: application.projectName,
  };
};

// Each history item carries its full build log (~60 KB), so `take` must stay small when fetching
// across many apps. The overview uses 1; a single app's history page uses more.
export const getDeployments = async (token: string, applications: Application[], take = 1): Promise<Deployment[]> => {
  const deploymentsByApplication = await mapLimit(
    applications, async (application) => {
      // One app's history failing should not blank the whole dashboard; it just drops out of the list.
      const history = await coolifyRequest<CoolifyDeploymentHistory>(
        token,
        `/deployments/applications/${encodeURIComponent(application.uuid)}?skip=0&take=${take}`,
      ).catch((error: unknown) => {
        // Rate limited: fail the fan-out so the cache keeps the last full list, not a partial one.
        if (error instanceof CoolifyApiError && error.status === 429) throw error;
        console.error(`Skipping deployment history for ${application.name}: ${(error as Error).message}`);
        return [] as CoolifyDeployment[];
      });
      const deployments = Array.isArray(history) ? history : history.deployments ?? [];

      return deployments
        .map((deployment) => normalizeDeployment(deployment, application))
        .filter((deployment): deployment is Deployment => deployment !== null);
    },
  );

  return deploymentsByApplication
    .flat()
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
};

// Longest a build-log request waits on Coolify's rate limit before giving up.
const maxRetryWaitSeconds = 10;

export const getDeploymentLogs = async (token: string, uuid: string): Promise<DeploymentLogs> => {
  const load = () => coolifyRequest<CoolifyDeployment>(token, `/deployments/${encodeURIComponent(uuid)}`);
  const deployment = await load().catch(async (error: unknown) => {
    if (!(error instanceof CoolifyApiError) || error.status !== 429) throw error;
    await new Promise((resolve) => setTimeout(resolve, Math.min(error.retryAfterSeconds ?? 2, maxRetryWaitSeconds) * 1000));
    return load();
  });

  return {
    lines: sanitizeDeploymentLogs(deployment.logs),
    refreshedAt: new Date().toISOString(),
  };
};

export const getEnvironmentVariables = async (token: string, uuid: string): Promise<EnvironmentVariable[]> => {
  const variables = await coolifyRequest<CoolifyEnvironmentVariable[]>(token, `/applications/${uuid}/envs`);

  // Coolify keeps a separate row per key for preview deployments. Returning both
  // gives us two entries with the same key, and anything that indexes by key alone
  // (the bulk editor's Map) then resolves to the preview row and writes edits there,
  // leaving the row the running container actually reads untouched.
  // This manager only administers production env, so preview rows are dropped here.
  return variables
    .filter((variable) => (variable.is_preview ?? false) === false)
    .map((variable) => ({
      uuid: variable.uuid,
      key: variable.key,
      value: variable.value,
      isPreview: false,
      isBuildTime: variable.is_buildtime ?? false,
      isLiteral: variable.is_literal ?? false,
      isMultiline: variable.is_multiline ?? false,
    }));
};

export const updateEnvironmentVariables = async (
  token: string,
  uuid: string,
  variables: EnvironmentVariable[],
): Promise<void> => {
  await coolifyRequest(token, `/applications/${uuid}/envs/bulk`, {
    method: "PATCH",
    body: JSON.stringify({
      data: variables.map((variable) => ({
        key: variable.key,
        value: variable.value,
        is_preview: variable.isPreview,
        is_buildtime: variable.isBuildTime,
        is_literal: variable.isLiteral,
        is_multiline: variable.isMultiline,
      })),
    }),
  });
};

export const deployApplication = async (token: string, uuid: string): Promise<{ message: string; deployment_uuid: string }> =>
  coolifyRequest(token, `/applications/${uuid}/start`, { method: "POST" });

// Raw application record. Only lib/app-details.ts should read this, because it contains
// internal fields (servers, registry, labels, limits) that must never reach the browser.
export type CoolifyApplicationDetails = Record<string, unknown> & {
  uuid: string;
  name: string;
  source_id?: number | null;
  source_type?: string | null;
  git_repository?: string | null;
  settings?: Record<string, unknown> | null;
};

export const getApplicationDetails = async (token: string, uuid: string): Promise<CoolifyApplicationDetails> =>
  coolifyRequest(token, `/applications/${encodeURIComponent(uuid)}`);

export const updateApplication = async (token: string, uuid: string, changes: Record<string, unknown>): Promise<void> => {
  await coolifyRequest(token, `/applications/${encodeURIComponent(uuid)}`, {
    method: "PATCH",
    body: JSON.stringify(changes),
  });
};

export type RollbackImage = { tag: string; createdAt: string; isCurrent: boolean };

export const getRollbackImages = async (token: string, uuid: string): Promise<RollbackImage[]> => {
  const body = await coolifyRequest<{ images?: { tag: string; created_at: string; is_current: boolean }[] }>(
    token,
    `/applications/${encodeURIComponent(uuid)}/rollback-images`,
  );
  return (body.images ?? []).map((image) => ({
    tag: image.tag,
    createdAt: image.created_at,
    isCurrent: image.is_current,
  }));
};

export const rollbackApplication = async (token: string, uuid: string, commit: string): Promise<{ deployment_uuid?: string }> =>
  coolifyRequest(token, `/applications/${encodeURIComponent(uuid)}/rollback`, {
    method: "POST",
    body: JSON.stringify({ commit }),
  });

// Branch listing goes through the GitHub App the application was created with. A client's
// team token may not have access to that app; callers fall back to free-text branch entry.
export const getRepositoryBranches = async (token: string, application: CoolifyApplicationDetails): Promise<string[]> => {
  const [owner, repo] = (application.git_repository ?? "").replace(/\.git$/, "").split("/").slice(-2);
  if (!application.source_id || !String(application.source_type ?? "").includes("GithubApp") || !owner || !repo) return [];

  const body = await coolifyRequest<{ branches?: { name?: string }[] }>(
    token,
    `/github-apps/${application.source_id}/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches`,
  );
  return (body.branches ?? []).flatMap((branch) => (branch.name ? [branch.name] : []));
};
