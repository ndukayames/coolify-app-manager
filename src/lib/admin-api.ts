import { privateJson } from "@/lib/api-response";
import { CoolifyApiError, coolifyRequest } from "@/lib/coolify";
import { getGrafanaConfig } from "@/lib/grafana";

// Shared helpers for /api/admin routes. Every route calls requireAdminSession first.

export const badRequest = (message: string) => privateJson({ message }, { status: 400 });

export const readJson = async <T>(request: Request): Promise<Partial<T>> =>
  ((await request.json().catch(() => ({}))) ?? {}) as Partial<T>;

// Confirms a Coolify team token works and returns the project names it can see, so the admin can
// spot a wrong or root-team token before saving it.
export const checkCoolifyToken = async (token: string): Promise<string[]> => {
  try {
    const projects = await coolifyRequest<{ name: string }[]>(token, "/projects");
    return projects.map((project) => project.name).sort();
  } catch (error) {
    throw new Error(error instanceof CoolifyApiError && error.status === 502
      ? "Coolify rejected that token. Check it was created in the client's team with read, read:sensitive, write and deploy."
      : "Coolify could not be reached to check the token. Try again.");
  }
};

// Confirms a Grafana service-account token works and its org has Prometheus and Loki datasources.
export const checkGrafanaToken = async (token: string): Promise<void> => {
  const { url } = getGrafanaConfig(token);
  const response = await fetch(`${url}/api/datasources`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!response.ok) throw new Error("Grafana rejected that token.");
  const types = new Set(((await response.json()) as { type: string }[]).map((datasource) => datasource.type));
  if (!types.has("prometheus") || !types.has("loki")) {
    throw new Error("That Grafana org needs both a Prometheus and a Loki datasource.");
  }
};

export const optionalPositive = (value: unknown, label: string, integer = false): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!(parsed > 0) || (integer && !Number.isInteger(parsed))) throw new Error(`${label} must be a positive ${integer ? "whole number" : "number"}.`);
  return parsed;
};
