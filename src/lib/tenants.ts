import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/secrets";
import type { Allocation } from "@/lib/types";

export type Tenant = {
  id: string;
  name: string;
  // Token scoped to this client's Coolify team. Coolify itself refuses access
  // to anything outside that team, which is the real isolation boundary.
  coolifyToken: string;
  // Service-account token from the client's own Grafana org, if set. Grafana queries use it
  // instead of the instance-wide GRAFANA_TOKEN.
  grafanaToken: string | null;
};

type TenantRow = { id: string; name: string; coolify_token: string; grafana_token: string | null };

export const getTenant = (id: string): Tenant | null => {
  const row = db.prepare("SELECT id, name, coolify_token, grafana_token FROM tenant WHERE id = ?").get(id) as
    | TenantRow
    | undefined;
  return row
    ? {
      id: row.id,
      name: row.name,
      coolifyToken: decryptSecret(row.coolify_token),
      grafanaToken: row.grafana_token ? decryptSecret(row.grafana_token) : null,
    }
    : null;
};

export const getTenantByName = (name: string): Tenant | null => {
  const row = db.prepare("SELECT id FROM tenant WHERE name = ?").get(name) as { id: string } | undefined;
  return row ? getTenant(row.id) : null;
};

export const createTenant = (name: string, coolifyToken: string): string => {
  const id = randomUUID();
  db.prepare("INSERT INTO tenant (id, name, coolify_token) VALUES (?, ?, ?)").run(id, name, encryptSecret(coolifyToken));
  return id;
};

export const setTenantToken = (id: string, coolifyToken: string): void => {
  db.prepare("UPDATE tenant SET coolify_token = ? WHERE id = ?").run(encryptSecret(coolifyToken), id);
};

export const setTenantGrafanaToken = (id: string, grafanaToken: string | null): void => {
  db.prepare("UPDATE tenant SET grafana_token = ? WHERE id = ?").run(grafanaToken ? encryptSecret(grafanaToken) : null, id);
};

export const renameTenant = (id: string, name: string): void => {
  db.prepare("UPDATE tenant SET name = ? WHERE id = ?").run(name, id);
};

// Removes the client, its users and their sessions; databases and plans cascade.
export const deleteTenant = (id: string): void => {
  db.transaction(() => {
    db.prepare("DELETE FROM session WHERE userId IN (SELECT id FROM user WHERE tenantId = ?)").run(id);
    db.prepare("DELETE FROM account WHERE userId IN (SELECT id FROM user WHERE tenantId = ?)").run(id);
    db.prepare("DELETE FROM user WHERE tenantId = ?").run(id);
    db.prepare("DELETE FROM tenant WHERE id = ?").run(id);
  })();
};

export type TenantOverview = { id: string; name: string; users: number; databases: number; hasGrafanaToken: boolean; createdAt: string };

export const listTenantOverviews = (): TenantOverview[] =>
  (db.prepare(`
    SELECT t.id, t.name, t.created_at AS createdAt, t.grafana_token IS NOT NULL AS hasGrafanaToken,
      (SELECT COUNT(*) FROM user u WHERE u.tenantId = t.id) AS users,
      (SELECT COUNT(*) FROM tenant_database d WHERE d.tenant_id = t.id) AS databases
    FROM tenant t ORDER BY t.name
  `).all() as (Omit<TenantOverview, "hasGrafanaToken"> & { hasGrafanaToken: number })[]).map((row) => ({
    ...row,
    hasGrafanaToken: row.hasGrafanaToken === 1,
  }));

export const listTenants = (): { id: string; name: string }[] =>
  db.prepare("SELECT id, name FROM tenant ORDER BY name").all() as { id: string; name: string }[];

export const getAllocations = (tenantId: string): Map<string, Allocation> => {
  const rows = db.prepare("SELECT app_uuid, cpu, memory_mb FROM allocation WHERE tenant_id = ?").all(tenantId) as {
    app_uuid: string;
    cpu: number;
    memory_mb: number;
  }[];
  return new Map(rows.map((row) => [row.app_uuid, { cpu: row.cpu, memoryMb: row.memory_mb }]));
};

export const setAllocation = (tenantId: string, appUuid: string, allocation: Allocation): void => {
  db.prepare(`
    INSERT INTO allocation (app_uuid, tenant_id, cpu, memory_mb) VALUES (?, ?, ?, ?)
    ON CONFLICT(app_uuid) DO UPDATE SET tenant_id = excluded.tenant_id, cpu = excluded.cpu,
      memory_mb = excluded.memory_mb, updated_at = datetime('now')
  `).run(appUuid, tenantId, allocation.cpu, allocation.memoryMb);
};

export const removeAllocation = (tenantId: string, appUuid: string): void => {
  db.prepare("DELETE FROM allocation WHERE tenant_id = ? AND app_uuid = ?").run(tenantId, appUuid);
};
