import type { AgentCluster } from "@/lib/db-agent";

// Client-facing names and formatting for the parameters db-agent reports. Kept in step with
// dbagent/allowlist.py; anything the agent returns that isn't listed here is not shown.

export type ParameterInfo = { label: string; description: string; group: "Timeouts & logging" | "Memory" | "Connections & parallelism" };

export const parameterInfo: Record<string, ParameterInfo> = {
  statement_timeout: { label: "Statement timeout", description: "Cancel any query running longer than this. 0 = no limit.", group: "Timeouts & logging" },
  idle_in_transaction_session_timeout: { label: "Idle-in-transaction timeout", description: "Close sessions left idle inside an open transaction.", group: "Timeouts & logging" },
  idle_session_timeout: { label: "Idle session timeout", description: "Close sessions idle (outside a transaction) for this long.", group: "Timeouts & logging" },
  lock_timeout: { label: "Lock timeout", description: "Give up waiting for a lock after this long.", group: "Timeouts & logging" },
  log_min_duration_statement: { label: "Slow query logging", description: "Log queries slower than this. -1 = off.", group: "Timeouts & logging" },
  timezone: { label: "Time zone", description: "Default time zone for sessions.", group: "Timeouts & logging" },
  shared_buffers: { label: "Shared buffers", description: "Memory Postgres keeps for caching data pages.", group: "Memory" },
  work_mem: { label: "Work memory", description: "Memory per sort or hash step in a query, before spilling to disk.", group: "Memory" },
  maintenance_work_mem: { label: "Maintenance memory", description: "Memory for VACUUM, CREATE INDEX and similar.", group: "Memory" },
  effective_cache_size: { label: "Effective cache size", description: "Planner's estimate of total cache available.", group: "Memory" },
  max_connections: { label: "Max connections", description: "Most concurrent connections the database accepts.", group: "Connections & parallelism" },
  max_worker_processes: { label: "Max worker processes", description: "Background worker limit, including parallel workers.", group: "Connections & parallelism" },
  max_parallel_workers: { label: "Max parallel workers", description: "Total parallel workers across all queries.", group: "Connections & parallelism" },
  max_parallel_workers_per_gather: { label: "Parallel workers per query", description: "Parallel workers a single query step may use.", group: "Connections & parallelism" },
};

export const poolInfo: Record<string, { label: string; description: string }> = {
  pool_mode: { label: "Pool mode", description: "session: one server connection per client session. transaction: shared between transactions." },
  default_pool_size: { label: "Pool size", description: "Server connections per database/user pair." },
  reserve_pool_size: { label: "Reserve pool", description: "Extra connections allowed when the pool is exhausted." },
  min_pool_size: { label: "Minimum pool", description: "Server connections kept open even when idle." },
  max_client_conn: { label: "Max client connections", description: "Most app connections PgBouncer accepts." },
  max_db_connections: { label: "Max connections per database", description: "Cap on server connections per database. 0 = no cap." },
  server_idle_timeout: { label: "Server idle timeout", description: "Close server connections idle this long (seconds)." },
  query_wait_timeout: { label: "Query wait timeout", description: "Fail a query waiting this long for a free connection (seconds)." },
  idle_transaction_timeout: { label: "Idle transaction timeout", description: "Close client connections idle in a transaction this long (seconds)." },
};

const formatBytesFromKb = (kb: number): string => {
  if (kb >= 1024 * 1024) return `${Number((kb / 1024 / 1024).toFixed(2))} GB`;
  if (kb >= 1024) return `${Number((kb / 1024).toFixed(1))} MB`;
  return `${kb} kB`;
};

const formatDuration = (value: number, unit: "ms" | "s" | "min"): string => {
  const ms = unit === "ms" ? value : unit === "s" ? value * 1000 : value * 60_000;
  if (ms === 0) return "Off";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${Number((ms / 1000).toFixed(1))} s`;
  if (ms < 3_600_000) return `${Number((ms / 60_000).toFixed(1))} min`;
  return `${Number((ms / 3_600_000).toFixed(1))} h`;
};

// pg_settings reports memory in units like "8kB" or "kB", and durations in "ms", "s" or "min".
export const formatSetting = (name: string, setting: string, unit: string | null): string => {
  const numeric = Number(setting);
  if (name === "log_min_duration_statement" && numeric === -1) return "Off";
  if (unit && /^[0-9]*kB$/.test(unit) && Number.isFinite(numeric)) {
    const multiplier = Number(unit.replace("kB", "") || 1);
    return formatBytesFromKb(numeric * multiplier);
  }
  if ((unit === "ms" || unit === "s" || unit === "min") && Number.isFinite(numeric)) return formatDuration(numeric, unit);
  return setting;
};

export type DatabaseSettingsView = {
  available: true;
  isStandby: boolean;
  parameters: { name: string; label: string; description: string; group: string; value: string; applies: "reload" | "restart"; pendingRestart: boolean; customized: boolean }[];
  overrides: { database: string; label: string; value: string }[];
  pool: { key: string; label: string; description: string; value: string }[] | null;
  memoryLimit: string | null;
};

// Client-safe view of an agent response: friendly labels, formatted values, no paths or units.
export const toSettingsView = (raw: AgentCluster): DatabaseSettingsView => ({
  available: true,
  isStandby: raw.postgres.is_standby,
  parameters: raw.postgres.parameters
    .filter((parameter) => parameter.name in parameterInfo)
    .map((parameter) => ({
      name: parameter.name,
      ...parameterInfo[parameter.name],
      value: formatSetting(parameter.name, parameter.setting, parameter.unit),
      applies: parameter.applies,
      pendingRestart: parameter.pending_restart,
      // "default" means untouched; anything else was set in config by Codeva (or later, the client).
      customized: parameter.source !== "default",
    })),
  overrides: raw.postgres.database_overrides
    .filter((override) => override.name in parameterInfo)
    .map((override) => ({ database: override.database, label: parameterInfo[override.name].label, value: override.value })),
  pool: raw.pgbouncer
    ? Object.entries(raw.pgbouncer)
      .filter(([key]) => key in poolInfo)
      .map(([key, value]) => ({ key, ...poolInfo[key], value }))
    : null,
  memoryLimit: raw.limits.MemoryHigh && raw.limits.MemoryHigh !== "infinity"
    ? formatBytesFromKb(Number(raw.limits.MemoryHigh) / 1024)
    : null,
});
