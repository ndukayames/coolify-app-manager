"use client";

import {
  ArrowLeft as arrowLeft,
  History as historyIcon,
  KeyRound as keyRound,
  Play as play,
  RotateCcw as rotateCcw,
  Search as search,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { StatusBadge } from "@/components/status-badge";
import { formatBytes, formatCores, formatRate, Sparkline } from "@/components/usage-bits";
import type {
  ApiMessage,
  AppDetails,
  AppLogLine,
  AppMetrics,
  Application,
  Deployment,
  HealthCheck,
} from "@/lib/types";

type Tab = "overview" | "settings" | "logs" | "deployments";

const fetcher = async <T,>(url: string): Promise<T> => {
  const response = await fetch(url);
  const body = (await response.json()) as T & ApiMessage;
  if (response.status === 401) window.location.reload();
  if (!response.ok) throw new Error(body.message ?? "The request failed.");
  return body;
};

const sendJson = async (url: string, method: string, payload: unknown): Promise<string> => {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await response.json().catch(() => ({}))) as ApiMessage;
  if (!response.ok) throw new Error(body.message ?? "The request failed.");
  return body.message;
};

type AppViewProps = {
  application: Application;
  deploying: boolean;
  onBack: () => void;
  onDeploy: () => void;
  onEnvironment: () => void;
  onSelectDeployment: (deployment: Deployment) => void;
  onNotice: (message: string) => void;
};

export function AppView(props: AppViewProps) {
  const { application, deploying, onBack, onDeploy, onEnvironment } = props;
  const Back = arrowLeft;
  const Key = keyRound;
  const Play = play;
  const [tab, setTab] = useState<Tab>("overview");
  const details = useSWR<AppDetails>(`/api/applications/${application.uuid}`, fetcher);

  return (
    <section className="app-view">
      <header className="app-view-header">
        <button className="icon-button" onClick={onBack} aria-label="Back to applications"><Back size={16} /></button>
        <div className="app-view-title">
          <div className="app-name-line">
            <h2>{application.name}</h2>
            <StatusBadge status={application.status} />
          </div>
          <p>{application.fqdn || "No domain"}</p>
        </div>
        <div className="app-view-actions">
          <button className="secondary-button" onClick={onEnvironment}><Key size={14} /> Environment</button>
          <button className="deploy-button" onClick={onDeploy} disabled={deploying}>
            {deploying ? <span className="button-spinner" /> : <Play size={14} />} {deploying ? "Starting" : "Deploy"}
          </button>
        </div>
      </header>

      <nav className="tab-bar" aria-label="Application sections">
        {(["overview", "settings", "logs", "deployments"] as Tab[]).map((item) => (
          <button className={tab === item ? "active" : ""} onClick={() => setTab(item)} key={item}>
            {item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </nav>

      {details.error ? <div className="page-error"><div><strong>Could not load this application</strong><span>{details.error.message}</span></div></div> : null}

      {tab === "overview" ? <OverviewTab application={application} details={details.data} /> : null}
      {tab === "settings" && details.data ? (
        <SettingsTab key={JSON.stringify(details.data)} details={details.data} onSaved={(message) => { props.onNotice(message); void details.mutate(); }} />
      ) : null}
      {tab === "logs" ? <LogsTab uuid={application.uuid} /> : null}
      {tab === "deployments" ? (
        <DeploymentsTab
          uuid={application.uuid}
          onSelect={props.onSelectDeployment}
          onNotice={props.onNotice}
        />
      ) : null}
    </section>
  );
}

const ranges = ["1h", "6h", "24h", "7d"] as const;

function UsageCard({ label, value, limit, points, ratio }: {
  label: string;
  value: string;
  limit?: string;
  points: [number, number][];
  ratio?: number;
}) {
  return (
    <div className="usage-card">
      <span className="utility-label">{label}</span>
      <div className="usage-value"><strong>{value}</strong>{limit ? <small>of {limit}</small> : null}</div>
      {ratio !== undefined ? (
        <div className="usage-meter"><span className={ratio > 1 ? "over" : ratio > 0.8 ? "high" : ""} style={{ width: `${Math.min(ratio, 1) * 100}%` }} /></div>
      ) : null}
      <Sparkline points={points} />
    </div>
  );
}

function OverviewTab({ application, details }: { application: Application; details?: AppDetails }) {
  const [range, setRange] = useState<(typeof ranges)[number]>("6h");
  const { data, error } = useSWR<AppMetrics>(`/api/applications/${application.uuid}/metrics?range=${range}`, fetcher, {
    refreshInterval: 60_000,
  });
  const allocation = data?.allocation;

  return (
    <div className="app-tab">
      <div className="panel-heading">
        <div><h3>Resource usage</h3><p>What this application is consuming</p></div>
        <div className="segmented">
          {ranges.map((item) => (
            <button className={range === item ? "active" : ""} onClick={() => setRange(item)} key={item}>{item}</button>
          ))}
        </div>
      </div>
      {error ? <p className="muted-note">Usage data is unavailable right now.</p> : null}
      <div className="usage-grid">
        <UsageCard
          label="CPU"
          value={data ? formatCores(data.current.cpuCores) : "…"}
          limit={allocation ? formatCores(allocation.cpu) : undefined}
          ratio={allocation && data ? data.current.cpuCores / allocation.cpu : undefined}
          points={data?.series.cpuCores ?? []}
        />
        <UsageCard
          label="Memory"
          value={data ? formatBytes(data.current.memoryBytes) : "…"}
          limit={allocation ? formatBytes(allocation.memoryMb * 1024 * 1024) : undefined}
          ratio={allocation && data ? data.current.memoryBytes / (allocation.memoryMb * 1024 * 1024) : undefined}
          points={data?.series.memoryBytes ?? []}
        />
        <UsageCard label="Network in" value={data ? formatRate(data.current.networkRxBps) : "…"} points={data?.series.networkRxBps ?? []} />
        <UsageCard label="Network out" value={data ? formatRate(data.current.networkTxBps) : "…"} points={data?.series.networkTxBps ?? []} />
      </div>

      <div className="panel-heading"><div><h3>Details</h3></div></div>
      <dl className="detail-grid">
        <div><dt>Repository</dt><dd>{details?.repository ?? application.gitRepository}</dd></div>
        <div><dt>Branch</dt><dd>{details?.branch ?? application.gitBranch}</dd></div>
        <div><dt>Commit</dt><dd><code>{application.gitCommitSha}</code></dd></div>
        <div><dt>Build</dt><dd>{details?.buildPack ?? "…"}</dd></div>
        <div className="wide"><dt>Domains</dt><dd>{details?.domains.length ? details.domains.join(", ") : "None"}</dd></div>
        <div><dt>Exposed ports</dt><dd>{details?.portsExposes || "None"}</dd></div>
        <div><dt>Auto deploy</dt><dd>{details ? (details.autoDeploy ? "On push" : "Manual") : "…"}</dd></div>
      </dl>
    </div>
  );
}

type FormState = Omit<AppDetails, "domains"> & { domainsText: string };

const toForm = (details: AppDetails): FormState => ({ ...details, domainsText: details.domains.join("\n") });

// Sends only fields that changed, so a save never rewrites settings the client didn't touch.
const diff = (before: FormState, after: FormState): Record<string, unknown> => {
  const changes: Record<string, unknown> = {};
  const simple = [
    "branch", "redirect", "forceHttps", "portsExposes", "installCommand", "buildCommand", "startCommand",
    "baseDirectory", "publishDirectory", "watchPaths", "preDeploymentCommand", "preDeploymentCommandContainer",
    "postDeploymentCommand", "postDeploymentCommandContainer", "autoDeploy", "dockerImagesToKeep",
  ] as const;
  for (const key of simple) if (before[key] !== after[key]) changes[key] = after[key];
  if (before.domainsText.trim() !== after.domainsText.trim()) {
    changes.domains = after.domainsText.split(/[\n,]/).map((value) => value.trim()).filter(Boolean);
  }
  const health: Partial<HealthCheck> = {};
  for (const key of Object.keys(after.healthCheck) as (keyof HealthCheck)[]) {
    if (before.healthCheck[key] !== after.healthCheck[key]) (health as Record<string, unknown>)[key] = after.healthCheck[key];
  }
  if (Object.keys(health).length) changes.healthCheck = health;
  return changes;
};

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="form-field">
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function SettingsTab({ details, onSaved }: { details: AppDetails; onSaved: (message: string) => void }) {
  const initial = useMemo(() => toForm(details), [details]);
  const [form, setForm] = useState<FormState>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const branches = useSWR<{ branches: string[] }>(`/api/applications/${details.uuid}/branches`, fetcher);
  const changes = diff(initial, form);
  const dirty = Object.keys(changes).length > 0;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));
  const setHealth = <K extends keyof HealthCheck>(key: K, value: HealthCheck[K]) =>
    setForm((current) => ({ ...current, healthCheck: { ...current.healthCheck, [key]: value } }));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      onSaved(await sendJson(`/api/applications/${details.uuid}`, "PATCH", changes));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Settings could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const branchOptions = branches.data?.branches ?? [];
  // Coolify ignores install/build/start commands for these build packs.
  const dockerManaged = ["dockerfile", "dockerimage", "dockercompose"].includes(details.buildPack);

  return (
    <div className="app-tab settings-form">
      <fieldset>
        <legend>Source</legend>
        <Field label="Repository" hint="Changing the repository or git source is handled by Codeva.">
          <input value={form.repository} disabled />
        </Field>
        <Field label="Branch" hint="Deployments build from this branch.">
          {branchOptions.length ? (
            <select value={form.branch} onChange={(event) => set("branch", event.target.value)}>
              {[...new Set([form.branch, ...branchOptions])].map((branch) => <option key={branch}>{branch}</option>)}
            </select>
          ) : (
            <input value={form.branch} onChange={(event) => set("branch", event.target.value)} />
          )}
        </Field>
        <Field label="Auto deploy">
          <select value={form.autoDeploy ? "on" : "off"} onChange={(event) => set("autoDeploy", event.target.value === "on")}>
            <option value="on">Deploy on every push</option>
            <option value="off">Manual deploys only</option>
          </select>
        </Field>
      </fieldset>

      <fieldset>
        <legend>Networking</legend>
        <Field label="Domains" hint="One per line, e.g. https://app.example.com. DNS must point to Codeva.">
          <textarea rows={3} value={form.domainsText} onChange={(event) => set("domainsText", event.target.value)} />
        </Field>
        <Field label="Redirect">
          <select value={form.redirect} onChange={(event) => set("redirect", event.target.value)}>
            <option value="both">Allow www and non-www</option>
            <option value="www">Redirect to www</option>
            <option value="non-www">Redirect to non-www</option>
          </select>
        </Field>
        <Field label="Force HTTPS">
          <select value={form.forceHttps ? "on" : "off"} onChange={(event) => set("forceHttps", event.target.value === "on")}>
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
        </Field>
        <Field label="Exposed ports" hint="Port(s) your app listens on, comma-separated.">
          <input value={form.portsExposes} onChange={(event) => set("portsExposes", event.target.value)} />
        </Field>
        <Field label="Port mappings" hint="Managed by Codeva.">
          <input value={form.portsMappings ?? "None"} disabled />
        </Field>
      </fieldset>

      <fieldset>
        <legend>Build</legend>
        {dockerManaged ? (
          <p className="muted-note field-note">Install, build and start commands are defined in your Dockerfile.</p>
        ) : (<>
        <Field label="Install command"><input value={form.installCommand} placeholder="Auto-detected" onChange={(event) => set("installCommand", event.target.value)} /></Field>
        <Field label="Build command"><input value={form.buildCommand} placeholder="Auto-detected" onChange={(event) => set("buildCommand", event.target.value)} /></Field>
        <Field label="Start command"><input value={form.startCommand} placeholder="Auto-detected" onChange={(event) => set("startCommand", event.target.value)} /></Field>
        </>)}
        <Field label="Base directory"><input value={form.baseDirectory} onChange={(event) => set("baseDirectory", event.target.value)} /></Field>
        <Field label="Publish directory"><input value={form.publishDirectory} onChange={(event) => set("publishDirectory", event.target.value)} /></Field>
        <Field label="Watch paths" hint="Only deploy when these paths change. One glob per line.">
          <textarea rows={2} value={form.watchPaths} onChange={(event) => set("watchPaths", event.target.value)} />
        </Field>
        <Field label="Custom Docker options" hint="Managed by Codeva.">
          <input value={form.customDockerRunOptions ?? "None"} disabled />
        </Field>
      </fieldset>

      <fieldset>
        <legend>Deploy commands</legend>
        <Field label="Pre-deployment command" hint="Runs in the new container before it receives traffic, e.g. migrations.">
          <input value={form.preDeploymentCommand} onChange={(event) => set("preDeploymentCommand", event.target.value)} />
        </Field>
        <Field label="Pre-deployment container"><input value={form.preDeploymentCommandContainer} placeholder="Default" onChange={(event) => set("preDeploymentCommandContainer", event.target.value)} /></Field>
        <Field label="Post-deployment command"><input value={form.postDeploymentCommand} onChange={(event) => set("postDeploymentCommand", event.target.value)} /></Field>
        <Field label="Post-deployment container"><input value={form.postDeploymentCommandContainer} placeholder="Default" onChange={(event) => set("postDeploymentCommandContainer", event.target.value)} /></Field>
      </fieldset>

      <fieldset>
        <legend>Health check</legend>
        <Field label="Enabled">
          <select value={form.healthCheck.enabled ? "on" : "off"} onChange={(event) => setHealth("enabled", event.target.value === "on")}>
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
        </Field>
        <Field label="Path"><input value={form.healthCheck.path} onChange={(event) => setHealth("path", event.target.value)} /></Field>
        <Field label="Port"><input value={form.healthCheck.port} placeholder="App port" onChange={(event) => setHealth("port", event.target.value)} /></Field>
        <Field label="Method">
          <select value={form.healthCheck.method} onChange={(event) => setHealth("method", event.target.value)}>
            {["GET", "POST", "HEAD"].map((method) => <option key={method}>{method}</option>)}
          </select>
        </Field>
        <Field label="Scheme">
          <select value={form.healthCheck.scheme} onChange={(event) => setHealth("scheme", event.target.value)}>
            {["http", "https"].map((scheme) => <option key={scheme}>{scheme}</option>)}
          </select>
        </Field>
        <Field label="Expected status"><input type="number" value={form.healthCheck.returnCode} onChange={(event) => setHealth("returnCode", Number(event.target.value))} /></Field>
        <Field label="Interval (s)"><input type="number" value={form.healthCheck.interval} onChange={(event) => setHealth("interval", Number(event.target.value))} /></Field>
        <Field label="Timeout (s)"><input type="number" value={form.healthCheck.timeout} onChange={(event) => setHealth("timeout", Number(event.target.value))} /></Field>
        <Field label="Retries"><input type="number" value={form.healthCheck.retries} onChange={(event) => setHealth("retries", Number(event.target.value))} /></Field>
        <Field label="Start period (s)"><input type="number" value={form.healthCheck.startPeriod} onChange={(event) => setHealth("startPeriod", Number(event.target.value))} /></Field>
      </fieldset>

      <fieldset>
        <legend>Rollback</legend>
        <Field label="Versions to keep" hint="Previous builds kept for instant rollback.">
          <input type="number" min={0} max={20} value={form.dockerImagesToKeep} onChange={(event) => set("dockerImagesToKeep", Number(event.target.value))} />
        </Field>
      </fieldset>

      <div className="settings-actions">
        {error ? <span className="form-error" role="alert">{error}</span> : <span className="muted-note">{dirty ? "Unsaved changes" : "No changes"}</span>}
        <button className="secondary-button" onClick={() => setForm(initial)} disabled={!dirty || saving}>Discard</button>
        <button className="primary-button" onClick={save} disabled={!dirty || saving}>{saving ? "Saving…" : "Save settings"}</button>
      </div>
    </div>
  );
}

const logRanges = ["15m", "1h", "6h", "24h", "7d"] as const;

function LogsTab({ uuid }: { uuid: string }) {
  const Search = search;
  const [range, setRange] = useState<(typeof logRanges)[number]>("1h");
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [live, setLive] = useState(true);
  const [streamed, setStreamed] = useState<{ key: string; lines: AppLogLine[] }>({ key: "", lines: [] });
  const [streamError, setStreamError] = useState<string | null>(null);
  const searchParam = submitted ? `&q=${encodeURIComponent(submitted)}` : "";
  const historyUrl = `/api/applications/${uuid}/logs?range=${range}&limit=500${searchParam}`;
  const { data, error, isLoading } = useSWR<{ lines: AppLogLine[] }>(historyUrl, fetcher, { revalidateOnFocus: false });

  // Live lines arrive over Server-Sent Events and are shown above the loaded history.
  // They are keyed to the current search so changing it starts a clean stream.
  useEffect(() => {
    if (!live) return;
    const key = submitted;
    const source = new EventSource(`/api/applications/${uuid}/logs/stream?${submitted ? `q=${encodeURIComponent(submitted)}` : ""}`);
    source.onopen = () => setStreamError(null);
    source.onmessage = (event) => {
      const incoming = (JSON.parse(event.data) as AppLogLine[]).reverse();
      setStreamed((current) => ({
        key,
        lines: [...incoming, ...(current.key === key ? current.lines : [])].slice(0, 1000),
      }));
    };
    source.addEventListener("error", (event) => {
      const message = (event as MessageEvent).data ? (JSON.parse((event as MessageEvent).data) as ApiMessage).message : null;
      setStreamError(message ?? "Reconnecting to live logs…");
    });
    return () => source.close();
  }, [uuid, submitted, live]);

  const liveLines = streamed.key === submitted ? streamed.lines : [];
  const newest = data?.lines[0]?.timestamp ?? "";
  // The stream can repeat lines already in the history; anything not newer is dropped.
  const lines = [...liveLines.filter((line) => line.timestamp > newest), ...(data?.lines ?? [])];

  return (
    <div className="app-tab">
      <div className="log-controls">
        <form className="search-field" onSubmit={(event) => { event.preventDefault(); setSubmitted(query.trim()); }}>
          <Search size={15} />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search logs, press Enter" aria-label="Search logs" />
        </form>
        <div className="segmented">
          {logRanges.map((item) => (
            <button className={range === item ? "active" : ""} onClick={() => setRange(item)} key={item}>{item}</button>
          ))}
        </div>
        <button className={`secondary-button ${live ? "live-on" : ""}`} onClick={() => setLive((value) => !value)}>
          <span className="live-dot" /> {live ? "Live" : "Paused"}
        </button>
      </div>
      <div className="log-output app-log-output">
        {isLoading ? <div className="log-state">Loading logs…</div> : null}
        {error ? <div className="log-state error-state">{error.message}</div> : null}
        {data && !lines.length ? <div className="log-state">No log lines in this period.</div> : null}
        {lines.length ? (
          <ol className="log-lines">
            {lines.map((line, index) => (
              <li className={`log-line ${/\b(error|exception|fatal)\b/i.test(line.message) ? "log-line-error" : /\bwarn/i.test(line.message) ? "log-line-warning" : ""}`} key={`${line.timestamp}-${index}`}>
                <time>{new Date(line.timestamp).toLocaleTimeString()}</time>
                <code>{line.message}</code>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
      <p className="muted-note">
        Newest first · {live ? (streamError ?? "streaming live") : "paused"}
      </p>
    </div>
  );
}

type RollbackImage = { tag: string; createdAt: string; isCurrent: boolean };

function DeploymentsTab({ uuid, onSelect, onNotice }: {
  uuid: string;
  onSelect: (deployment: Deployment) => void;
  onNotice: (message: string) => void;
}) {
  const HistoryIcon = historyIcon;
  const Rollback = rotateCcw;
  const images = useSWR<{ images: RollbackImage[] }>(`/api/applications/${uuid}/rollback`, fetcher);
  const [rollingBack, setRollingBack] = useState<string | null>(null);
  const history = useSWR<{ deployments: Deployment[] }>(`/api/applications/${uuid}/deployments`, fetcher, { refreshInterval: 30_000 });
  const appDeployments = history.data?.deployments ?? [];
  // Coolify does not always flag the running image, so the latest successful deploy's commit is used too.
  const runningCommit = appDeployments.find((deployment) => deployment.status === "finished")?.commit;
  const isRunning = (image: RollbackImage) =>
    image.isCurrent || (!!runningCommit && runningCommit !== "unknown" && image.tag.startsWith(runningCommit));

  const rollback = async (image: RollbackImage) => {
    if (!window.confirm(`Roll back to version ${image.tag.slice(0, 7)}? This redeploys that build.`)) return;
    setRollingBack(image.tag);
    try {
      onNotice(await sendJson(`/api/applications/${uuid}/rollback`, "POST", { tag: image.tag }));
    } catch (rollbackError) {
      onNotice(rollbackError instanceof Error ? rollbackError.message : "Rollback failed.");
    } finally {
      setRollingBack(null);
    }
  };

  return (
    <div className="app-tab">
      <div className="panel-heading"><div><h3>Rollback</h3><p>Previous builds kept on the platform</p></div></div>
      {images.data && !images.data.images.length ? <p className="muted-note">No previous builds are available yet.</p> : null}
      <div className="rollback-list">
        {images.data?.images.map((image) => (
          <div className="rollback-row" key={image.tag}>
            <HistoryIcon size={14} />
            <code>{image.tag.slice(0, 7)}</code>
            <span>{new Date(image.createdAt.replace(" +0000 UTC", "Z").replace(" ", "T")).toLocaleString()}</span>
            {isRunning(image) ? (
              <span className="status-badge status-running">Current</span>
            ) : (
              <button className="secondary-button" onClick={() => rollback(image)} disabled={rollingBack !== null}>
                <Rollback size={13} /> {rollingBack === image.tag ? "Queuing…" : "Roll back"}
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="panel-heading"><div><h3>History</h3><p>{history.isLoading ? "Loading…" : `${appDeployments.length} recent deployments`}</p></div></div>
      <div className="deployment-list">
        {appDeployments.map((deployment) => (
          <button className="deployment-row" onClick={() => onSelect(deployment)} key={deployment.uuid}>
            <span className={`deployment-line deployment-line-${deployment.status}`} />
            <div className="deployment-copy">
              <div><strong>{deployment.commitMessage}</strong><StatusBadge status={deployment.status} /></div>
              <small><code>{deployment.commit}</code></small>
            </div>
            <time dateTime={deployment.updatedAt}>{new Date(deployment.updatedAt).toLocaleString()}</time>
          </button>
        ))}
      </div>
    </div>
  );
}
