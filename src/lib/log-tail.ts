// Live log streaming via Loki's tail websocket, through Grafana's datasource proxy.
// Loki limits concurrent tails (10 by default), so viewers of the same query share one
// upstream socket; it closes when the last viewer leaves.

import { getGrafanaConfig, getLokiDatasourceUid, type GrafanaToken } from "@/lib/grafana";

export type TailLine = { timestamp: string; message: string };
type Listener = (lines: TailLine[]) => void;

type Hub = { socket: WebSocket | null; listeners: Set<Listener>; closing: boolean };
const hubs = new Map<string, Hub>();

const open = async (query: string, hub: Hub, override: GrafanaToken) => {
  const config = getGrafanaConfig(override);
  const url = config.url.replace(/^http/, "ws");
  const token = config.token;

  const uid = await getLokiDatasourceUid(override);
  const params = new URLSearchParams({ query, limit: "100" });
  // Node's WebSocket (undici) accepts headers; browsers' does not, which is fine here.
  const socket = new WebSocket(`${url}/api/datasources/proxy/uid/${uid}/loki/api/v1/tail?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  } as unknown as string[]);
  hub.socket = socket;

  socket.onmessage = (event) => {
    const body = JSON.parse(String(event.data)) as { streams?: { values: [string, string][] }[] };
    const lines = (body.streams ?? [])
      .flatMap((stream) => stream.values.map(([timestamp, message]) => ({
        timestamp: new Date(Number(timestamp.slice(0, 13))).toISOString(),
        message,
      })))
      .sort((left, right) => (left.timestamp < right.timestamp ? -1 : 1));
    if (lines.length) for (const listener of hub.listeners) listener(lines);
  };
  socket.onclose = () => {
    hub.socket = null;
    // Unexpected drop while viewers remain: reconnect after a short pause.
    if (!hub.closing && hub.listeners.size) setTimeout(() => void open(query, hub, override).catch(() => undefined), 2_000);
  };
  socket.onerror = () => console.error("Loki tail socket error");
};

export const subscribeTail = async (query: string, listener: Listener, token?: GrafanaToken): Promise<() => void> => {
  // Keyed by token too: different Grafana orgs must not share a socket.
  const key = `${token ?? ""}\n${query}`;
  let hub = hubs.get(key);
  if (!hub) {
    hub = { socket: null, listeners: new Set(), closing: false };
    hubs.set(key, hub);
    hub.listeners.add(listener);
    await open(query, hub, token);
  } else {
    hub.listeners.add(listener);
  }

  const current = hub;
  return () => {
    current.listeners.delete(listener);
    if (!current.listeners.size) {
      current.closing = true;
      current.socket?.close();
      hubs.delete(key);
    }
  };
};
