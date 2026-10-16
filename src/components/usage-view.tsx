"use client";

import useSWR from "swr";
import { formatBytes, formatCores } from "@/components/usage-bits";
import type { ApiMessage, UsageSummary } from "@/lib/types";

const fetcher = async <T,>(url: string): Promise<T> => {
  const response = await fetch(url);
  const body = (await response.json()) as T & ApiMessage;
  if (response.status === 401) window.location.reload();
  if (!response.ok) throw new Error(body.message ?? "The request failed.");
  return body;
};

const percent = (used: number, allocated: number) => (allocated ? `${Math.round((used / allocated) * 100)}%` : "—");

export function UsageView({ onOpenApp }: { onOpenApp: (uuid: string) => void }) {
  const { data, error, isLoading } = useSWR<UsageSummary>("/api/usage", fetcher, { refreshInterval: 60_000 });

  if (error) return <section className="page-error"><div><strong>Usage is unavailable</strong><span>{error.message}</span></div></section>;
  if (isLoading || !data) return <div className="skeleton skeleton-panel" />;

  const { totals } = data;
  const apps = [...data.apps].sort((left, right) => right.memoryBytes - left.memoryBytes);

  return (
    <div className="usage-page">
      <section className="usage-grid">
        <div className="usage-card">
          <span className="utility-label">Total CPU</span>
          <div className="usage-value"><strong>{formatCores(totals.cpuCores)}</strong>{totals.allocatedCpu ? <small>{formatCores(totals.allocatedCpu)} allocated</small> : null}</div>
        </div>
        <div className="usage-card">
          <span className="utility-label">Total memory</span>
          <div className="usage-value"><strong>{formatBytes(totals.memoryBytes)}</strong>{totals.allocatedMemoryMb ? <small>{formatBytes(totals.allocatedMemoryMb * 1024 * 1024)} allocated</small> : null}</div>
        </div>
        <div className="usage-card">
          <span className="utility-label">Applications</span>
          <div className="usage-value"><strong>{data.apps.length}</strong></div>
        </div>
        <div className="usage-card">
          <span className="utility-label">Database storage</span>
          <div className="usage-value"><strong>{formatBytes(data.databases.reduce((sum, db) => sum + db.sizeBytes, 0))}</strong><small>{data.databases.length} {data.databases.length === 1 ? "instance" : "instances"}</small></div>
        </div>
      </section>

      <section className="panel page-panel">
        <div className="panel-heading"><div><h2>Applications</h2><p>Current consumption, averaged over 5 minutes</p></div></div>
        <div className="usage-table" role="table">
          <div className="usage-row usage-head" role="row">
            <span>Application</span><span>CPU</span><span>CPU plan</span><span>Memory</span><span>Memory plan</span>
          </div>
          {apps.map((app) => (
            <button className="usage-row" role="row" onClick={() => onOpenApp(app.uuid)} key={app.uuid}>
              <span className="usage-name">{app.name}</span>
              <span>{formatCores(app.cpuCores)}</span>
              <span>{app.allocation ? `${formatCores(app.allocation.cpu)} · ${percent(app.cpuCores, app.allocation.cpu)}` : "—"}</span>
              <span>{formatBytes(app.memoryBytes)}</span>
              <span>{app.allocation ? `${formatBytes(app.allocation.memoryMb * 1024 * 1024)} · ${percent(app.memoryBytes, app.allocation.memoryMb * 1024 * 1024)}` : "—"}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel page-panel">
        <div className="panel-heading"><div><h2>Databases</h2><p>Storage and open connections</p></div></div>
        {data.databases.length ? (
          <div className="usage-table" role="table">
            <div className="usage-row usage-row-db usage-head" role="row"><span>Instance</span><span>Size</span><span>Connections</span></div>
            {data.databases.map((db) => (
              <div className="usage-row usage-row-db" role="row" key={db.name}>
                <span className="usage-name">{db.name}</span><span>{formatBytes(db.sizeBytes)}</span><span>{db.connections}</span>
              </div>
            ))}
          </div>
        ) : <p className="muted-note">No managed databases are linked to this account.</p>}
      </section>
    </div>
  );
}
