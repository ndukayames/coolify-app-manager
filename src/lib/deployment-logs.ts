import type { DeploymentLogLine } from "@/lib/types";

// Coolify deployment logs mix what a developer needs (build output, errors) with how our
// platform works (build servers, registry, helper images, docker commands, env values on the
// nixpacks command line). This keeps an allow-list of the first and redacts the rest.

type CoolifyLogEvent = {
  command?: string | null;
  output?: unknown;
  type?: string;
  timestamp?: string;
  hidden?: boolean;
};

// Visible Coolify messages rewritten to plain steps. First match wins; null drops the line.
const stepRewrites: [RegExp, string | null][] = [
  [/^Starting deployment of (\S+?):(\S+)/i, "Starting deployment of $1 ($2)."],
  [/^Importing .*\(commit sha ([0-9a-f]{7})[0-9a-f]*\)/i, "Fetched source at commit $1."],
  [/^Found application type: (\w+)/i, "Detected a $1 application."],
  [/^Building docker image started/i, "Build started."],
  [/^Building docker image completed/i, "Build completed."],
  [/^Rolling update started/i, "Releasing new version."],
  [/^New container started/i, "New version is running."],
  [/^Rolling update completed/i, "Release completed."],
  [/^Removing old containers/i, null],
  [/healthcheck|health check/i, "$&"],
  [/^Executing pre-deployment command/i, "Running pre-deployment command."],
  [/^Executing post-deployment command/i, "Running post-deployment command."],
  [/^Deployment (failed|cancelled)/i, "$&"],
  [/^(Oops|Error|Failed)/i, "$&"],
];

// Hidden events whose output is the application's own build or deploy commands.
const isUserFacingCommand = (command: string): boolean =>
  /\/artifacts\/build\.sh/.test(command) || /pre_deployment|post_deployment/i.test(command);

const isPlatformLine = (line: string): boolean =>
  /docker (build|buildx|push|run|exec)\b|--build-arg|--add-host|--secret\b|source \/artifacts|\bCOOLIFY_[A-Z_]+/.test(line);

const reserved = (process.env.RESERVED_DOMAIN_SUFFIXES ?? "thecodeva.com,reel-traffic.com")
  .split(",")
  .map((suffix) => suffix.trim())
  .filter(Boolean);
const reservedPattern = reserved.length
  ? new RegExp(`[\\w.-]*\\.?(${reserved.map((suffix) => suffix.replace(/\./g, "\\.")).join("|")})(:\\d+)?(/[\\w./:-]*)?`, "gi")
  : null;

export const redact = (line: string): string => {
  let value = line
    .replace(/https?:\/\/[^@\s'"]+:[^@\s'"]+@/g, "https://")
    .replace(/\b\d{1,3}(\.\d{1,3}){3}(:\d+)?\b/g, "[internal]")
    .replace(/\/artifacts\/[\w./-]*/g, "/workspace")
    .replace(/\bsha256:[0-9a-f]{64}\b/g, "sha256:…")
    .replace(/\b[0-9a-f]{64}\b/g, "…");
  if (reservedPattern) value = value.replace(reservedPattern, "[internal]");
  return value;
};

const toneOf = (message: string, type?: string): DeploymentLogLine["tone"] => {
  if (/\b(error|failed|fatal|err!)\b/i.test(message)) return "error";
  if (type === "stderr" || /\bwarn(ing)?\b/i.test(message)) return "warning";
  return "default";
};

const timeOf = (timestamp?: string): string => timestamp?.match(/T(\d{2}:\d{2}:\d{2})/)?.[1] ?? "";

export const sanitizeDeploymentLogs = (raw: string | null | undefined): DeploymentLogLine[] => {
  let events: CoolifyLogEvent[];
  try {
    const parsed = JSON.parse(raw ?? "[]") as unknown;
    events = Array.isArray(parsed) ? (parsed as CoolifyLogEvent[]) : [];
  } catch {
    // Unstructured logs can't be classified safely, so nothing is shown rather than everything.
    return [];
  }

  const lines: DeploymentLogLine[] = [];

  for (const event of events) {
    if (typeof event.output !== "string" || !event.output.trim()) continue;
    const timestamp = timeOf(event.timestamp);

    if (event.hidden) {
      if (!isUserFacingCommand(event.command ?? "")) continue;
      for (const message of event.output.split(/\r?\n/)) {
        if (!message.trim()) continue;
        // build.sh echoes the docker build invocation, with build args (env values) and host flags.
        if (isPlatformLine(message)) continue;
        const clean = redact(message);
        lines.push({ timestamp, message: clean, kind: "output", tone: toneOf(clean, event.type) });
      }
      continue;
    }

    for (const message of event.output.split(/\r?\n/)) {
      const trimmed = message.trim();
      if (!trimmed || /^[=-]{8,}$/.test(trimmed)) continue;

      // A failed build arrives as one stderr event: "Command execution failed (exit code N): docker
      // exec …" followed by the full build output. Keep the output, replace the command line.
      const failedCommand = trimmed.match(/Command execution failed \(exit code (\d+)\)/i);
      if (failedCommand) {
        lines.push({ timestamp, message: `Build failed (exit code ${failedCommand[1]}).`, kind: "step", tone: "error" });
        continue;
      }
      if (/Server is not functional|server is not reachable|unable to connect to the server/i.test(trimmed)) {
        lines.push({
          timestamp,
          message: "Deployment could not start because of a platform issue. Contact Codeva support.",
          kind: "step",
          tone: "error",
        });
        continue;
      }
      if (isPlatformLine(trimmed)) continue;

      const rule = stepRewrites.find(([pattern]) => pattern.test(trimmed));
      // Errors Coolify reports for the deployment itself are kept (redacted) even if unrecognised.
      if (!rule && event.type !== "stderr") continue;
      if (rule && rule[1] === null) continue;
      const clean = redact(
        !rule || rule[1] === "$&" ? trimmed : (trimmed.match(rule[0])?.[0] ?? "").replace(rule[0], rule[1] as string),
      );
      // Unrecognised stderr lines are build output carried inside an error event, not steps.
      lines.push({ timestamp, message: clean, kind: rule ? "step" : "output", tone: toneOf(clean, rule ? event.type : undefined) });
    }
  }

  // Coolify sometimes logs the same status twice in a row.
  return lines.filter(
    (line, index) => line.kind !== "step" || index === 0 || lines[index - 1].message !== line.message,
  );
};
