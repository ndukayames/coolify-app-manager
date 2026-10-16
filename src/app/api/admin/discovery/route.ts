import { NextResponse } from "next/server";
import { privateJson } from "@/lib/api-response";
import { requireAdminSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { promQuery } from "@/lib/grafana";

// Postgres instances reporting to Prometheus, for the "register database" form. The admin picks
// one instead of typing exporter labels; the cluster id (e.g. "16-main") still has to be typed,
// since exporters don't report it, but the version and port are shown as a hint.
export async function GET(): Promise<Response> {
  const session = await requireAdminSession();
  if (session instanceof NextResponse) return session;

  const [instances, replicas] = await Promise.all([
    promQuery("max by (server, instance, exported_server, short_version) (pg_static)"),
    promQuery("max by (server, instance) (pg_replication_lag_is_replica)"),
  ]);
  const isReplica = new Set(replicas.filter((sample) => sample.value[1] === "1").map((sample) => `${sample.metric.server}/${sample.metric.instance}`));
  const registered = new Map(
    (db.prepare(`SELECT d.server, d.exporter_instance, t.name FROM tenant_database d JOIN tenant t ON t.id = d.tenant_id`).all() as {
      server: string;
      exporter_instance: string;
      name: string;
    }[]).map((row) => [`${row.server}/${row.exporter_instance}`, row.name]),
  );

  const list = instances
    .filter((sample) => sample.metric.server && sample.metric.instance)
    .map((sample) => {
      const key = `${sample.metric.server}/${sample.metric.instance}`;
      return {
        server: sample.metric.server,
        instance: sample.metric.instance,
        version: sample.metric.short_version?.replace(/\.0$/, "") ?? null,
        port: sample.metric.exported_server?.split(":")[1] ?? null,
        isReplica: isReplica.has(key),
        registeredTo: registered.get(key) ?? null,
      };
    })
    .sort((left, right) => `${left.server}/${left.instance}`.localeCompare(`${right.server}/${right.instance}`));

  return privateJson({ instances: list });
}
