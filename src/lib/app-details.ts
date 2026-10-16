import type { CoolifyApplicationDetails } from "@/lib/coolify";
import type { AppDetails } from "@/lib/types";

// Two allow-lists live here:
//  - toAppDetails: the only application fields that ever reach the browser.
//  - toCoolifyChanges: the only fields a client may change. Repository, git source, server,
//    resource limits, custom Docker options and labels are deliberately absent: they either
//    move the app to someone else's code or let a container escape onto the shared host.

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const nullableText = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const num = (value: unknown, fallback: number): number => (typeof value === "number" ? value : fallback);
const bool = (value: unknown): boolean => value === true;

const repositoryName = (repository: string): string => repository.replace(/\.git$/, "").split("/").slice(-2).join("/");

export const toAppDetails = (raw: CoolifyApplicationDetails): AppDetails => {
  const settings = raw.settings ?? {};

  return {
    uuid: raw.uuid,
    name: raw.name,
    description: text(raw.description),
    status: text(raw.status).split(":")[0] || "unknown",
    buildPack: text(raw.build_pack),
    repository: repositoryName(text(raw.git_repository)),
    branch: text(raw.git_branch),
    domains: text(raw.fqdn).split(",").map((domain) => domain.trim()).filter(Boolean),
    redirect: text(raw.redirect) || "both",
    forceHttps: bool(settings.is_force_https_enabled),
    portsExposes: text(raw.ports_exposes),
    portsMappings: nullableText(raw.ports_mappings),
    installCommand: text(raw.install_command),
    buildCommand: text(raw.build_command),
    startCommand: text(raw.start_command),
    baseDirectory: text(raw.base_directory) || "/",
    publishDirectory: text(raw.publish_directory),
    watchPaths: text(raw.watch_paths),
    customDockerRunOptions: nullableText(raw.custom_docker_run_options),
    preDeploymentCommand: text(raw.pre_deployment_command),
    preDeploymentCommandContainer: text(raw.pre_deployment_command_container),
    postDeploymentCommand: text(raw.post_deployment_command),
    postDeploymentCommandContainer: text(raw.post_deployment_command_container),
    autoDeploy: bool(settings.is_auto_deploy_enabled),
    dockerImagesToKeep: num(settings.docker_images_to_keep, 2),
    healthCheck: {
      enabled: bool(raw.health_check_enabled),
      path: text(raw.health_check_path) || "/",
      port: text(raw.health_check_port),
      host: text(raw.health_check_host) || "localhost",
      method: text(raw.health_check_method) || "GET",
      scheme: text(raw.health_check_scheme) || "http",
      returnCode: num(raw.health_check_return_code, 200),
      responseText: text(raw.health_check_response_text),
      interval: num(raw.health_check_interval, 5),
      timeout: num(raw.health_check_timeout, 5),
      retries: num(raw.health_check_retries, 10),
      startPeriod: num(raw.health_check_start_period, 5),
    },
  };
};

export class ValidationError extends Error {}

const reservedDomainSuffixes = (process.env.RESERVED_DOMAIN_SUFFIXES ?? "thecodeva.com,reel-traffic.com")
  .split(",")
  .map((suffix) => suffix.trim().toLowerCase())
  .filter(Boolean);

const parseDomain = (value: string): string => {
  let url: URL;
  try {
    url = new URL(value.includes("://") ? value : `https://${value}`);
  } catch {
    throw new ValidationError(`"${value}" is not a valid domain.`);
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new ValidationError(`"${value}" is not a valid domain.`);
  }
  const host = url.hostname.toLowerCase();
  if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(host)) throw new ValidationError(`"${value}" is not a valid domain.`);
  // Our own infrastructure domains can only be assigned by Codeva.
  if (reservedDomainSuffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) {
    throw new ValidationError(`${host} is reserved. Contact Codeva to use it.`);
  }
  return `${url.protocol}//${host}${url.port ? `:${url.port}` : ""}${url.pathname === "/" ? "" : url.pathname}`;
};

type FieldRule = {
  key: string;
  parse: (value: unknown) => unknown;
};

const asText = (max = 2000) => (value: unknown) => {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length > max) throw new ValidationError("A text field is invalid or too long.");
  return value.trim() === "" ? null : value;
};
const asBool = (value: unknown) => {
  if (typeof value !== "boolean") throw new ValidationError("A toggle field is invalid.");
  return value;
};
const asInt = (min: number, max: number) => (value: unknown) => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new ValidationError(`A number field must be between ${min} and ${max}.`);
  }
  return value;
};
const oneOf = (...options: string[]) => (value: unknown) => {
  if (typeof value !== "string" || !options.includes(value)) throw new ValidationError("A selection field is invalid.");
  return value;
};

const editableFields: Record<string, FieldRule> = {
  branch: {
    key: "git_branch",
    parse: (value) => {
      if (typeof value !== "string" || !/^[\w./-]{1,200}$/.test(value) || value.includes("..")) {
        throw new ValidationError("Branch name is invalid.");
      }
      return value;
    },
  },
  domains: {
    key: "domains",
    parse: (value) => {
      if (!Array.isArray(value) || value.length > 20) throw new ValidationError("Domains must be a list.");
      return value.map((domain) => parseDomain(String(domain).trim())).join(",");
    },
  },
  redirect: { key: "redirect", parse: oneOf("www", "non-www", "both") },
  forceHttps: { key: "is_force_https_enabled", parse: asBool },
  portsExposes: {
    key: "ports_exposes",
    parse: (value) => {
      if (typeof value !== "string" || !/^\d{1,5}(,\d{1,5})*$/.test(value)) {
        throw new ValidationError("Exposed ports must be comma-separated port numbers.");
      }
      return value;
    },
  },
  installCommand: { key: "install_command", parse: asText() },
  buildCommand: { key: "build_command", parse: asText() },
  startCommand: { key: "start_command", parse: asText() },
  baseDirectory: { key: "base_directory", parse: asText(255) },
  publishDirectory: { key: "publish_directory", parse: asText(255) },
  watchPaths: { key: "watch_paths", parse: asText() },
  preDeploymentCommand: { key: "pre_deployment_command", parse: asText() },
  preDeploymentCommandContainer: { key: "pre_deployment_command_container", parse: asText(255) },
  postDeploymentCommand: { key: "post_deployment_command", parse: asText() },
  postDeploymentCommandContainer: { key: "post_deployment_command_container", parse: asText(255) },
  autoDeploy: { key: "is_auto_deploy_enabled", parse: asBool },
  dockerImagesToKeep: { key: "docker_images_to_keep", parse: asInt(0, 20) },
};

const healthCheckFields: Record<string, FieldRule> = {
  enabled: { key: "health_check_enabled", parse: asBool },
  path: { key: "health_check_path", parse: asText(255) },
  port: { key: "health_check_port", parse: (value) => (value === "" || value === null ? null : asText(5)(value)) },
  host: { key: "health_check_host", parse: asText(255) },
  method: { key: "health_check_method", parse: oneOf("GET", "POST", "HEAD") },
  scheme: { key: "health_check_scheme", parse: oneOf("http", "https") },
  returnCode: { key: "health_check_return_code", parse: asInt(100, 599) },
  responseText: { key: "health_check_response_text", parse: asText(255) },
  interval: { key: "health_check_interval", parse: asInt(1, 3600) },
  timeout: { key: "health_check_timeout", parse: asInt(1, 3600) },
  retries: { key: "health_check_retries", parse: asInt(1, 100) },
  startPeriod: { key: "health_check_start_period", parse: asInt(0, 3600) },
};

// Unknown keys are rejected rather than ignored, so a client can't probe for fields we forgot.
export const toCoolifyChanges = (input: unknown): Record<string, unknown> => {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ValidationError("Invalid request.");
  const changes: Record<string, unknown> = {};

  for (const [field, value] of Object.entries(input)) {
    if (field === "healthCheck") {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new ValidationError("Invalid health check.");
      for (const [healthField, healthValue] of Object.entries(value)) {
        const rule = healthCheckFields[healthField];
        if (!rule) throw new ValidationError(`${healthField} cannot be changed.`);
        changes[rule.key] = rule.parse(healthValue);
      }
      continue;
    }

    const rule = editableFields[field];
    if (!rule) throw new ValidationError(`${field} cannot be changed.`);
    changes[rule.key] = rule.parse(value);
  }

  if (!Object.keys(changes).length) throw new ValidationError("Nothing to update.");
  return changes;
};
