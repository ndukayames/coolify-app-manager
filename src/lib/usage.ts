import { listTenantDatabases } from "@/lib/databases";
import { getDatabaseSummary } from "@/lib/db-metrics";
import { assertResourceUuid, promQuery, promQueryRange, type PromMatrix, type PromVector } from "@/lib/grafana";
import type { Tenant } from "@/lib/tenants";
import { getAllocations } from "@/lib/tenants";
import type { AppMetrics, AppUsage, DatabaseUsage, UsagePoint, UsageSummary } from "@/lib/types";

// Usage is measured per container, never per host: clients see what their services consume,
// not the servers they share. Every selector is built from app UUIDs or registered clusters
// that were already confirmed to belong to the tenant.

const appSelector = (uuids: string[]) =>
  `container_label_coolify_name=~"${uuids.map(assertResourceUuid).join("|")}"`;

const byApp = (vector: PromVector): Map<string, number> =>
  new Map(vector.map((sample) => [sample.metric.container_label_coolify_name, Number(sample.value[1])]));

export const getUsageSummary = async (
  tenant: Tenant,
  apps: { uuid: string; name: string }[],
): Promise<UsageSummary> => {
  const allocations = getAllocations(tenant.id);
  const clusters = listTenantDatabases(tenant.id);

  const [cpu, memory, clusterSummaries] = await Promise.all([
    apps.length
      ? promQuery(`sum by (container_label_coolify_name) (rate(container_cpu_usage_seconds_total{${appSelector(apps.map((app) => app.uuid))}}[5m]))`, tenant.grafanaToken)
      : Promise.resolve([] as PromVector),
    apps.length
      ? promQuery(`sum by (container_label_coolify_name) (container_memory_working_set_bytes{${appSelector(apps.map((app) => app.uuid))}})`, tenant.grafanaToken)
      : Promise.resolve([] as PromVector),
    // One row per registered cluster (lib/databases.ts), using the same queries as the Databases page.
    Promise.all(clusters.map((cluster) => getDatabaseSummary(cluster, tenant.grafanaToken))),
  ]);

  const cpuByApp = byApp(cpu);
  const memoryByApp = byApp(memory);
  const usage: AppUsage[] = apps.map((app) => ({
    uuid: app.uuid,
    name: app.name,
    cpuCores: cpuByApp.get(app.uuid) ?? 0,
    memoryBytes: memoryByApp.get(app.uuid) ?? 0,
    allocation: allocations.get(app.uuid) ?? null,
  }));

  const databases: DatabaseUsage[] = clusters
    .map((cluster, index) => ({
      name: cluster.displayName,
      sizeBytes: clusterSummaries[index].storageBytes,
      connections: clusterSummaries[index].connections,
    }))
    .sort((left, right) => right.sizeBytes - left.sizeBytes);

  return {
    apps: usage,
    databases,
    totals: {
      cpuCores: usage.reduce((sum, app) => sum + app.cpuCores, 0),
      memoryBytes: usage.reduce((sum, app) => sum + app.memoryBytes, 0),
      allocatedCpu: usage.reduce((sum, app) => sum + (app.allocation?.cpu ?? 0), 0),
      allocatedMemoryMb: usage.reduce((sum, app) => sum + (app.allocation?.memoryMb ?? 0), 0),
    },
  };
};

export const metricRanges = { "1h": 3600, "6h": 21600, "24h": 86400, "7d": 604800 } as const;
export type MetricRange = keyof typeof metricRanges;

const toPoints = (matrix: PromMatrix): UsagePoint[] => {
  // Summed per timestamp, so a rolling deploy's two containers count once as the app.
  const totals = new Map<number, number>();
  for (const series of matrix) {
    for (const [timestamp, value] of series.values) totals.set(timestamp, (totals.get(timestamp) ?? 0) + Number(value));
  }
  return [...totals.entries()].sort((left, right) => left[0] - right[0]);
};

export const getAppMetrics = async (tenant: Tenant, uuid: string, range: MetricRange): Promise<AppMetrics> => {
  const selector = appSelector([uuid]);
  const end = Math.floor(Date.now() / 1000);
  const start = end - metricRanges[range];
  const step = Math.max(30, Math.floor(metricRanges[range] / 240));
  const window = step >= 300 ? `${step}s` : "5m";

  const queries = {
    cpuCores: `sum(rate(container_cpu_usage_seconds_total{${selector}}[${window}]))`,
    memoryBytes: `sum(container_memory_working_set_bytes{${selector}})`,
    networkRxBps: `sum(rate(container_network_receive_bytes_total{${selector}}[${window}]))`,
    networkTxBps: `sum(rate(container_network_transmit_bytes_total{${selector}}[${window}]))`,
  };

  const [cpuCores, memoryBytes, networkRxBps, networkTxBps] = await Promise.all(
    Object.values(queries).map((query) => promQueryRange(query, start, end, step, tenant.grafanaToken).then(toPoints)),
  );
  const last = (points: UsagePoint[]) => points.at(-1)?.[1] ?? 0;

  return {
    current: {
      cpuCores: last(cpuCores),
      memoryBytes: last(memoryBytes),
      networkRxBps: last(networkRxBps),
      networkTxBps: last(networkTxBps),
    },
    allocation: getAllocations(tenant.id).get(uuid) ?? null,
    series: { cpuCores, memoryBytes, networkRxBps, networkTxBps },
  };
};
