import type { TenantDatabase } from "@/lib/databases";
import { promQuery, promQueryRange, type GrafanaToken, type PromMatrix, type PromVector } from "@/lib/grafana";

// Cluster figures from postgres_exporter and cAdvisor. Selectors are built only from the stored
// row's validated fields (lib/databases.ts), never from request input, and always pin the
// `server` label: cluster names like "16-main" repeat across servers.

const systemDatabases = `datname!~"postgres|template0|template1"`;

const selector = (server: string, instance: string) => `server="${server}", instance="${instance}"`;

const scalar = (vector: PromVector): number | null => (vector.length ? Number(vector[0].value[1]) : null);

// --- Resource usage (cAdvisor, "cadvisor-db" job) -------------------------------------------
// A client database is two systemd services on one server: the Postgres cluster
// (postgresql@<cluster>) and its PgBouncer. Both are summed into the client-facing figure.
// Memory is rss + mapped_file, i.e. the processes' private memory plus shared_buffers. It
// deliberately leaves out the OS file cache that working_set includes (verified against the
// kernel's memory.stat: anon + file_mapped).

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\\\$&");

const usageSelector = (database: TenantDatabase, which: "all" | "postgres" | "pgbouncer"): string => {
  const units = [
    which !== "pgbouncer" ? `postgresql@${escapeRegex(database.cluster)}` : null,
    which !== "postgres" && database.pgbouncerUnit ? escapeRegex(database.pgbouncerUnit) : null,
  ].filter(Boolean);
  return `job="cadvisor-db", server="${database.server}", unit=~"${units.join("|")}"`;
};

const cpuQuery = (target: string) => `sum(rate(container_cpu_usage_seconds_total{${target}}[5m]))`;
const memoryQuery = (target: string) =>
  `sum(container_memory_rss{${target}}) + sum(container_memory_mapped_file{${target}})`;

export type ResourceUsage = { cpuCores: number | null; memoryBytes: number | null };

const getUsage = async (target: string, token: GrafanaToken): Promise<ResourceUsage> => {
  const [cpu, memory] = await Promise.all([promQuery(cpuQuery(target), token), promQuery(memoryQuery(target), token)]);
  return { cpuCores: scalar(cpu), memoryBytes: scalar(memory) };
};

const toPoints = (matrix: PromMatrix): [number, number][] =>
  (matrix[0]?.values ?? []).map(([timestamp, value]) => [timestamp, Number(value)]);

// --- Summary (list cards) ---------------------------------------------------------------------

export type DatabaseSummary = {
  up: boolean | null;
  version: string | null;
  storageBytes: number;
  connections: number;
  maxConnections: number | null;
  // Null when there is no cAdvisor data for this database (e.g. its server isn't instrumented).
  cpuCores: number | null;
  memoryBytes: number | null;
};

export const getDatabaseSummary = async (database: TenantDatabase, token?: GrafanaToken): Promise<DatabaseSummary> => {
  const target = selector(database.server, database.exporterInstance);
  const [up, version, storage, connections, maxConnections, usage] = await Promise.all([
    promQuery(`max(pg_up{${target}})`, token),
    promQuery(`pg_static{${target}}`, token),
    promQuery(`sum(pg_database_size_bytes{${target}, ${systemDatabases}})`, token),
    promQuery(`sum(pg_stat_database_numbackends{${target}})`, token),
    promQuery(`max(pg_settings_max_connections{${target}})`, token),
    getUsage(usageSelector(database, "all"), token),
  ]);
  const upValue = scalar(up);
  return {
    up: upValue === null ? null : upValue === 1,
    version: version[0]?.metric.short_version?.replace(/\.0$/, "") ?? null,
    storageBytes: scalar(storage) ?? 0,
    connections: scalar(connections) ?? 0,
    maxConnections: scalar(maxConnections),
    cpuCores: usage.cpuCores,
    memoryBytes: usage.memoryBytes,
  };
};

// --- Detail (instance page) -------------------------------------------------------------------

export type DatabaseDetail = DatabaseSummary & {
  databases: { name: string; sizeBytes: number; connections: number }[];
  replica: { up: boolean | null; lagSeconds: number | null } | null;
  // How the combined usage splits between the database and its connection pooler.
  breakdown: { postgres: ResourceUsage; pgbouncer: ResourceUsage | null };
  // Last 6 hours, combined, for the charts.
  series: { cpuCores: [number, number][]; memoryBytes: [number, number][] };
};

export const getDatabaseDetail = async (database: TenantDatabase, token?: GrafanaToken): Promise<DatabaseDetail> => {
  const target = selector(database.server, database.exporterInstance);
  const replicaTarget = database.replicaServer && database.replicaInstance
    ? selector(database.replicaServer, database.replicaInstance)
    : null;
  const all = usageSelector(database, "all");
  const end = Math.floor(Date.now() / 1000);
  const start = end - 6 * 3600;

  const [summary, sizes, connections, replicaUp, replicaLag, postgresUsage, pgbouncerUsage, cpuSeries, memorySeries] =
    await Promise.all([
      getDatabaseSummary(database, token),
      promQuery(`sum by (datname) (pg_database_size_bytes{${target}, ${systemDatabases}})`, token),
      promQuery(`sum by (datname) (pg_stat_database_numbackends{${target}, ${systemDatabases}})`, token),
      replicaTarget ? promQuery(`max(pg_up{${replicaTarget}})`, token) : Promise.resolve([] as PromVector),
      replicaTarget ? promQuery(`max(pg_replication_lag_seconds{${replicaTarget}})`, token) : Promise.resolve([] as PromVector),
      getUsage(usageSelector(database, "postgres"), token),
      database.pgbouncerUnit ? getUsage(usageSelector(database, "pgbouncer"), token) : Promise.resolve(null),
      promQueryRange(cpuQuery(all), start, end, 120, token),
      promQueryRange(memoryQuery(all), start, end, 120, token),
    ]);

  const connectionsByDb = new Map(connections.map((sample) => [sample.metric.datname, Number(sample.value[1])]));
  const replicaUpValue = scalar(replicaUp);

  return {
    ...summary,
    databases: sizes
      .map((sample) => ({
        name: sample.metric.datname,
        sizeBytes: Number(sample.value[1]),
        connections: connectionsByDb.get(sample.metric.datname) ?? 0,
      }))
      .sort((left, right) => right.sizeBytes - left.sizeBytes),
    replica: replicaTarget
      ? { up: replicaUpValue === null ? null : replicaUpValue === 1, lagSeconds: scalar(replicaLag) }
      : null,
    breakdown: { postgres: postgresUsage, pgbouncer: pgbouncerUsage },
    series: { cpuCores: toPoints(cpuSeries), memoryBytes: toPoints(memorySeries) },
  };
};
