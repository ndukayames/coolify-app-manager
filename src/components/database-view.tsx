"use client";

import { ArrowLeft as arrowLeft, Database as databaseIcon } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import { formatBytes, formatCores, Sparkline } from "@/components/usage-bits";
import type { ApiMessage, DatabaseDetailData, DatabaseListItem } from "@/lib/types";

const fetcher = async <T,>(url: string): Promise<T> => {
  const response = await fetch(url);
  const body = (await response.json()) as T & ApiMessage;
  if (response.status === 401) window.location.reload();
  if (!response.ok) throw new Error(body.message ?? "The request failed.");
  return body;
};

function StatusPill({ up }: { up: boolean | null }) {
  const label = up === null ? "Unknown" : up ? "Available" : "Unavailable";
  const tone = up === null ? "unknown" : up ? "running" : "failed";
  return <span className={`status-badge status-${tone}`}><span className="status-dot" />{label}</span>;
}

const planText = (item: DatabaseListItem): string => {
  const parts = [
    item.plan.cpu ? `${item.plan.cpu} vCPU` : null,
    item.plan.memoryMb ? formatBytes(item.plan.memoryMb * 1024 * 1024) : null,
    item.plan.storageGb ? `${item.plan.storageGb} GB storage` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "No plan recorded";
};

function Meter({ used, total }: { used: number; total: number | null }) {
  if (!total) return null;
  const ratio = used / total;
  return (
    <div className="usage-meter">
      <span className={ratio > 1 ? "over" : ratio > 0.8 ? "high" : ""} style={{ width: `${Math.min(ratio, 1) * 100}%` }} />
    </div>
  );
}

export function DatabaseList({ databases, onOpen }: { databases: DatabaseListItem[]; onOpen: (id: string) => void }) {
  const DbIcon = databaseIcon;

  if (!databases.length) {
    return (
      <div className="empty-state">
        <span className="empty-state-mark" />
        <strong>No databases yet</strong>
        <p>Databases Codeva manages for you will appear here.</p>
      </div>
    );
  }

  return (
    <div className="database-grid">
      {databases.map((item) => {
        const storageLimit = item.plan.storageGb ? item.plan.storageGb * 1024 ** 3 : null;
        return (
          <button className="database-card" onClick={() => onOpen(item.id)} key={item.id}>
            <div className="database-card-head">
              <span className="database-icon"><DbIcon size={16} /></span>
              <div>
                <strong>{item.name}</strong>
                <small>PostgreSQL {item.version ?? ""}{item.hasReplica ? " · with standby replica" : ""}</small>
              </div>
              <StatusPill up={item.up} />
            </div>
            <dl className="database-stats">
              <div>
                <dt>Storage</dt>
                <dd>{formatBytes(item.storageBytes)}{storageLimit ? <small> of {item.plan.storageGb} GB</small> : null}</dd>
                <Meter used={item.storageBytes} total={storageLimit} />
              </div>
              <div>
                <dt>Connections</dt>
                <dd>{item.connections}{item.maxConnections ? <small> of {item.maxConnections}</small> : null}</dd>
                <Meter used={item.connections} total={item.maxConnections} />
              </div>
              <div>
                <dt>CPU</dt>
                <dd>{item.cpuCores === null ? "—" : formatCores(item.cpuCores)}{item.plan.cpu ? <small> of {formatCores(item.plan.cpu)}</small> : null}</dd>
                <Meter used={item.cpuCores ?? 0} total={item.plan.cpu} />
              </div>
              <div>
                <dt>Memory</dt>
                <dd>{item.memoryBytes === null ? "—" : formatBytes(item.memoryBytes)}{item.plan.memoryMb ? <small> of {formatBytes(item.plan.memoryMb * 1024 * 1024)}</small> : null}</dd>
                <Meter used={item.memoryBytes ?? 0} total={item.plan.memoryMb ? item.plan.memoryMb * 1024 * 1024 : null} />
              </div>
            </dl>
            <p className="database-plan">{planText(item)}</p>
          </button>
        );
      })}
    </div>
  );
}

// "Database 12.60 GB · connection pooler 20 MB": usage is the sum of both services.
const splitText = (
  postgres: number | null,
  pgbouncer: number | null | undefined,
  format: (value: number) => string,
): string => {
  if (postgres === null) return "Usage data isn't available for this database yet.";
  const parts = [`Database ${format(postgres)}`];
  if (pgbouncer !== undefined && pgbouncer !== null) parts.push(`connection pooler ${format(pgbouncer)}`);
  return parts.join(" · ");
};

const formatLag = (seconds: number | null): string => {
  if (seconds === null) return "Unknown";
  if (seconds < 1) return "Up to date";
  if (seconds < 60) return `${Math.round(seconds)}s behind`;
  return `${Math.round(seconds / 60)}m behind`;
};

export function DatabaseView({ id, onBack }: { id: string; onBack: () => void }) {
  const Back = arrowLeft;
  const { data, error } = useSWR<DatabaseDetailData>(`/api/databases/${id}`, fetcher, { refreshInterval: 60_000 });
  const [tab, setTab] = useState<"overview" | "settings">("overview");

  return (
    <section className="app-view">
      <header className="app-view-header">
        <button className="icon-button" onClick={onBack} aria-label="Back to databases"><Back size={16} /></button>
        <div className="app-view-title">
          <div className="app-name-line">
            <h2>{data?.name ?? "Database"}</h2>
            {data ? <StatusPill up={data.up} /> : null}
          </div>
          <p>{data ? `PostgreSQL ${data.version ?? ""} · ${planText(data)}` : "Loading…"}</p>
        </div>
      </header>

      <nav className="tab-bar" aria-label="Database sections">
        <button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>Overview</button>
        <button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}>Settings</button>
      </nav>

      {error ? <div className="page-error"><div><strong>Could not load this database</strong><span>{error.message}</span></div></div> : null}

      {tab === "settings" ? <SettingsTab id={id} /> : null}

      {data && tab === "overview" ? (
        <div className="app-tab">
          <div className="usage-grid database-overview-grid">
            <div className="usage-card">
              <span className="utility-label">Storage</span>
              <div className="usage-value">
                <strong>{formatBytes(data.storageBytes)}</strong>
                {data.plan.storageGb ? <small>of {data.plan.storageGb} GB</small> : null}
              </div>
              <Meter used={data.storageBytes} total={data.plan.storageGb ? data.plan.storageGb * 1024 ** 3 : null} />
            </div>
            <div className="usage-card">
              <span className="utility-label">Connections</span>
              <div className="usage-value">
                <strong>{data.connections}</strong>
                {data.maxConnections ? <small>of {data.maxConnections} max</small> : null}
              </div>
              <Meter used={data.connections} total={data.maxConnections} />
            </div>
            <div className="usage-card">
              <span className="utility-label">CPU</span>
              <div className="usage-value">
                <strong>{data.cpuCores === null ? "—" : formatCores(data.cpuCores)}</strong>
                {data.plan.cpu ? <small>of {formatCores(data.plan.cpu)}</small> : null}
              </div>
              <Meter used={data.cpuCores ?? 0} total={data.plan.cpu} />
              <Sparkline points={data.series.cpuCores} />
              <small className="muted-inline">{splitText(data.breakdown.postgres.cpuCores, data.breakdown.pgbouncer?.cpuCores, formatCores)}</small>
            </div>
            <div className="usage-card">
              <span className="utility-label">Memory</span>
              <div className="usage-value">
                <strong>{data.memoryBytes === null ? "—" : formatBytes(data.memoryBytes)}</strong>
                {data.plan.memoryMb ? <small>of {formatBytes(data.plan.memoryMb * 1024 * 1024)}</small> : null}
              </div>
              <Meter used={data.memoryBytes ?? 0} total={data.plan.memoryMb ? data.plan.memoryMb * 1024 * 1024 : null} />
              <Sparkline points={data.series.memoryBytes} />
              <small className="muted-inline">{splitText(data.breakdown.postgres.memoryBytes, data.breakdown.pgbouncer?.memoryBytes, formatBytes)}</small>
            </div>
            {data.replica ? (
              <div className="usage-card">
                <span className="utility-label">Standby replica</span>
                <div className="usage-value"><strong>{data.replica.up ? formatLag(data.replica.lagSeconds) : "Unavailable"}</strong></div>
                <small className="muted-inline">Hot standby, kept in sync continuously.</small>
              </div>
            ) : null}
          </div>

          <div className="panel-heading"><div><h3>Databases</h3><p>{data.databases.length} in this instance</p></div></div>
          <div className="usage-table db-table" role="table">
            <div className="usage-row usage-row-db usage-head" role="row"><span>Name</span><span>Size</span><span>Connections</span></div>
            {data.databases.map((item) => (
              <div className="usage-row usage-row-db" role="row" key={item.name}>
                <span className="usage-name">{item.name}</span>
                <span>{formatBytes(item.sizeBytes)}</span>
                <span>{item.connections}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

type SettingsView =
  | { available: false; message: string }
  | {
    available: true;
    isStandby: boolean;
    parameters: { name: string; label: string; description: string; group: string; value: string; applies: "reload" | "restart"; pendingRestart: boolean; customized: boolean }[];
    overrides: { database: string; label: string; value: string }[];
    pool: { key: string; label: string; description: string; value: string }[] | null;
    memoryLimit: string | null;
  };

const settingGroups = ["Timeouts & logging", "Memory", "Connections & parallelism"];

// Read-only for now; editing arrives with the agent's write stages.
function SettingsTab({ id }: { id: string }) {
  const { data, error } = useSWR<SettingsView>(`/api/databases/${id}/settings`, fetcher);

  if (error) return <div className="page-error"><div><strong>Settings could not be loaded</strong><span>{error.message}</span></div></div>;
  if (!data) return <p className="muted-note settings-loading">Loading settings…</p>;
  if (!data.available) return <p className="muted-note settings-loading">{data.message}</p>;

  const pending = data.parameters.filter((parameter) => parameter.pendingRestart);

  return (
    <div className="app-tab">
      {pending.length ? (
        <div className="settings-banner">
          {pending.length} setting{pending.length === 1 ? "" : "s"} will apply on the next restart: {pending.map((parameter) => parameter.label).join(", ")}.
        </div>
      ) : null}

      {settingGroups.map((group) => {
        const rows = data.parameters.filter((parameter) => parameter.group === group);
        if (!rows.length) return null;
        return (
          <section key={group}>
            <div className="panel-heading"><div><h3>{group}</h3></div></div>
            <div className="usage-table db-table">
              {rows.map((parameter) => (
                <div className="usage-row settings-row" key={parameter.name}>
                  <span className="settings-name">
                    <strong>{parameter.label}</strong>
                    <small>{parameter.description}</small>
                  </span>
                  <span className="settings-value">{parameter.value}</span>
                  <span className="settings-applies">
                    {parameter.pendingRestart
                      ? <span className="status-badge status-queued">Pending restart</span>
                      : <small>{parameter.applies === "restart" ? "Applies on restart" : "Applies immediately"}</small>}
                  </span>
                </div>
              ))}
            </div>
          </section>
        );
      })}

      {data.overrides.length ? (
        <section>
          <div className="panel-heading"><div><h3>Per-database overrides</h3><p>Settings that differ for a specific database</p></div></div>
          <div className="usage-table db-table">
            {data.overrides.map((override) => (
              <div className="usage-row settings-row" key={`${override.database}-${override.label}`}>
                <span className="settings-name"><strong>{override.database}</strong><small>{override.label}</small></span>
                <span className="settings-value">{override.value}</span>
                <span />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {data.pool ? (
        <section>
          <div className="panel-heading"><div><h3>Connection pool</h3><p>PgBouncer, in front of the database</p></div></div>
          <div className="usage-table db-table">
            {data.pool.map((setting) => (
              <div className="usage-row settings-row" key={setting.key}>
                <span className="settings-name"><strong>{setting.label}</strong><small>{setting.description}</small></span>
                <span className="settings-value">{setting.value}</span>
                <span />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <p className="muted-note settings-footnote">
        {data.isStandby ? "This is a standby replica. " : ""}
        Memory limit: {data.memoryLimit ?? "not set"}. Changing settings from the console is coming soon.
      </p>
    </div>
  );
}
