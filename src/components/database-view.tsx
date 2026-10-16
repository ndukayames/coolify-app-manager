"use client";

import { ArrowLeft as arrowLeft, Database as databaseIcon } from "lucide-react";
import useSWR from "swr";
import { formatBytes } from "@/components/usage-bits";
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
            </dl>
            <p className="database-plan">{planText(item)}</p>
          </button>
        );
      })}
    </div>
  );
}

const formatLag = (seconds: number | null): string => {
  if (seconds === null) return "Unknown";
  if (seconds < 1) return "Up to date";
  if (seconds < 60) return `${Math.round(seconds)}s behind`;
  return `${Math.round(seconds / 60)}m behind`;
};

export function DatabaseView({ id, onBack }: { id: string; onBack: () => void }) {
  const Back = arrowLeft;
  const { data, error } = useSWR<DatabaseDetailData>(`/api/databases/${id}`, fetcher, { refreshInterval: 60_000 });

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

      {error ? <div className="page-error"><div><strong>Could not load this database</strong><span>{error.message}</span></div></div> : null}

      {data ? (
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
              <span className="utility-label">CPU · Memory</span>
              <div className="usage-value">
                <strong>{data.plan.cpu ? `${data.plan.cpu} vCPU` : "—"}</strong>
                <small>{data.plan.memoryMb ? formatBytes(data.plan.memoryMb * 1024 * 1024) : ""}</small>
              </div>
              <small className="muted-inline">Live CPU and memory usage is coming soon.</small>
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
