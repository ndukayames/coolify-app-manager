"use client";

import { Check as check, Copy as copy, RefreshCw as refreshCw, TerminalSquare as terminalSquare, X as x } from "lucide-react";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { StatusBadge } from "@/components/status-badge";
import type { ApiMessage, Deployment, DeploymentLogLine, DeploymentLogs } from "@/lib/types";

const fetcher = async <T,>(url: string): Promise<T> => {
  const response = await fetch(url);
  const body = (await response.json()) as T & ApiMessage;

  if (response.status === 401) window.location.reload();
  if (!response.ok) throw new Error(body.message ?? "The request failed.");
  return body;
};

type DeploymentLogDrawerProps = {
  deployment: Deployment;
  onClose: () => void;
};

export function DeploymentLogDrawer({ deployment, onClose }: DeploymentLogDrawerProps) {
  const Check = check;
  const Copy = copy;
  const Refresh = refreshCw;
  const Terminal = terminalSquare;
  const Close = x;
  const isActive = deployment.status === "in_progress" || deployment.status === "queued";
  const { data, error, isLoading, isValidating, mutate } = useSWR<DeploymentLogs>(
    `/api/deployments/${deployment.uuid}`,
    fetcher,
    {
      refreshInterval: isActive ? 3_000 : 0,
      revalidateOnFocus: true,
    },
  );
  const logLines = useMemo<DeploymentLogLine[]>(() => data?.lines ?? [], [data?.lines]);
  const copyableLogs = useMemo<string>(
    () => logLines.map((line) => (line.timestamp ? `${line.timestamp} ${line.message}` : line.message)).join("\n"),
    [logLines],
  );
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  const copyLogs = async () => {
    if (!copyableLogs) return;

    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(copyableLogs);
      } else {
        const fallback = document.createElement("textarea");
        fallback.value = copyableLogs;
        fallback.style.position = "fixed";
        fallback.style.opacity = "0";
        document.body.append(fallback);
        fallback.select();
        const copied = document.execCommand("copy");
        fallback.remove();
        if (!copied) throw new Error("The browser could not copy the logs.");
      }

      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 2_000);
    } catch {
      setCopyState("error");
    }
  };

  return (
    <div className="drawer-layer" role="presentation">
      <button className="drawer-backdrop" onClick={onClose} aria-label="Close deployment logs" />
      <aside className="log-drawer" aria-label={`${deployment.applicationName} deployment logs`}>
        <header className="drawer-header log-drawer-header">
          <div>
            <span className="utility-label">Deployment logs</span>
            <h2>{deployment.applicationName}</h2>
            <p>{deployment.commitMessage}</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <Close size={19} />
          </button>
        </header>

        <div className="log-metadata">
          <div><span>Status</span><StatusBadge status={deployment.status} /></div>
          <div><span>Commit</span><code>{deployment.commit}</code></div>
        </div>

        <div className="log-toolbar">
          <div><Terminal size={15} /><span>Build output</span></div>
          <div className="log-toolbar-actions">
            <button className="secondary-button log-copy-button" onClick={copyLogs} disabled={!copyableLogs}>
              {copyState === "copied" ? <Check size={14} /> : <Copy size={14} />}
              {copyState === "copied" ? "Copied" : copyState === "error" ? "Copy failed" : "Copy logs"}
            </button>
            <button className="icon-button quiet" onClick={() => mutate()} disabled={isValidating} aria-label="Refresh deployment logs">
              <Refresh className={isValidating ? "spin" : ""} size={15} />
            </button>
          </div>
        </div>

        <div className="log-output" aria-live="polite">
          {isLoading ? <div className="log-state">Loading deployment logs…</div> : null}
          {error ? (
            <div className="log-state error-state">
              <span>{error.message}</span>
              <button className="secondary-button" onClick={() => mutate()}>Try again</button>
            </div>
          ) : null}
          {!isLoading && !error && !logLines.length ? (
            <div className="log-state">No log output is available for this deployment.</div>
          ) : null}
          {!isLoading && !error && logLines.length ? (
            <ol className="log-lines" aria-label="Deployment output">
              {logLines.map((line, index) => (
                <li className={`log-line log-line-${line.tone} log-line-${line.kind}`} key={index}>
                  <time>{line.timestamp}</time>
                  <code>{line.message}</code>
                </li>
              ))}
            </ol>
          ) : null}
        </div>

        <footer className="log-footer">
          <span>{isActive ? "Refreshing every 3 seconds" : "Deployment complete"}</span>
          {data ? <time dateTime={data.refreshedAt}>Updated {new Date(data.refreshedAt).toLocaleTimeString()}</time> : null}
        </footer>
      </aside>
    </div>
  );
}
