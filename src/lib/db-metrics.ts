import type { TenantDatabase } from "@/lib/databases";
import { promQuery, type GrafanaToken, type PromVector } from "@/lib/grafana";

// Cluster figures from postgres_exporter. Selectors are built only from the stored row's
// validated fields (lib/databases.ts), never from request input, and always pin both the
// `server` and `instance` labels: cluster names like "16-main" repeat across servers.

const systemDatabases = `datname!~"postgres|template0|template1"`;

const selector = (server: string, instance: string) => `server="${server}", instance="${instance}"`;

const scalar = (vector: PromVector): number | null => (vector.length ? Number(vector[0].value[1]) : null);

export type DatabaseSummary = {
  up: boolean | null;
  version: string | null;
  storageBytes: number;
  connections: number;
  maxConnections: number | null;
};

export const getDatabaseSummary = async (database: TenantDatabase, token?: GrafanaToken): Promise<DatabaseSummary> => {
  const target = selector(database.server, database.exporterInstance);
  const [up, version, storage, connections, maxConnections] = await Promise.all([
    promQuery(`max(pg_up{${target}})`, token),
    promQuery(`pg_static{${target}}`, token),
    promQuery(`sum(pg_database_size_bytes{${target}, ${systemDatabases}})`, token),
    promQuery(`sum(pg_stat_database_numbackends{${target}})`, token),
    promQuery(`max(pg_settings_max_connections{${target}})`, token),
  ]);
  const upValue = scalar(up);
  return {
    up: upValue === null ? null : upValue === 1,
    version: version[0]?.metric.short_version?.replace(/\.0$/, "") ?? null,
    storageBytes: scalar(storage) ?? 0,
    connections: scalar(connections) ?? 0,
    maxConnections: scalar(maxConnections),
  };
};

export type DatabaseDetail = DatabaseSummary & {
  databases: { name: string; sizeBytes: number; connections: number }[];
  replica: { up: boolean | null; lagSeconds: number | null } | null;
};

export const getDatabaseDetail = async (database: TenantDatabase, token?: GrafanaToken): Promise<DatabaseDetail> => {
  const target = selector(database.server, database.exporterInstance);
  const replicaTarget = database.replicaServer && database.replicaInstance
    ? selector(database.replicaServer, database.replicaInstance)
    : null;

  const [summary, sizes, connections, replicaUp, replicaLag] = await Promise.all([
    getDatabaseSummary(database, token),
    promQuery(`sum by (datname) (pg_database_size_bytes{${target}, ${systemDatabases}})`, token),
    promQuery(`sum by (datname) (pg_stat_database_numbackends{${target}, ${systemDatabases}})`, token),
    replicaTarget ? promQuery(`max(pg_up{${replicaTarget}})`, token) : Promise.resolve([] as PromVector),
    replicaTarget ? promQuery(`max(pg_replication_lag_seconds{${replicaTarget}})`, token) : Promise.resolve([] as PromVector),
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
  };
};
