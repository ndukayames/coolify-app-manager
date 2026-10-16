"use client";

import {
  ArrowLeft as arrowLeft,
  Building2 as building,
  Check as check,
  Copy as copy,
  LogOut as logOut,
  Plus as plus,
  ShieldCheck as shield,
} from "lucide-react";
import { useState } from "react";
import useSWR from "swr";

// Codeva staff console. Separate from the client dashboard: its own route (/admin), layout and
// APIs (/api/admin/*, admin-only). Tokens are write-only here; the API never returns them.

type TenantOverview = { id: string; name: string; users: number; databases: number; hasGrafanaToken: boolean; createdAt: string };
type ManagedUser = { id: string; email: string; name: string; createdAt: string; activeSessions: number };
type AdminDatabase = {
  id: string;
  name: string;
  server: string;
  cluster: string;
  exporterInstance: string;
  pgbouncerUnit: string | null;
  replica: string | null;
  plan: { cpu: number | null; memoryMb: number | null; storageGb: number | null };
};
type TenantDetail = {
  id: string;
  name: string;
  hasGrafanaToken: boolean;
  coolify: { ok: true; projects: string[] } | { ok: false; error: string };
  users: ManagedUser[];
  databases: AdminDatabase[];
};
type DiscoveredInstance = {
  server: string;
  instance: string;
  version: string | null;
  port: string | null;
  isReplica: boolean;
  registeredTo: string | null;
};
type AppPlanRow = { uuid: string; name: string; plan: { cpu: number; memoryMb: number } | null };

const fetcher = async <T,>(url: string): Promise<T> => {
  const response = await fetch(url);
  const body = (await response.json()) as T & { message?: string };
  if (!response.ok) throw new Error(body.message ?? "The request failed.");
  return body;
};

const send = async <T = { message: string },>(url: string, method: string, payload?: unknown): Promise<T> => {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const body = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) throw new Error(body.message ?? "The request failed.");
  return body;
};

// A generated password is only ever returned once; this keeps it on screen until dismissed.
function SecretReveal({ label, secret, onDone }: { label: string; secret: string; onDone: () => void }) {
  const Copy = copy;
  const Check = check;
  const [copied, setCopied] = useState(false);
  return (
    <div className="secret-reveal" role="alert">
      <div>
        <strong>{label}</strong>
        <span>Shown once. Send it to the user securely.</span>
      </div>
      <code>{secret}</code>
      <div className="secret-actions">
        <button className="secondary-button" onClick={async () => { await navigator.clipboard.writeText(secret); setCopied(true); }}>
          {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}
        </button>
        <button className="primary-button" onClick={onDone}>Done</button>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="form-field">
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

export function AdminConsole({ adminEmail }: { adminEmail: string }) {
  const Building = building;
  const Shield = shield;
  const SignOut = logOut;
  const [view, setView] = useState<"clients" | "admins">("clients");
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const signOut = async () => {
    await fetch("/api/auth/sign-out", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    window.location.reload();
  };

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Admin navigation">
        <div className="brand">
          <span className="brand-mark"><span /><span /><span /></span>
          <div><strong>Codeva Console</strong><small>Admin</small></div>
        </div>
        <nav className="sidebar-nav">
          <button className={view === "clients" ? "active" : ""} onClick={() => { setView("clients"); setTenantId(null); }}>
            <Building size={15} /> Clients
          </button>
          <button className={view === "admins" ? "active" : ""} onClick={() => { setView("admins"); setTenantId(null); }}>
            <Shield size={15} /> Admins
          </button>
        </nav>
        <div className="sidebar-section" />
        <div className="sidebar-footer admin-footer">
          <small>{adminEmail}</small>
          <button className="text-button sidebar-signout" onClick={signOut}><SignOut size={14} /> Sign out</button>
        </div>
      </aside>
      <div className="content-column">
        <main className="main-content">
          {view === "clients" && !tenantId ? <ClientsView onOpen={setTenantId} onNotice={setNotice} /> : null}
          {view === "clients" && tenantId ? (
            <ClientView id={tenantId} onBack={() => setTenantId(null)} onNotice={setNotice} />
          ) : null}
          {view === "admins" ? <AdminsView onNotice={setNotice} /> : null}
        </main>
      </div>
      {notice ? (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss">×</button>
        </div>
      ) : null}
    </div>
  );
}

function ClientsView({ onOpen, onNotice }: { onOpen: (id: string) => void; onNotice: (message: string) => void }) {
  const Plus = plus;
  const { data, error, mutate } = useSWR<{ tenants: TenantOverview[] }>("/api/admin/tenants", fetcher);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", coolifyToken: "", grafanaToken: "" });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setFormError(null);
    try {
      const result = await send<{ id: string; projects: string[] }>("/api/admin/tenants", "POST", form);
      onNotice(`Client created. Coolify token sees ${result.projects.length} project(s): ${result.projects.join(", ") || "none"}.`);
      setForm({ name: "", coolifyToken: "", grafanaToken: "" });
      setCreating(false);
      await mutate();
      onOpen(result.id);
    } catch (createError) {
      setFormError(createError instanceof Error ? createError.message : "The client could not be created.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className="page-heading">
        <div><h1>Clients</h1></div>
        <button className="primary-button admin-cta" onClick={() => setCreating((value) => !value)}><Plus size={15} /> New client</button>
      </section>

      {creating ? (
        <section className="panel admin-form">
          <div className="panel-heading"><div><h2>New client</h2><p>The Coolify token must come from the client&apos;s own Coolify team.</p></div></div>
          <div className="settings-form"><fieldset>
            <Field label="Client name"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. PISI" /></Field>
            <Field label="Coolify team API token" hint="Keys & Tokens → API tokens, in the client's team. read, read:sensitive, write, deploy.">
              <input type="password" autoComplete="off" value={form.coolifyToken} onChange={(event) => setForm({ ...form, coolifyToken: event.target.value })} />
            </Field>
            <Field label="Grafana org token (optional)" hint="Service account (Viewer) in the client's Grafana org. Leave empty to use the default.">
              <input type="password" autoComplete="off" value={form.grafanaToken} onChange={(event) => setForm({ ...form, grafanaToken: event.target.value })} />
            </Field>
          </fieldset></div>
          <div className="settings-actions">
            {formError ? <span className="form-error">{formError}</span> : <span />}
            <button className="secondary-button" onClick={() => setCreating(false)}>Cancel</button>
            <button className="primary-button" onClick={create} disabled={busy || !form.name || !form.coolifyToken}>{busy ? "Checking token…" : "Create client"}</button>
          </div>
        </section>
      ) : null}

      {error ? <div className="page-error"><div><strong>Clients could not be loaded</strong><span>{error.message}</span></div></div> : null}
      <section className="panel page-panel">
        <div className="usage-table" role="table">
          <div className="usage-row admin-row usage-head" role="row"><span>Client</span><span>Users</span><span>Databases</span><span>Grafana</span></div>
          {data?.tenants.map((tenant) => (
            <button className="usage-row admin-row" role="row" onClick={() => onOpen(tenant.id)} key={tenant.id}>
              <span className="usage-name">{tenant.name}</span>
              <span>{tenant.users}</span>
              <span>{tenant.databases}</span>
              <span>{tenant.hasGrafanaToken ? "Own org token" : "Default"}</span>
            </button>
          ))}
          {data && !data.tenants.length ? <p className="muted-note admin-empty">No clients yet.</p> : null}
        </div>
      </section>
    </>
  );
}

type ClientTab = "settings" | "users" | "databases" | "plans";

function ClientView({ id, onBack, onNotice }: { id: string; onBack: () => void; onNotice: (message: string) => void }) {
  const Back = arrowLeft;
  const { data, error, mutate } = useSWR<TenantDetail>(`/api/admin/tenants/${id}`, fetcher);
  const [tab, setTab] = useState<ClientTab>("users");

  return (
    <section className="app-view">
      <header className="app-view-header">
        <button className="icon-button" onClick={onBack} aria-label="Back to clients"><Back size={16} /></button>
        <div className="app-view-title">
          <div className="app-name-line"><h2>{data?.name ?? "Client"}</h2></div>
          <p>
            {data
              ? data.coolify.ok
                ? `Coolify: ${data.coolify.projects.length} project(s) · Grafana: ${data.hasGrafanaToken ? "own org token" : "default"}`
                : `Coolify token problem: ${data.coolify.error}`
              : "Loading…"}
          </p>
        </div>
      </header>
      <nav className="tab-bar">
        {(["users", "databases", "plans", "settings"] as ClientTab[]).map((item) => (
          <button className={tab === item ? "active" : ""} onClick={() => setTab(item)} key={item}>
            {{ users: "Users", databases: "Databases", plans: "App plans", settings: "Settings" }[item]}
          </button>
        ))}
      </nav>
      {error ? <div className="page-error"><div><strong>Client could not be loaded</strong><span>{error.message}</span></div></div> : null}
      {data && tab === "users" ? <UsersTab tenant={data} onChanged={() => void mutate()} onNotice={onNotice} /> : null}
      {data && tab === "databases" ? <DatabasesTab tenant={data} onChanged={() => void mutate()} onNotice={onNotice} /> : null}
      {data && tab === "plans" ? <PlansTab tenantId={data.id} onNotice={onNotice} /> : null}
      {data && tab === "settings" ? <SettingsTab tenant={data} onChanged={() => void mutate()} onDeleted={onBack} onNotice={onNotice} /> : null}
    </section>
  );
}

function UsersTab({ tenant, onChanged, onNotice }: { tenant: TenantDetail; onChanged: () => void; onNotice: (message: string) => void }) {
  const [form, setForm] = useState({ email: "", name: "" });
  const [secret, setSecret] = useState<{ label: string; value: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const add = async () => {
    setBusy(true);
    setFormError(null);
    try {
      const result = await send<{ password: string }>(`/api/admin/tenants/${tenant.id}/users`, "POST", form);
      setSecret({ label: `Password for ${form.email}`, value: result.password });
      setForm({ email: "", name: "" });
      onChanged();
    } catch (addError) {
      setFormError(addError instanceof Error ? addError.message : "The user could not be created.");
    } finally {
      setBusy(false);
    }
  };

  const act = async (user: ManagedUser, action: "reset-password" | "sign-out" | "delete") => {
    if (action === "delete" && !window.confirm(`Remove ${user.email}? They lose access immediately.`)) return;
    if (action === "reset-password" && !window.confirm(`Reset ${user.email}'s password? They'll be signed out.`)) return;
    try {
      if (action === "delete") {
        onNotice((await send(`/api/admin/users/${user.id}`, "DELETE")).message);
      } else {
        const result = await send<{ message: string; password?: string }>(`/api/admin/users/${user.id}`, "POST", { action });
        if (result.password) setSecret({ label: `New password for ${user.email}`, value: result.password });
        else onNotice(result.message);
      }
      onChanged();
    } catch (actError) {
      onNotice(actError instanceof Error ? actError.message : "That didn't work.");
    }
  };

  return (
    <div className="app-tab">
      {secret ? <SecretReveal label={secret.label} secret={secret.value} onDone={() => setSecret(null)} /> : null}
      <div className="admin-inline-form">
        <Field label="Email"><input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="dev@client.com" /></Field>
        <Field label="Name (optional)"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
        <button className="primary-button" onClick={add} disabled={busy || !form.email}>{busy ? "Adding…" : "Add user"}</button>
      </div>
      {formError ? <p className="form-error admin-error">{formError}</p> : null}
      <div className="usage-table db-table">
        <div className="usage-row admin-user-row usage-head"><span>User</span><span>Signed in</span><span /></div>
        {tenant.users.map((user) => (
          <div className="usage-row admin-user-row" key={user.id}>
            <span className="usage-name">{user.email}{user.name !== user.email ? <small> · {user.name}</small> : null}</span>
            <span>{user.activeSessions ? `${user.activeSessions} session(s)` : "—"}</span>
            <span className="admin-actions">
              <button className="text-button" onClick={() => act(user, "reset-password")}>Reset password</button>
              <button className="text-button" onClick={() => act(user, "sign-out")} disabled={!user.activeSessions}>Sign out</button>
              <button className="text-button danger-text" onClick={() => act(user, "delete")}>Remove</button>
            </span>
          </div>
        ))}
        {!tenant.users.length ? <p className="muted-note admin-empty">No users yet.</p> : null}
      </div>
    </div>
  );
}

const emptyDatabaseForm = { name: "", target: "", cluster: "", pgbouncerUnit: "", replica: "", cpu: "", memoryGb: "", storageGb: "" };

function DatabasesTab({ tenant, onChanged, onNotice }: { tenant: TenantDetail; onChanged: () => void; onNotice: (message: string) => void }) {
  const discovery = useSWR<{ instances: DiscoveredInstance[] }>("/api/admin/discovery", fetcher);
  const [form, setForm] = useState(emptyDatabaseForm);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const instances = discovery.data?.instances ?? [];
  const selected = instances.find((item) => `${item.server}/${item.instance}` === form.target);

  const register = async () => {
    if (!selected) return;
    setBusy(true);
    setFormError(null);
    try {
      await send(`/api/admin/tenants/${tenant.id}/databases`, "POST", {
        name: form.name,
        server: selected.server,
        instance: selected.instance,
        cluster: form.cluster,
        pgbouncerUnit: form.pgbouncerUnit,
        replica: form.replica,
        cpu: form.cpu,
        memoryMb: form.memoryGb ? Math.round(Number(form.memoryGb) * 1024) : "",
        storageGb: form.storageGb,
      });
      onNotice(`${form.name} registered.`);
      setForm(emptyDatabaseForm);
      setAdding(false);
      onChanged();
      void discovery.mutate();
    } catch (registerError) {
      setFormError(registerError instanceof Error ? registerError.message : "The database could not be registered.");
    } finally {
      setBusy(false);
    }
  };

  const editPlan = async (database: AdminDatabase) => {
    const cpu = window.prompt(`vCPU for ${database.name}`, String(database.plan.cpu ?? ""));
    if (cpu === null) return;
    const memory = window.prompt(`Memory (GB) for ${database.name}`, database.plan.memoryMb ? String(database.plan.memoryMb / 1024) : "");
    if (memory === null) return;
    const storage = window.prompt(`Storage (GB) for ${database.name}`, String(database.plan.storageGb ?? ""));
    if (storage === null) return;
    try {
      await send(`/api/admin/databases/${database.id}`, "PATCH", {
        cpu: cpu || null,
        memoryMb: memory ? Math.round(Number(memory) * 1024) : null,
        storageGb: storage || null,
      });
      onNotice("Plan updated.");
      onChanged();
    } catch (planError) {
      onNotice(planError instanceof Error ? planError.message : "The plan could not be updated.");
    }
  };

  const remove = async (database: AdminDatabase) => {
    if (!window.confirm(`Unregister ${database.name}? The database itself is not touched.`)) return;
    onNotice((await send(`/api/admin/databases/${database.id}`, "DELETE")).message);
    onChanged();
    void discovery.mutate();
  };

  return (
    <div className="app-tab">
      <div className="panel-heading">
        <div><h3>Database instances</h3><p>What this client sees under Databases</p></div>
        <button className="secondary-button admin-small" onClick={() => setAdding((value) => !value)}>{adding ? "Cancel" : "Register instance"}</button>
      </div>

      {adding ? (
        <div className="settings-form admin-db-form">
          <fieldset>
            <Field label="Instance" hint="Postgres instances reporting to Prometheus.">
              <select value={form.target} onChange={(event) => {
                const item = instances.find((candidate) => `${candidate.server}/${candidate.instance}` === event.target.value);
                setForm({ ...form, target: event.target.value, cluster: item?.version ? `${item.version.split(".")[0]}-` : form.cluster, name: form.name || (item?.instance ?? "") });
              }}>
                <option value="">Choose…</option>
                {instances.filter((item) => !item.isReplica).map((item) => (
                  <option key={`${item.server}/${item.instance}`} value={`${item.server}/${item.instance}`} disabled={item.registeredTo !== null}>
                    {item.server} · {item.instance} · PG {item.version ?? "?"}{item.port ? ` · :${item.port}` : ""}{item.registeredTo ? ` (${item.registeredTo})` : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Display name" hint="What the client sees."><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
            <Field label="Cluster id" hint="As in pg_lsclusters, e.g. 16-main or 18-gridx."><input value={form.cluster} onChange={(event) => setForm({ ...form, cluster: event.target.value })} /></Field>
            <Field label="PgBouncer service" hint="systemd unit, e.g. pgbouncer-gridx. Optional."><input value={form.pgbouncerUnit} onChange={(event) => setForm({ ...form, pgbouncerUnit: event.target.value })} /></Field>
            <Field label="Standby replica (optional)">
              <select value={form.replica} onChange={(event) => setForm({ ...form, replica: event.target.value })}>
                <option value="">None</option>
                {instances.filter((item) => item.isReplica).map((item) => (
                  <option key={`${item.server}/${item.instance}`} value={`${item.server}/${item.instance}`}>{item.server} · {item.instance}</option>
                ))}
              </select>
            </Field>
            <Field label="Plan: vCPU"><input type="number" min={0} step={0.5} value={form.cpu} onChange={(event) => setForm({ ...form, cpu: event.target.value })} /></Field>
            <Field label="Plan: memory (GB)"><input type="number" min={0} step={0.5} value={form.memoryGb} onChange={(event) => setForm({ ...form, memoryGb: event.target.value })} /></Field>
            <Field label="Plan: storage (GB)"><input type="number" min={0} value={form.storageGb} onChange={(event) => setForm({ ...form, storageGb: event.target.value })} /></Field>
          </fieldset>
          <div className="settings-actions">
            {formError ? <span className="form-error">{formError}</span> : <span />}
            <button className="primary-button" onClick={register} disabled={busy || !selected || !form.name || !form.cluster}>{busy ? "Registering…" : "Register"}</button>
          </div>
        </div>
      ) : null}

      <div className="usage-table db-table">
        <div className="usage-row admin-db-row usage-head"><span>Name</span><span>Instance</span><span>Plan</span><span /></div>
        {tenant.databases.map((database) => (
          <div className="usage-row admin-db-row" key={database.id}>
            <span className="usage-name">{database.name}</span>
            <span><code>{database.server} · {database.cluster}</code>{database.replica ? <small> + replica</small> : null}</span>
            <span>
              {[database.plan.cpu && `${database.plan.cpu} vCPU`, database.plan.memoryMb && `${database.plan.memoryMb / 1024} GB`, database.plan.storageGb && `${database.plan.storageGb} GB disk`]
                .filter(Boolean).join(" · ") || "—"}
            </span>
            <span className="admin-actions">
              <button className="text-button" onClick={() => editPlan(database)}>Edit plan</button>
              <button className="text-button danger-text" onClick={() => remove(database)}>Unregister</button>
            </span>
          </div>
        ))}
        {!tenant.databases.length ? <p className="muted-note admin-empty">No database instances registered.</p> : null}
      </div>
    </div>
  );
}

function PlansTab({ tenantId, onNotice }: { tenantId: string; onNotice: (message: string) => void }) {
  const { data, error, mutate } = useSWR<{ apps: AppPlanRow[] }>(`/api/admin/tenants/${tenantId}/plans`, fetcher);
  const [drafts, setDrafts] = useState<Record<string, { cpu: string; memoryGb: string }>>({});

  const draftFor = (app: AppPlanRow) =>
    drafts[app.uuid] ?? { cpu: app.plan ? String(app.plan.cpu) : "", memoryGb: app.plan ? String(app.plan.memoryMb / 1024) : "" };

  const save = async (app: AppPlanRow) => {
    const draft = draftFor(app);
    try {
      const result = await send(`/api/admin/tenants/${tenantId}/plans`, "PUT", {
        appUuid: app.uuid,
        cpu: draft.cpu || null,
        memoryMb: draft.memoryGb ? Math.round(Number(draft.memoryGb) * 1024) : null,
      });
      onNotice(`${app.name}: ${result.message}`);
      setDrafts((current) => { const next = { ...current }; delete next[app.uuid]; return next; });
      void mutate();
    } catch (saveError) {
      onNotice(saveError instanceof Error ? saveError.message : "The plan could not be saved.");
    }
  };

  return (
    <div className="app-tab">
      <div className="panel-heading"><div><h3>App plans</h3><p>Agreed vCPU and memory, shown to the client against actual usage. Not enforced.</p></div></div>
      {error ? <p className="form-error admin-error">{error.message}</p> : null}
      {!data && !error ? <p className="muted-note">Loading apps from Coolify…</p> : null}
      <div className="usage-table db-table">
        {data?.apps.length ? <div className="usage-row admin-plan-row usage-head"><span>App</span><span>vCPU</span><span>Memory (GB)</span><span /></div> : null}
        {data?.apps.map((app) => {
          const draft = draftFor(app);
          const dirty = drafts[app.uuid] !== undefined;
          return (
            <div className="usage-row admin-plan-row" key={app.uuid}>
              <span className="usage-name">{app.name}</span>
              <input className="admin-cell-input" type="number" min={0} step={0.25} value={draft.cpu} placeholder="—"
                onChange={(event) => setDrafts({ ...drafts, [app.uuid]: { ...draft, cpu: event.target.value } })} />
              <input className="admin-cell-input" type="number" min={0} step={0.25} value={draft.memoryGb} placeholder="—"
                onChange={(event) => setDrafts({ ...drafts, [app.uuid]: { ...draft, memoryGb: event.target.value } })} />
              <button className="text-button" onClick={() => save(app)} disabled={!dirty}>Save</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SettingsTab({ tenant, onChanged, onDeleted, onNotice }: {
  tenant: TenantDetail;
  onChanged: () => void;
  onDeleted: () => void;
  onNotice: (message: string) => void;
}) {
  const [name, setName] = useState(tenant.name);
  const [coolifyToken, setCoolifyToken] = useState("");
  const [grafanaToken, setGrafanaToken] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const patch = async (key: string, payload: Record<string, unknown>, after?: () => void) => {
    setBusy(key);
    try {
      const result = await send<{ message: string; projects?: string[] }>(`/api/admin/tenants/${tenant.id}`, "PATCH", payload);
      onNotice(result.projects ? `Token saved. It sees: ${result.projects.join(", ") || "no projects"}.` : result.message);
      after?.();
      onChanged();
    } catch (patchError) {
      onNotice(patchError instanceof Error ? patchError.message : "The change could not be saved.");
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (window.prompt(`Type ${tenant.name} to delete this client and all its users.`) !== tenant.name) return;
    onNotice((await send(`/api/admin/tenants/${tenant.id}`, "DELETE")).message);
    onDeleted();
  };

  return (
    <div className="app-tab settings-form">
      <fieldset>
        <legend>Client</legend>
        <Field label="Name"><input value={name} onChange={(event) => setName(event.target.value)} /></Field>
        <div className="admin-field-action">
          <button className="secondary-button" onClick={() => patch("name", { name })} disabled={busy !== null || name === tenant.name}>Rename</button>
        </div>
      </fieldset>
      <fieldset>
        <legend>Coolify</legend>
        <Field label="Replace team API token" hint={tenant.coolify.ok ? `Current token sees: ${tenant.coolify.projects.join(", ") || "no projects"}` : tenant.coolify.error}>
          <input type="password" autoComplete="off" value={coolifyToken} onChange={(event) => setCoolifyToken(event.target.value)} placeholder="Paste a new token" />
        </Field>
        <div className="admin-field-action">
          <button className="secondary-button" onClick={() => patch("coolify", { coolifyToken }, () => setCoolifyToken(""))} disabled={busy !== null || !coolifyToken}>
            {busy === "coolify" ? "Checking…" : "Save token"}
          </button>
        </div>
      </fieldset>
      <fieldset>
        <legend>Grafana</legend>
        <Field label={tenant.hasGrafanaToken ? "Replace org token" : "Org service-account token"} hint={tenant.hasGrafanaToken ? "Using this client's own Grafana org." : "Using the default Grafana token."}>
          <input type="password" autoComplete="off" value={grafanaToken} onChange={(event) => setGrafanaToken(event.target.value)} placeholder="glsa_…" />
        </Field>
        <div className="admin-field-action">
          <button className="secondary-button" onClick={() => patch("grafana", { grafanaToken }, () => setGrafanaToken(""))} disabled={busy !== null || !grafanaToken}>
            {busy === "grafana" ? "Checking…" : "Save token"}
          </button>
          {tenant.hasGrafanaToken ? (
            <button className="text-button danger-text" onClick={() => patch("grafana-clear", { grafanaToken: null })} disabled={busy !== null}>Use default instead</button>
          ) : null}
        </div>
      </fieldset>
      <fieldset>
        <legend>Danger zone</legend>
        <p className="muted-note field-note">Deleting removes the client, its users and its database registrations from the console. Nothing in Coolify or on the servers is touched.</p>
        <div className="admin-field-action"><button className="secondary-button danger-text" onClick={remove}>Delete client</button></div>
      </fieldset>
    </div>
  );
}

function AdminsView({ onNotice }: { onNotice: (message: string) => void }) {
  const { data, mutate } = useSWR<{ admins: ManagedUser[]; currentUserId: string }>("/api/admin/admins", fetcher);
  const [email, setEmail] = useState("");
  const [secret, setSecret] = useState<{ label: string; value: string } | null>(null);

  const add = async () => {
    try {
      const result = await send<{ password: string }>("/api/admin/admins", "POST", { email });
      setSecret({ label: `Password for ${email}`, value: result.password });
      setEmail("");
      void mutate();
    } catch (addError) {
      onNotice(addError instanceof Error ? addError.message : "The admin could not be created.");
    }
  };

  const act = async (user: ManagedUser, action: "reset-password" | "delete") => {
    if (!window.confirm(action === "delete" ? `Remove admin ${user.email}?` : `Reset ${user.email}'s password?`)) return;
    try {
      if (action === "delete") onNotice((await send(`/api/admin/users/${user.id}`, "DELETE")).message);
      else {
        const result = await send<{ password: string }>(`/api/admin/users/${user.id}`, "POST", { action });
        setSecret({ label: `New password for ${user.email}`, value: result.password });
      }
      void mutate();
    } catch (actError) {
      onNotice(actError instanceof Error ? actError.message : "That didn't work.");
    }
  };

  return (
    <>
      <section className="page-heading"><div><h1>Admins</h1></div></section>
      <section className="panel page-panel">
        <div className="app-tab">
          {secret ? <SecretReveal label={secret.label} secret={secret.value} onDone={() => setSecret(null)} /> : null}
          <div className="admin-inline-form">
            <Field label="Email"><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@thecodeva.com" /></Field>
            <button className="primary-button" onClick={add} disabled={!email}>Add admin</button>
          </div>
          <div className="usage-table db-table">
            {data?.admins.map((user) => (
              <div className="usage-row admin-user-row" key={user.id}>
                <span className="usage-name">{user.email}{user.id === data.currentUserId ? <small> · you</small> : null}</span>
                <span>{user.activeSessions ? `${user.activeSessions} session(s)` : "—"}</span>
                <span className="admin-actions">
                  <button className="text-button" onClick={() => act(user, "reset-password")}>Reset password</button>
                  {user.id !== data.currentUserId ? <button className="text-button danger-text" onClick={() => act(user, "delete")}>Remove</button> : null}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
