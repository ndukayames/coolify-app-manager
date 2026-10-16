export type ApplicationStatus = "running" | "degraded" | "stopped" | "unknown";

export type DeploymentStatus = "finished" | "in_progress" | "failed" | "queued" | "cancelled";

export type Application = {
  uuid: string;
  name: string;
  description: string;
  fqdn: string;
  gitRepository: string;
  gitBranch: string;
  gitCommitSha: string;
  status: ApplicationStatus;
  updatedAt: string;
  environmentId: number | null;
  projectUuid: string | null;
  projectName: string | null;
};

export type ProjectEnvironment = { id: number; name: string };

export type Project = {
  id: number;
  uuid: string;
  name: string;
  environments: ProjectEnvironment[];
};

export type Deployment = {
  uuid: string;
  applicationUuid?: string;
  applicationName: string;
  status: DeploymentStatus;
  commit: string;
  commitMessage: string;
  createdAt: string;
  updatedAt: string;
  projectUuid: string | null;
  projectName: string | null;
};

export type DeploymentLogs = {
  lines: DeploymentLogLine[];
  refreshedAt: string;
};

export type EnvironmentVariable = {
  uuid?: string;
  key: string;
  value: string;
  isPreview: boolean;
  isBuildTime: boolean;
  isLiteral: boolean;
  isMultiline: boolean;
};

export type OverviewData = {
  applications: Application[];
  projects: Project[];
  instanceName: string;
  refreshedAt: string;
};

export type ApiMessage = {
  message: string;
};

export type HealthCheck = {
  enabled: boolean;
  path: string;
  port: string;
  host: string;
  method: string;
  scheme: string;
  returnCode: number;
  responseText: string;
  interval: number;
  timeout: number;
  retries: number;
  startPeriod: number;
};

// Client-safe view of an application. Built only by lib/app-details.ts.
export type AppDetails = {
  uuid: string;
  name: string;
  description: string;
  status: string;
  buildPack: string;
  repository: string;
  branch: string;
  domains: string[];
  redirect: string;
  forceHttps: boolean;
  portsExposes: string;
  portsMappings: string | null;
  installCommand: string;
  buildCommand: string;
  startCommand: string;
  baseDirectory: string;
  publishDirectory: string;
  watchPaths: string;
  customDockerRunOptions: string | null;
  preDeploymentCommand: string;
  preDeploymentCommandContainer: string;
  postDeploymentCommand: string;
  postDeploymentCommandContainer: string;
  autoDeploy: boolean;
  dockerImagesToKeep: number;
  healthCheck: HealthCheck;
};

export type DeploymentLogLine = {
  timestamp: string;
  message: string;
  kind: "step" | "output";
  tone: "default" | "error" | "warning";
};

export type AppLogLine = { timestamp: string; message: string };

export type Allocation = { cpu: number; memoryMb: number };

export type UsagePoint = [number, number];

export type AppUsage = {
  uuid: string;
  name: string;
  cpuCores: number;
  memoryBytes: number;
  allocation: Allocation | null;
};

export type AppMetrics = {
  current: { cpuCores: number; memoryBytes: number; networkRxBps: number; networkTxBps: number };
  allocation: Allocation | null;
  series: { cpuCores: UsagePoint[]; memoryBytes: UsagePoint[]; networkRxBps: UsagePoint[]; networkTxBps: UsagePoint[] };
};

export type DatabaseUsage = { name: string; sizeBytes: number; connections: number };

export type UsageSummary = {
  apps: AppUsage[];
  databases: DatabaseUsage[];
  totals: { cpuCores: number; memoryBytes: number; allocatedCpu: number; allocatedMemoryMb: number };
};

export type DatabasePlan = { cpu: number | null; memoryMb: number | null; storageGb: number | null };

// One registered Postgres cluster as the browser sees it (no server, port or unit names).
export type DatabaseListItem = {
  id: string;
  name: string;
  engine: string;
  hasReplica: boolean;
  plan: DatabasePlan;
  up: boolean | null;
  version: string | null;
  storageBytes: number;
  connections: number;
  maxConnections: number | null;
};

export type DatabaseDetailData = DatabaseListItem & {
  databases: { name: string; sizeBytes: number; connections: number }[];
  replica: { up: boolean | null; lagSeconds: number | null } | null;
  refreshedAt: string;
};
