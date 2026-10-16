import { assertResourceUuid } from "@/lib/grafana";

// LogQL string literal: escape backslashes and quotes so search text can't alter the query.
const logqlString = (value: string): string => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

// Selector for one app's container logs, optionally filtered by a case-insensitive literal search.
// The uuid must already be confirmed as belonging to the tenant (lib/ownership.ts).
export const buildAppLogQuery = (uuid: string, search: string): string => {
  let query = `{coolify_applicationUuid="${assertResourceUuid(uuid)}"}`;
  const term = search.slice(0, 200);
  if (term) query += ` |~ ${logqlString(`(?i)${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)}`;
  return query;
};
