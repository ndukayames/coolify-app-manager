import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { TenantSession } from "@/lib/auth";
import { db } from "@/lib/db";

// A client Postgres cluster as stored. server/cluster/exporterInstance/pgbouncerUnit/replica*
// are internal: they are spliced into PromQL (lib/db-metrics.ts) and will address the DB agent,
// so they must never be sent to the browser. Use toPublicDatabase for anything client-facing.
export type TenantDatabase = {
  id: string;
  tenantId: string;
  displayName: string;
  engine: string;
  server: string;
  cluster: string;
  exporterInstance: string;
  pgbouncerUnit: string | null;
  replicaServer: string | null;
  replicaInstance: string | null;
  cpuAllocation: number | null;
  memoryMbAllocation: number | null;
  storageGbAllocation: number | null;
};

export type Plan = { cpu: number | null; memoryMb: number | null; storageGb: number | null };

// The only shape the browser sees.
export type PublicDatabase = {
  id: string;
  name: string;
  engine: string;
  hasReplica: boolean;
  plan: Plan;
};

export const toPublicDatabase = (database: TenantDatabase): PublicDatabase => ({
  id: database.id,
  name: database.displayName,
  engine: database.engine,
  hasReplica: database.replicaInstance !== null,
  plan: {
    cpu: database.cpuAllocation,
    memoryMb: database.memoryMbAllocation,
    storageGb: database.storageGbAllocation,
  },
});

type Row = {
  id: string;
  tenant_id: string;
  display_name: string;
  engine: string;
  server: string;
  cluster: string;
  exporter_instance: string;
  pgbouncer_unit: string | null;
  replica_server: string | null;
  replica_instance: string | null;
  cpu_allocation: number | null;
  memory_mb_allocation: number | null;
  storage_gb_allocation: number | null;
};

const columns = `id, tenant_id, display_name, engine, server, cluster, exporter_instance, pgbouncer_unit,
  replica_server, replica_instance, cpu_allocation, memory_mb_allocation, storage_gb_allocation`;

const fromRow = (row: Row): TenantDatabase => ({
  id: row.id,
  tenantId: row.tenant_id,
  displayName: row.display_name,
  engine: row.engine,
  server: row.server,
  cluster: row.cluster,
  exporterInstance: row.exporter_instance,
  pgbouncerUnit: row.pgbouncer_unit,
  replicaServer: row.replica_server,
  replicaInstance: row.replica_instance,
  cpuAllocation: row.cpu_allocation,
  memoryMbAllocation: row.memory_mb_allocation,
  storageGbAllocation: row.storage_gb_allocation,
});

// Strict allow-lists: these values end up inside PromQL string literals and, later, DB agent calls.
const patterns = {
  label: /^[a-z0-9_.-]{1,64}$/,
  cluster: /^[0-9]{1,2}-[a-z0-9_]{1,48}$/,
  unit: /^[a-z0-9_@.-]{1,64}$/,
} as const;

const assertMatch = (label: string, pattern: RegExp, value: string): string => {
  if (!pattern.test(value)) throw new Error(`Invalid ${label}: ${value}`);
  return value;
};

export type NewDatabase = {
  tenantId: string;
  displayName: string;
  // Prometheus `server` label of the host, e.g. "prod-db-london" or "pisi-db".
  server: string;
  // Debian-style cluster id, e.g. "18-gridx" or "16-main". Unique per server, not globally.
  cluster: string;
  exporterInstance: string;
  pgbouncerUnit?: string | null;
  replicaServer?: string | null;
  replicaInstance?: string | null;
  cpuAllocation?: number | null;
  memoryMbAllocation?: number | null;
  storageGbAllocation?: number | null;
};

export const addDatabase = (input: NewDatabase): string => {
  const displayName = input.displayName.trim();
  if (!displayName || displayName.length > 80) throw new Error("Display name must be 1-80 characters.");
  if ((input.replicaServer ?? null) === null !== ((input.replicaInstance ?? null) === null)) {
    throw new Error("Replica needs both a server and an exporter instance.");
  }

  const id = randomUUID();
  db.prepare(`
    INSERT INTO tenant_database (id, tenant_id, display_name, server, cluster, exporter_instance, pgbouncer_unit,
      replica_server, replica_instance, cpu_allocation, memory_mb_allocation, storage_gb_allocation)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.tenantId,
    displayName,
    assertMatch("server", patterns.label, input.server),
    assertMatch("cluster", patterns.cluster, input.cluster),
    assertMatch("exporter instance", patterns.label, input.exporterInstance),
    input.pgbouncerUnit ? assertMatch("PgBouncer unit", patterns.unit, input.pgbouncerUnit) : null,
    input.replicaServer ? assertMatch("replica server", patterns.label, input.replicaServer) : null,
    input.replicaInstance ? assertMatch("replica instance", patterns.label, input.replicaInstance) : null,
    input.cpuAllocation ?? null,
    input.memoryMbAllocation ?? null,
    input.storageGbAllocation ?? null,
  );
  return id;
};

export const removeDatabase = (tenantId: string, server: string, cluster: string): boolean =>
  db.prepare("DELETE FROM tenant_database WHERE tenant_id = ? AND server = ? AND cluster = ?").run(tenantId, server, cluster)
    .changes > 0;

export const listTenantDatabases = (tenantId: string): TenantDatabase[] =>
  (db.prepare(`SELECT ${columns} FROM tenant_database WHERE tenant_id = ? ORDER BY display_name`).all(tenantId) as Row[]).map(
    fromRow,
  );

// Same role as requireOwnedApp: every database route calls this first. The lookup is scoped by
// tenant_id, so a foreign or random id is indistinguishable from a missing one.
export const requireOwnedDatabase = (session: TenantSession, id: string): TenantDatabase | NextResponse => {
  const notFound = () => NextResponse.json({ message: "That resource was not found." }, { status: 404 });
  if (!/^[0-9a-f-]{36}$/.test(id)) return notFound();
  const row = db
    .prepare(`SELECT ${columns} FROM tenant_database WHERE id = ? AND tenant_id = ?`)
    .get(id, session.tenant.id) as Row | undefined;
  return row ? fromRow(row) : notFound();
};

// Admin-only helpers. Callers have already checked requireAdminSession.

export const updateDatabase = (
  id: string,
  changes: { displayName?: string; cpuAllocation?: number | null; memoryMbAllocation?: number | null; storageGbAllocation?: number | null },
): void => {
  const current = db.prepare(`SELECT ${columns} FROM tenant_database WHERE id = ?`).get(id) as Row | undefined;
  if (!current) throw new Error("Database not found.");
  const displayName = changes.displayName?.trim() ?? current.display_name;
  if (!displayName || displayName.length > 80) throw new Error("Display name must be 1-80 characters.");
  db.prepare(`UPDATE tenant_database SET display_name = ?, cpu_allocation = ?, memory_mb_allocation = ?, storage_gb_allocation = ? WHERE id = ?`).run(
    displayName,
    changes.cpuAllocation !== undefined ? changes.cpuAllocation : current.cpu_allocation,
    changes.memoryMbAllocation !== undefined ? changes.memoryMbAllocation : current.memory_mb_allocation,
    changes.storageGbAllocation !== undefined ? changes.storageGbAllocation : current.storage_gb_allocation,
    id,
  );
};

export const removeDatabaseById = (id: string): void => {
  db.prepare("DELETE FROM tenant_database WHERE id = ?").run(id);
};

// Internal view for /admin only: includes server/cluster so the admin can tell instances apart.
export type AdminDatabase = PublicDatabase & {
  server: string;
  cluster: string;
  exporterInstance: string;
  pgbouncerUnit: string | null;
  replica: string | null;
};

export const toAdminDatabase = (database: TenantDatabase): AdminDatabase => ({
  ...toPublicDatabase(database),
  server: database.server,
  cluster: database.cluster,
  exporterInstance: database.exporterInstance,
  pgbouncerUnit: database.pgbouncerUnit,
  replica: database.replicaInstance ? `${database.replicaServer}/${database.replicaInstance}` : null,
});
