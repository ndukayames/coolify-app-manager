// Server-side access to Prometheus and Loki through Grafana's datasource proxy.
// Every query takes an optional `token`: a client's own Grafana org service-account token when
// one is set (tenant.grafanaToken), else the instance-wide GRAFANA_TOKEN. Either can still read
// every client's series (all orgs point at the same Prometheus/Loki), so callers must only pass
// selectors built from resources already confirmed to belong to the signed-in tenant.

export type GrafanaToken = string | null | undefined;

type DatasourceType = "prometheus" | "loki";

export const getGrafanaConfig = (override?: GrafanaToken) => {
  const url = process.env.GRAFANA_URL?.replace(/\/$/, "");
  const token = override || process.env.GRAFANA_TOKEN;
  if (!url || !token) throw new Error("GRAFANA_URL and GRAFANA_TOKEN must be set.");
  return { url, token };
};

const grafanaFetch = async <T>(path: string, override?: GrafanaToken): Promise<T> => {
  const { url, token } = getGrafanaConfig(override);
  const response = await fetch(`${url}${path}`, {
    cache: "no-store",
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`Grafana ${path.split("?")[0]} returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  return (await response.json()) as T;
};

// Datasource UIDs differ per Grafana org, so they are cached per token.
const datasourceUids = new Map<string, Partial<Record<DatasourceType, string>>>();

const getDatasourceUid = async (type: DatasourceType, override?: GrafanaToken): Promise<string> => {
  const key = override || "";
  let uids = datasourceUids.get(key);
  if (!uids) {
    const datasources = await grafanaFetch<{ uid: string; type: string }[]>("/api/datasources", override);
    uids = {};
    for (const datasource of datasources) {
      if ((datasource.type === "prometheus" || datasource.type === "loki") && !uids[datasource.type]) {
        uids[datasource.type] = datasource.uid;
      }
    }
    datasourceUids.set(key, uids);
  }
  const uid = uids[type];
  if (!uid) throw new Error(`No ${type} datasource found in Grafana.`);
  return uid;
};

const proxy = async (type: DatasourceType, path: string, params: Record<string, string>, override?: GrafanaToken) =>
  grafanaFetch<{ data: unknown }>(
    `/api/datasources/proxy/uid/${await getDatasourceUid(type, override)}${path}?${new URLSearchParams(params)}`,
    override,
  );

// Coolify resource UUIDs are lowercase alphanumeric. Anything else is rejected before it can
// reach a PromQL/LogQL selector, so a crafted value cannot widen the query.
export const assertResourceUuid = (uuid: string): string => {
  if (!/^[a-z0-9]{8,64}$/.test(uuid)) throw new Error(`Invalid resource uuid: ${uuid}`);
  return uuid;
};

export type PromVector = { metric: Record<string, string>; value: [number, string] }[];
export type PromMatrix = { metric: Record<string, string>; values: [number, string][] }[];

export const promQuery = async (query: string, token?: GrafanaToken): Promise<PromVector> =>
  ((await proxy("prometheus", "/api/v1/query", { query }, token)).data as { result: PromVector }).result;

export const promQueryRange = async (
  query: string,
  start: number,
  end: number,
  step: number,
  token?: GrafanaToken,
): Promise<PromMatrix> => {
  const body = await proxy("prometheus", "/api/v1/query_range", {
    query,
    start: String(start),
    end: String(end),
    step: String(step),
  }, token);
  return (body.data as { result: PromMatrix }).result;
};

export type LokiEntry = { timestamp: string; line: string };

export const lokiQueryRange = async (
  query: string,
  { start, end, limit }: { start: number; end: number; limit: number },
  token?: GrafanaToken,
): Promise<LokiEntry[]> => {
  const body = await proxy("loki", "/loki/api/v1/query_range", {
    query,
    start: `${start}000000000`,
    end: `${end}000000000`,
    limit: String(limit),
    direction: "backward",
  }, token);
  const streams = (body.data as { result: { values: [string, string][] }[] }).result;
  return streams
    .flatMap((stream) => stream.values.map(([timestamp, line]) => ({ timestamp, line })))
    .sort((left, right) => (left.timestamp < right.timestamp ? 1 : -1))
    .slice(0, limit);
};

export const getLokiDatasourceUid = (token?: GrafanaToken): Promise<string> => getDatasourceUid("loki", token);
