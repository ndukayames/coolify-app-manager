import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

// One SQLite file holds Better Auth's tables and our tenant table.
// In production DATABASE_PATH must sit on a persistent volume.
// Runtime path, not a build input: tell Turbopack not to trace it.
const databasePath = resolve(/*turbopackIgnore: true*/ process.env.DATABASE_PATH ?? "data/app.db");
mkdirSync(dirname(databasePath), { recursive: true });

const globalForDb = globalThis as unknown as { sqlite?: Database.Database };

// Reuse the connection across dev hot reloads instead of opening a new handle each time.
export const db = globalForDb.sqlite ?? new Database(databasePath);
globalForDb.sqlite = db;

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS tenant (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    coolify_token TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);


// Optional Grafana service-account token from the client's own Grafana org (encrypted).
const tenantColumns = db.prepare("PRAGMA table_info(tenant)").all() as { name: string }[];
if (!tenantColumns.some((column) => column.name === "grafana_token")) {
  db.exec("ALTER TABLE tenant ADD COLUMN grafana_token TEXT");
}

// Agreed resources per app, for display against actual usage. Not enforced: clients may
// burst above it under their SLA.
db.exec(`
  CREATE TABLE IF NOT EXISTS allocation (
    app_uuid TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    cpu REAL NOT NULL,
    memory_mb INTEGER NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// One row per client Postgres cluster. Only id, display_name, engine and the plan numbers reach
// the browser; server, cluster, exporter and unit names are internal (spliced into PromQL, and
// later used by the DB agent) and are validated on write in lib/databases.ts.
// An earlier shape of this table (with log columns) only ever held local test rows, so it is
// replaced rather than migrated.
const databaseColumns = db.prepare("PRAGMA table_info(tenant_database)").all() as { name: string }[];
if (databaseColumns.some((column) => column.name === "log_filename")) db.exec("DROP TABLE tenant_database");

db.exec(`
  CREATE TABLE IF NOT EXISTS tenant_database (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    engine TEXT NOT NULL DEFAULT 'postgresql',
    server TEXT NOT NULL,
    cluster TEXT NOT NULL,
    exporter_instance TEXT NOT NULL,
    pgbouncer_unit TEXT,
    replica_server TEXT,
    replica_instance TEXT,
    cpu_allocation REAL,
    memory_mb_allocation INTEGER,
    storage_gb_allocation INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (server, cluster),
    UNIQUE (server, exporter_instance)
  )
`);
