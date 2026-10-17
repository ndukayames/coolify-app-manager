import { createHash, createHmac, randomUUID } from "node:crypto";

// Client for db-agent (github.com/Codeva-Co/db-agent), one per DB server, reached over Tailscale.
// Servers are configured in DB_AGENT_SERVERS as JSON keyed by the Prometheus `server` label,
// e.g. {"pisi-db": {"url": "http://100.85.117.55:9300", "secret": "<64 hex>"}}.
// Requests are signed exactly as dbagent/auth.py expects.

type AgentServer = { url: string; secret: string };

const servers = (): Record<string, AgentServer> => {
  try {
    return JSON.parse(process.env.DB_AGENT_SERVERS ?? "{}") as Record<string, AgentServer>;
  } catch {
    throw new Error("DB_AGENT_SERVERS is not valid JSON.");
  }
};

export class AgentUnavailableError extends Error {}

export const hasAgent = (server: string): boolean => server in servers();

export const agentRequest = async <T>(server: string, method: "GET" | "POST", path: string, payload?: unknown): Promise<T> => {
  const target = servers()[server];
  if (!target) throw new AgentUnavailableError(`No db-agent configured for ${server}.`);

  const body = payload === undefined ? "" : JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomUUID();
  const signature = createHmac("sha256", target.secret)
    .update([method, path, timestamp, nonce, createHash("sha256").update(body).digest("hex")].join("\n"))
    .digest("hex");

  let response: Response;
  try {
    response = await fetch(`${target.url}${path}`, {
      method,
      cache: "no-store",
      body: body || undefined,
      headers: {
        "Content-Type": "application/json",
        "X-Agent-Timestamp": timestamp,
        "X-Agent-Nonce": nonce,
        "X-Agent-Signature": signature,
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new AgentUnavailableError(`db-agent on ${server} unreachable: ${(error as Error).message}`);
  }
  if (!response.ok) throw new AgentUnavailableError(`db-agent on ${server} returned ${response.status}.`);
  return (await response.json()) as T;
};

// Shape returned by GET /v1/clusters/<id> (stage 1).
export type AgentCluster = {
  cluster: string;
  postgres: {
    version: string;
    is_standby: boolean;
    parameters: {
      name: string;
      setting: string;
      unit: string | null;
      context: string;
      source: string;
      pending_restart: boolean;
      min: string | null;
      max: string | null;
      applies: "reload" | "restart";
    }[];
    database_overrides: { database: string; name: string; value: string }[];
  };
  pgbouncer: Record<string, string> | null;
  limits: { ActiveState: string; MemoryHigh: string; MemoryMax: string; CPUQuotaPerSecUSec: string };
};
