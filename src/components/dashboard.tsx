"use client";

import {
  Activity as activity,
  AppWindow as appWindow,
  ArrowUpRight as arrowUpRight,
  Box as box,
  ChevronRight as chevronRight,
  Database as databaseIcon,
  Folder as folder,
  Layers as layers,
  FileText as fileText,
  Gauge as gauge,
  GitBranch as gitBranch,
  KeyRound as keyRound,
  LogOut as logOut,
  Play as play,
  RefreshCw as refreshCw,
  Search as search,
  X as x,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { AppView } from "@/components/app-view";
import { DatabaseList, DatabaseView } from "@/components/database-view";
import { DeploymentLogDrawer } from "@/components/deployment-log-drawer";
import { EnvironmentDrawer } from "@/components/environment-drawer";
import { StatusBadge } from "@/components/status-badge";
import { UsageView } from "@/components/usage-view";
import type { ApiMessage, Application, DatabaseListItem, Deployment, OverviewData, Project } from "@/lib/types";

type View = "overview" | "applications" | "deployments" | "databases" | "usage";

const emptyApplications: Application[] = [];
const emptyDeployments: Deployment[] = [];
const emptyProjects: Project[] = [];

const fetcher = async <T,>(url: string): Promise<T> => {
  const response = await fetch(url);
  const body = (await response.json()) as T & ApiMessage;

  if (response.status === 401) window.location.reload();
  if (!response.ok) throw new Error(body.message ?? "The request failed.");
  return body;
};

const formatRelativeTime = (value: string): string => {
  const difference = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(difference / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

const getRepositoryName = (repository: string): string =>
  repository.replace(/\.git$/, "").split("/").slice(-2).join("/");

const navItems: { id: View; label: string; icon: typeof appWindow }[] = [
  { id: "overview", label: "Overview", icon: appWindow },
  { id: "applications", label: "Applications", icon: box },
  { id: "deployments", label: "Deployments", icon: activity },
  { id: "databases", label: "Databases", icon: databaseIcon },
  { id: "usage", label: "Usage", icon: gauge },
];

type ApplicationListProps = {
  applications: Application[];
  deployingUuid: string | null;
  onDeploy: (application: Application) => void;
  onEnvironment: (application: Application) => void;
  onOpen: (application: Application) => void;
  lastDeployments: Map<string, Deployment>;
};

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="empty-state">
      <span className="empty-state-mark" />
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}

function ApplicationList({ applications, deployingUuid, onDeploy, onEnvironment, onOpen, lastDeployments }: ApplicationListProps) {
  const ArrowUpRight = arrowUpRight;
  const Branch = gitBranch;
  const Key = keyRound;
  const Play = play;

  if (!applications.length) {
    return <EmptyState title="No applications found" description="Your applications will appear here." />;
  }

  return (
    <div className="application-list">
      {applications.map((application) => (
        <article className="application-row" key={application.uuid}>
          <button className="app-identity app-open" onClick={() => onOpen(application)} aria-label={`Open ${application.name}`}>
            <div className="app-monogram">{application.name.slice(0, 2).toUpperCase()}</div>
            <div>
              <div className="app-name-line">
                <h3>{application.name}</h3>
                <StatusBadge status={application.status} />
              </div>
              <p>{application.description}</p>
            </div>
          </button>
          <div className="repo-cell">
            <span><Branch size={13} /> {application.gitBranch}</span>
            <small>{getRepositoryName(application.gitRepository)}</small>
          </div>
          {/* Coolify bumps the app's own updated_at on every status check, so the last deploy is shown instead. */}
          {lastDeployments.get(application.uuid) ? (
            <time dateTime={lastDeployments.get(application.uuid)?.updatedAt} title="Last deployed">
              {formatRelativeTime(lastDeployments.get(application.uuid)?.updatedAt ?? "")}
            </time>
          ) : <time title="Not deployed yet">—</time>}
          <div className="row-actions">
            {application.fqdn ? (
              <Link className="icon-button quiet" href={application.fqdn} target="_blank" aria-label={`Open ${application.name}`}>
                <ArrowUpRight size={15} />
              </Link>
            ) : null}
            <button
              className="icon-button quiet"
              onClick={() => onEnvironment(application)}
              aria-label={`Edit ${application.name} environment`}
            >
              <Key size={15} />
            </button>
            <button
              className="deploy-button"
              onClick={() => onDeploy(application)}
              disabled={deployingUuid === application.uuid}
            >
              {deployingUuid === application.uuid ? <span className="button-spinner" /> : <Play size={14} />}
              {deployingUuid === application.uuid ? "Starting" : "Deploy"}
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function DeploymentList({ deployments, onSelect, loading = false }: {
  deployments: Deployment[];
  onSelect: (deployment: Deployment) => void;
  loading?: boolean;
}) {
  const FileText = fileText;

  if (loading) {
    return <EmptyState title="Loading deployments…" description="Fetching the latest deploy for each application." />;
  }

  if (!deployments.length) {
    return <EmptyState title="No deployments yet" description="Your recent deployment history will appear here." />;
  }

  return (
    <div className="deployment-list">
      {deployments.map((deployment) => (
        <button
          className="deployment-row"
          onClick={() => onSelect(deployment)}
          aria-label={`View logs for ${deployment.applicationName}`}
          key={deployment.uuid}
        >
          <span className={`deployment-line deployment-line-${deployment.status}`} />
          <div className="deployment-copy">
            <div>
              <strong>{deployment.applicationName}</strong>
              <StatusBadge status={deployment.status} />
            </div>
            <p>{deployment.commitMessage}</p>
            <small><code>{deployment.commit}</code></small>
          </div>
          <time dateTime={deployment.updatedAt}>{formatRelativeTime(deployment.updatedAt)}</time>
          <FileText className="deployment-open-icon" size={15} />
        </button>
      ))}
    </div>
  );
}

export function Dashboard() {
  const Refresh = refreshCw;
  const Search = search;
  const SignOut = logOut;
  const Close = x;
  // The app list renders first; last deploys (one Coolify call per app) fill in when ready.
  const apps = useSWR<OverviewData>("/api/overview", fetcher, { refreshInterval: 60_000, revalidateOnFocus: true });
  const latestDeployments = useSWR<{ deployments: Deployment[] }>("/api/overview/deployments", fetcher, {
    // Poll quickly only while something is deploying; otherwise the data rarely changes.
    refreshInterval: (latest) => (
      latest?.deployments.some((deployment) => deployment.status === "in_progress" || deployment.status === "queued")
        ? 15_000
        : 60_000
    ),
    revalidateOnFocus: true,
  });
  const { data, error, isLoading } = apps;
  const isValidating = apps.isValidating || latestDeployments.isValidating;
  const deploymentsLoading = !latestDeployments.data && !latestDeployments.error;
  const databasesQuery = useSWR<{ databases: DatabaseListItem[] }>("/api/databases", fetcher, { refreshInterval: 60_000 });
  const databases = databasesQuery.data?.databases ?? [];
  const mutate = () => Promise.all([apps.mutate(), latestDeployments.mutate(), databasesQuery.mutate()]);
  const [activeView, setActiveView] = useState<View>("overview");
  const [query, setQuery] = useState<string>("");
  const [selectedApplication, setSelectedApplication] = useState<Application | null>(null);
  const [selectedDeployment, setSelectedDeployment] = useState<Deployment | null>(null);
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [serviceFilter, setServiceFilter] = useState<string>("all");
  const [deployingUuid, setDeployingUuid] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openAppUuid, setOpenAppUuid] = useState<string | null>(null);
  const [openDatabaseId, setOpenDatabaseId] = useState<string | null>(null);
  // Coolify-style hierarchy: project → environment → apps.
  const [selectedEnvironment, setSelectedEnvironment] = useState<{ projectUuid: string; environmentId: number } | null>(null);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());

  const applications = data?.applications ?? emptyApplications;
  const deployments = latestDeployments.data?.deployments ?? emptyDeployments;
  const lastDeployments = useMemo(() => {
    const latest = new Map<string, Deployment>();
    for (const deployment of deployments) {
      if (deployment.applicationUuid && !latest.has(deployment.applicationUuid)) latest.set(deployment.applicationUuid, deployment);
    }
    return latest;
  }, [deployments]);
  const projects = data?.projects ?? emptyProjects;
  const runningCount = applications.filter((application) => application.status === "running").length;
  const attentionCount = applications.filter((application) => application.status === "degraded").length;
  const activeDeployment = deployments.find(
    (deployment) => deployment.status === "in_progress" || deployment.status === "queued",
  );

  const filteredApplications = useMemo<Application[]>(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return applications;
    return applications.filter((application) =>
      [application.name, application.gitRepository, application.gitBranch, application.status]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [applications, query]);

  const sortedProjects = useMemo<Project[]>(
    () => [...projects].sort((left, right) => left.name.localeCompare(right.name)),
    [projects],
  );
  const activeProjectFilter = projectFilter === "all" || projects.some((project) => project.uuid === projectFilter)
    ? projectFilter
    : "all";
  const serviceOptions = useMemo<Application[]>(
    () => applications
      .filter((application) => activeProjectFilter === "all" || application.projectUuid === activeProjectFilter)
      .sort((left, right) => left.name.localeCompare(right.name)),
    [activeProjectFilter, applications],
  );
  const activeServiceFilter = serviceFilter === "all"
    || serviceOptions.some((application) => application.uuid === serviceFilter)
    ? serviceFilter
    : "all";
  const filteredDeployments = useMemo<Deployment[]>(
    () => deployments.filter((deployment) => (
      (activeProjectFilter === "all" || deployment.projectUuid === activeProjectFilter)
      && (activeServiceFilter === "all" || deployment.applicationUuid === activeServiceFilter)
    )),
    [activeProjectFilter, activeServiceFilter, deployments],
  );

  const deploy = async (application: Application) => {
    setDeployingUuid(application.uuid);

    try {
      const response = await fetch(`/api/applications/${application.uuid}/deploy`, { method: "POST" });
      const body = (await response.json()) as ApiMessage;
      if (!response.ok) throw new Error(body.message);
      setNotice(`${application.name}: ${body.message}`);
      await mutate();
    } catch (deployError) {
      setNotice(deployError instanceof Error ? deployError.message : "The deployment could not be started.");
    } finally {
      setDeployingUuid(null);
    }
  };

  const openApp = (application: Application) => {
    setOpenDatabaseId(null);
    setOpenAppUuid(application.uuid);
  };
  const openDatabase = (id: string) => {
    setOpenAppUuid(null);
    setSelectedEnvironment(null);
    setOpenDatabaseId(id);
  };
  const openDatabaseItem = databases.find((item) => item.id === openDatabaseId) ?? null;
  const openApplication = applications.find((application) => application.uuid === openAppUuid) ?? null;
  const changeView = (view: View) => {
    setOpenAppUuid(null);
    setOpenDatabaseId(null);
    setSelectedEnvironment(null);
    setActiveView(view);
  };
  const openEnvironment = (projectUuid: string, environmentId: number) => {
    setOpenAppUuid(null);
    setOpenDatabaseId(null);
    setSelectedEnvironment({ projectUuid, environmentId });
  };
  const toggleProject = (projectUuid: string) => setExpandedProjects((current) => {
    const next = new Set(current);
    if (next.has(projectUuid)) next.delete(projectUuid);
    else next.add(projectUuid);
    return next;
  });

  const appCountByEnvironment = useMemo(() => {
    const counts = new Map<number, number>();
    for (const application of applications) {
      if (application.environmentId !== null) counts.set(application.environmentId, (counts.get(application.environmentId) ?? 0) + 1);
    }
    return counts;
  }, [applications]);
  const environmentProject = selectedEnvironment ? projects.find((project) => project.uuid === selectedEnvironment.projectUuid) ?? null : null;
  const environment = environmentProject?.environments.find((item) => item.id === selectedEnvironment?.environmentId) ?? null;
  const environmentApplications = useMemo(
    () => applications.filter((application) => application.environmentId === selectedEnvironment?.environmentId),
    [applications, selectedEnvironment],
  );
  const openAppProject = openApplication ? projects.find((project) => project.uuid === openApplication.projectUuid) ?? null : null;
  const openAppEnvironment = openAppProject?.environments.find((item) => item.id === openApplication?.environmentId) ?? null;
  const breadcrumbs: string[] = openDatabaseId
    ? ["Databases", openDatabaseItem?.name ?? "Database"]
    : openApplication
    ? [openAppProject?.name ?? "Applications", openAppEnvironment?.name ?? "", openApplication.name].filter(Boolean)
    : environmentProject && environment
      ? [environmentProject.name, environment.name]
      : [{ overview: "Overview", applications: "Applications", deployments: "Deployments", databases: "Databases", usage: "Usage" }[activeView]];

  const signOut = async () => {
    await fetch("/api/auth/sign-out", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    window.location.reload();
  };

  const headline = attentionCount
    ? `${attentionCount} ${attentionCount === 1 ? "application needs" : "applications need"} attention`
    : activeDeployment
      ? `${activeDeployment.applicationName} is deploying`
      : "Systems are steady";

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Main navigation">
        <div className="brand">
          <span className="brand-mark"><span /><span /><span /></span>
          <div><strong>Codeva Console</strong><small>{data?.instanceName ?? "Managed infrastructure"}</small></div>
        </div>
        <nav className="sidebar-nav">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = !openApplication && !selectedEnvironment && !openDatabaseId && activeView === item.id;
            return (
              <button className={active ? "active" : ""} onClick={() => changeView(item.id)} key={item.id}>
                <Icon size={15} /> {item.label}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-section">
          <span className="sidebar-label">Projects</span>
          {sortedProjects.map((project) => {
            const Chevron = chevronRight;
            const FolderIcon = folder;
            const LayersIcon = layers;
            const expanded = expandedProjects.has(project.uuid)
              || selectedEnvironment?.projectUuid === project.uuid
              || openApplication?.projectUuid === project.uuid;
            return (
              <div className="tree-project" key={project.uuid}>
                <button className="tree-row" onClick={() => toggleProject(project.uuid)} aria-expanded={expanded}>
                  <Chevron size={13} className={`tree-chevron ${expanded ? "open" : ""}`} />
                  <FolderIcon size={14} />
                  <span>{project.name}</span>
                </button>
                {expanded ? project.environments.map((item) => {
                  const active = (selectedEnvironment?.environmentId === item.id && !openApplication) || openApplication?.environmentId === item.id;
                  return (
                    <button className={`tree-row tree-environment ${active ? "active" : ""}`} onClick={() => openEnvironment(project.uuid, item.id)} key={item.id}>
                      <LayersIcon size={13} />
                      <span>{item.name}</span>
                      <small>{appCountByEnvironment.get(item.id) ?? 0}</small>
                    </button>
                  );
                }) : null}
              </div>
            );
          })}
        </div>
        {databases.length ? (
          <div className="sidebar-section sidebar-section-compact">
            <span className="sidebar-label">Databases</span>
            {databases.map((item) => {
              const DbIcon = databaseIcon;
              return (
                <button className={`tree-row ${openDatabaseId === item.id ? "active" : ""}`} onClick={() => openDatabase(item.id)} key={item.id}>
                  <DbIcon size={14} />
                  <span>{item.name}</span>
                  <small className={`tree-status ${item.up === false ? "down" : ""}`} />
                </button>
              );
            })}
          </div>
        ) : null}
        <div className="sidebar-footer">
          <button className="icon-button" onClick={() => mutate()} aria-label="Refresh data" disabled={isValidating}>
            <Refresh className={isValidating ? "spin" : ""} size={15} />
          </button>
          <button className="text-button sidebar-signout" onClick={signOut}><SignOut size={14} /> Sign out</button>
        </div>
      </aside>

      <div className="content-column">
      <main className="main-content">
        <section className="page-heading">
          <div>
            {breadcrumbs.length > 1 ? (
              <nav className="breadcrumbs" aria-label="Breadcrumb">
                {breadcrumbs.map((crumb, index) => <span key={`${crumb}-${index}`}>{crumb}</span>)}
              </nav>
            ) : null}
            {openApplication || openDatabaseId ? null : <h1>{breadcrumbs[breadcrumbs.length - 1]}</h1>}
          </div>
          {data ? <span className="last-updated">Updated {formatRelativeTime(data.refreshedAt)}</span> : null}
        </section>

        {/* App data comes from Coolify; the Databases pages use Grafana and render regardless. */}
        {error && !openDatabaseId && activeView !== "databases" ? (
          <section className="page-error">
            <div><strong>Service unavailable</strong><span>{error.message}</span></div>
            <button className="secondary-button" onClick={() => mutate()}>Try again</button>
          </section>
        ) : null}

        {isLoading && !openDatabaseId && activeView !== "databases" ? <DashboardSkeleton /> : null}

        {!isLoading && !error && !openDatabaseId && !openApplication && !selectedEnvironment && activeView === "overview" ? (
          <div className="overview-layout">
            <section className="status-rail">
              <div className={`status-orb ${attentionCount ? "warning" : ""}`}><span /></div>
              <div className="status-copy">
                <span className="utility-label">Live status</span>
                <h2>{headline}</h2>
                <p>{activeDeployment ? "A release is currently in progress." : "No active deployments right now."}</p>
              </div>
              <div className="status-metrics" aria-label="Instance summary">
                <div><strong>{applications.length}</strong><span>Applications</span></div>
                <div><strong>{runningCount}</strong><span>Running</span></div>
                <div><strong>{deploymentsLoading ? "…" : deployments.length}</strong><span>Recent deploys</span></div>
              </div>
            </section>

            <section className="panel overview-applications">
              <div className="panel-heading">
                <div><h2>Applications</h2><p>Current runtime state</p></div>
                <button className="text-button" onClick={() => changeView("applications")}>View all</button>
              </div>
              <ApplicationList
                applications={applications.slice(0, 5)}
                deployingUuid={deployingUuid}
                onDeploy={deploy}
                onEnvironment={setSelectedApplication}
                onOpen={openApp}
                lastDeployments={lastDeployments}
              />
            </section>

            <section className="panel overview-deployments">
              <div className="panel-heading">
                <div><h2>Recent activity</h2><p>Latest deployment outcomes</p></div>
                <button className="text-button" onClick={() => changeView("deployments")}>View all</button>
              </div>
              <DeploymentList deployments={deployments.slice(0, 5)} onSelect={setSelectedDeployment} loading={deploymentsLoading} />
            </section>
          </div>
        ) : null}

        {!isLoading && !error && !openDatabaseId && !openApplication && !selectedEnvironment && activeView === "applications" ? (
          <section className="panel page-panel">
            <div className="panel-heading panel-toolbar">
              <div><h2>All applications</h2><p>{filteredApplications.length} of {applications.length}</p></div>
              <label className="search-field">
                <Search size={15} />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search applications"
                  aria-label="Search applications"
                />
              </label>
            </div>
            <ApplicationList
              applications={filteredApplications}
              deployingUuid={deployingUuid}
              onDeploy={deploy}
              onEnvironment={setSelectedApplication}
              onOpen={openApp}
                lastDeployments={lastDeployments}
            />
          </section>
        ) : null}

        {!isLoading && !error && !openDatabaseId && !openApplication && !selectedEnvironment && activeView === "deployments" ? (
          <section className="panel page-panel">
            <div className="panel-heading deployment-toolbar">
              <div><h2>Deployment history</h2><p>{filteredDeployments.length} of {deployments.length} recent events</p></div>
              <div className="deployment-filters">
                <label className="project-filter">
                  <span>Project</span>
                  <select
                    value={activeProjectFilter}
                    onChange={(event) => {
                      setProjectFilter(event.target.value);
                      setServiceFilter("all");
                    }}
                    aria-label="Filter deployments by project"
                  >
                    <option value="all">All projects</option>
                    {sortedProjects.map((project) => (
                      <option value={project.uuid} key={project.uuid}>{project.name}</option>
                    ))}
                  </select>
                </label>
                <label className="project-filter">
                  <span>Service</span>
                  <select
                    value={activeServiceFilter}
                    onChange={(event) => setServiceFilter(event.target.value)}
                    aria-label="Filter deployments by service"
                    disabled={!serviceOptions.length}
                  >
                    <option value="all">All services</option>
                    {serviceOptions.map((application) => (
                      <option value={application.uuid} key={application.uuid}>{application.name}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            <DeploymentList deployments={filteredDeployments} onSelect={setSelectedDeployment} loading={deploymentsLoading} />
          </section>
        ) : null}
        {!isLoading && !error && !openDatabaseId && openApplication ? (
          <AppView
            key={openApplication.uuid}
            application={openApplication}
            deploying={deployingUuid === openApplication.uuid}
            onBack={() => setOpenAppUuid(null)}
            onDeploy={() => deploy(openApplication)}
            onEnvironment={() => setSelectedApplication(openApplication)}
            onSelectDeployment={setSelectedDeployment}
            onNotice={setNotice}
          />
        ) : null}

        {!isLoading && !error && !openDatabaseId && !openApplication && selectedEnvironment ? (
          <section className="panel page-panel">
            <div className="panel-heading">
              <div><h2>Applications</h2><p>{environmentApplications.length} in {environment?.name ?? "this environment"}</p></div>
            </div>
            <ApplicationList
              applications={environmentApplications}
              deployingUuid={deployingUuid}
              onDeploy={deploy}
              onEnvironment={setSelectedApplication}
              onOpen={openApp}
              lastDeployments={lastDeployments}
            />
          </section>
        ) : null}

        {!openDatabaseId && !openApplication && !selectedEnvironment && activeView === "databases" ? (
          databasesQuery.error
            ? <section className="page-error"><div><strong>Databases are unavailable</strong><span>{databasesQuery.error.message}</span></div></section>
            : !databasesQuery.data
              ? <div className="skeleton skeleton-panel" />
              : <DatabaseList databases={databases} onOpen={openDatabase} />
        ) : null}

        {openDatabaseId ? (
          <DatabaseView key={openDatabaseId} id={openDatabaseId} onBack={() => changeView("databases")} />
        ) : null}

        {!isLoading && !error && !openDatabaseId && !openApplication && !selectedEnvironment && activeView === "usage" ? (
          <UsageView onOpenApp={(uuid) => setOpenAppUuid(uuid)} />
        ) : null}
      </main>
      </div>

      {selectedApplication ? (
        <EnvironmentDrawer application={selectedApplication} onClose={() => setSelectedApplication(null)} onNotice={setNotice} />
      ) : null}

      {selectedDeployment ? (
        <DeploymentLogDrawer deployment={selectedDeployment} onClose={() => setSelectedDeployment(null)} />
      ) : null}

      {notice ? (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss notification"><Close size={14} /></button>
        </div>
      ) : null}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="skeleton-wrap" aria-label="Loading dashboard">
      <div className="skeleton skeleton-status" />
      <div className="skeleton-grid">
        <div className="skeleton skeleton-panel" />
        <div className="skeleton skeleton-panel" />
      </div>
    </div>
  );
}
