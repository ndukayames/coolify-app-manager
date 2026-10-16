"use client";

import {
  Code2 as code2,
  Eye as eye,
  EyeOff as eyeOff,
  Plus as plus,
  Rocket as rocket,
  Search as search,
  Trash2 as trash2,
  X as x,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import useSWR from "swr";
import type { ApiMessage, Application, EnvironmentVariable } from "@/lib/types";

const fetcher = async <T,>(url: string): Promise<T> => {
  const response = await fetch(url);
  const body = (await response.json()) as T & ApiMessage;

  if (!response.ok) throw new Error(body.message ?? "The request failed.");
  return body;
};

const createEmptyVariable = (): EnvironmentVariable => ({
  key: "",
  value: "",
  isPreview: false,
  isBuildTime: false,
  isLiteral: true,
  isMultiline: false,
});

const serializeEnvironmentValue = (value: string): string => {
  if (value && /^[a-zA-Z0-9_./:@-]+$/.test(value)) return value;
  return JSON.stringify(value);
};

const serializeEnvironmentVariables = (variables: EnvironmentVariable[]): string =>
  variables.map((variable) => `${variable.key}=${serializeEnvironmentValue(variable.value)}`).join("\n");

const parseEnvironmentVariables = (
  source: string,
  currentVariables: EnvironmentVariable[],
): EnvironmentVariable[] => {
  const currentByKey = new Map(currentVariables.map((variable) => [variable.key, variable]));
  const seenKeys = new Set<string>();

  return source.split(/\r?\n/).flatMap((line, index) => {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith("#")) return [];

    const assignment = trimmedLine.startsWith("export ") ? trimmedLine.slice(7).trim() : trimmedLine;
    const separatorIndex = assignment.indexOf("=");
    if (separatorIndex < 1) throw new Error(`Line ${index + 1} must use KEY=value.`);

    const key = assignment.slice(0, separatorIndex).trim();
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
      throw new Error(`Line ${index + 1} has an invalid variable name.`);
    }

    if (seenKeys.has(key)) throw new Error(`Line ${index + 1} repeats ${key}.`);
    seenKeys.add(key);

    const rawValue = assignment.slice(separatorIndex + 1).trim();
    let value = rawValue;

    if (rawValue.startsWith('"')) {
      try {
        const parsedValue = JSON.parse(rawValue) as unknown;
        if (typeof parsedValue !== "string") throw new Error();
        value = parsedValue;
      } catch {
        throw new Error(`Line ${index + 1} has an invalid quoted value.`);
      }
    } else if (rawValue.startsWith("'")) {
      if (!rawValue.endsWith("'")) throw new Error(`Line ${index + 1} has an invalid quoted value.`);
      value = rawValue.slice(1, -1);
    }

    return [{ ...(currentByKey.get(key) ?? createEmptyVariable()), key, value }];
  });
};

const renderEnvironmentSource = (source: string) =>
  source.split(/\r?\n/).map((line, index, lines) => {
    const assignment = line.match(/^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*)$/);
    const isComment = line.trimStart().startsWith("#");

    return (
      <span key={`${line}-${index}`}>
        {isComment ? <span className="env-token-comment">{line}</span> : null}
        {!isComment && assignment ? (
          <>
            <span className="env-token-prefix">{assignment[1]}</span>
            <span className="env-token-key">{assignment[2]}</span>
            <span className="env-token-separator">{assignment[3]}</span>
            <span className="env-token-value">{assignment[4]}</span>
          </>
        ) : null}
        {!isComment && !assignment ? line : null}
        {index < lines.length - 1 ? <br /> : null}
      </span>
    );
  });

type EnvironmentDrawerProps = {
  application: Application;
  onClose: () => void;
  onNotice: (message: string) => void;
};

export function EnvironmentDrawer({ application, onClose, onNotice }: EnvironmentDrawerProps) {
  const Code = code2;
  const Eye = eye;
  const EyeOff = eyeOff;
  const Plus = plus;
  const Rocket = rocket;
  const Search = search;
  const Trash = trash2;
  const Close = x;
  const { data, error, isLoading, mutate } = useSWR<EnvironmentVariable[]>(
    `/api/applications/${application.uuid}/envs`,
    fetcher,
  );
  const [query, setQuery] = useState<string>("");
  const [patches, setPatches] = useState<Record<string, Partial<EnvironmentVariable>>>({});
  const [newVariables, setNewVariables] = useState<EnvironmentVariable[]>([]);
  const [visibleValues, setVisibleValues] = useState<Set<string>>(() => new Set());
  const [isDeveloperMode, setIsDeveloperMode] = useState<boolean>(false);
  const [developerText, setDeveloperText] = useState<string>("");
  const [developerError, setDeveloperError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"save" | "redeploy" | null>(null);
  const developerHighlightRef = useRef<HTMLPreElement>(null);

  const variables = useMemo<EnvironmentVariable[]>(() => {
    const existing = (data ?? []).map((variable, index) => ({
      ...variable,
      ...patches[variable.uuid ?? `existing-${index}`],
    }));
    return [...existing, ...newVariables];
  }, [data, newVariables, patches]);

  const filteredVariables = useMemo<EnvironmentVariable[]>(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return variables;
    return variables.filter((variable) => variable.key.toLowerCase().includes(normalizedQuery));
  }, [query, variables]);

  const patchVariable = (variable: EnvironmentVariable, index: number, patch: Partial<EnvironmentVariable>) => {
    if (variable.uuid) {
      setPatches((current) => ({ ...current, [variable.uuid as string]: { ...current[variable.uuid as string], ...patch } }));
      return;
    }

    const newIndex = index - (data?.length ?? 0);
    setNewVariables((current) => current.map((item, itemIndex) => (itemIndex === newIndex ? { ...item, ...patch } : item)));
  };

  const removeVariable = (variable: EnvironmentVariable, index: number) => {
    if (variable.uuid) {
      onNotice("Deleting existing variables is intentionally disabled in this first version.");
      return;
    }

    const newIndex = index - (data?.length ?? 0);
    setNewVariables((current) => current.filter((_, itemIndex) => itemIndex !== newIndex));
  };

  const toggleVisible = (key: string) => {
    setVisibleValues((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleDeveloperMode = () => {
    if (!isDeveloperMode) {
      setQuery("");
      setDeveloperText(serializeEnvironmentVariables(variables));
      setDeveloperError(null);
      setIsDeveloperMode(true);
      return;
    }

    setDeveloperError(null);
    setIsDeveloperMode(false);
  };

  const saveVariables = async (redeploy: boolean) => {
    let variablesToSave = variables;

    if (isDeveloperMode) {
      try {
        variablesToSave = parseEnvironmentVariables(developerText, variables);
        setDeveloperError(null);
      } catch (parseError) {
        setDeveloperError(parseError instanceof Error ? parseError.message : "The environment file could not be parsed.");
        return;
      }
    }

    setPendingAction(redeploy ? "redeploy" : "save");

    try {
      const response = await fetch(`/api/applications/${application.uuid}/envs`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variables: variablesToSave, redeploy }),
      });
      const body = (await response.json()) as ApiMessage;
      if (!response.ok) throw new Error(body.message);
      await mutate(variablesToSave, { revalidate: false });
      setPatches({});
      setNewVariables([]);
      onNotice(body.message);
      onClose();
    } catch (saveError) {
      onNotice(saveError instanceof Error ? saveError.message : "Environment variables could not be saved.");
    } finally {
      setPendingAction(null);
    }
  };

  const isSubmitting = pendingAction !== null;
  const developerVariableCount = developerText
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().startsWith("#")).length;

  return (
    <div className="drawer-layer" role="presentation">
      <button className="drawer-backdrop" onClick={onClose} aria-label="Close environment editor" />
      <aside className="env-drawer" aria-label={`${application.name} environment variables`}>
        <header className="drawer-header">
          <div>
            <span className="eyebrow">Environment</span>
            <h2>{application.name}</h2>
            <p>Changes take effect on the next deployment.</p>
          </div>
          <div className="drawer-header-actions">
            <button
              className={`developer-mode-button ${isDeveloperMode ? "active" : ""}`}
              onClick={toggleDeveloperMode}
              aria-pressed={isDeveloperMode}
              disabled={isLoading || Boolean(error)}
            >
              <Code size={14} /> <span>Developer mode</span>
            </button>
            <button className="icon-button" onClick={onClose} aria-label="Close">
              <Close size={19} />
            </button>
          </div>
        </header>

        {isDeveloperMode ? (
          <div className="developer-banner">
            <Eye size={15} />
            <span>Edit one <code>KEY=value</code> pair per line. All values are visible.</span>
          </div>
        ) : null}

        {isDeveloperMode ? (
          <div className="developer-editor">
            <div className="editor-chrome">
              <span className="editor-tab"><Code size={13} /> .env</span>
              <span>UTF-8</span>
            </div>
            <div className="developer-code-surface">
              <pre className="developer-highlight" ref={developerHighlightRef} aria-hidden="true">
                {renderEnvironmentSource(developerText)}
              </pre>
              <textarea
                className="developer-textarea"
                value={developerText}
                onChange={(event) => {
                  setDeveloperText(event.target.value);
                  setDeveloperError(null);
                }}
                onScroll={(event) => {
                  if (developerHighlightRef.current) {
                    developerHighlightRef.current.scrollTop = event.currentTarget.scrollTop;
                    developerHighlightRef.current.scrollLeft = event.currentTarget.scrollLeft;
                  }
                }}
                aria-label="Environment file editor"
                wrap="soft"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
              />
            </div>
            {developerError ? <div className="editor-error" role="alert">{developerError}</div> : null}
          </div>
        ) : (
          <>
            <div className="drawer-toolbar">
              <label className="search-field compact-search">
                <Search size={16} />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Find a variable"
                  aria-label="Find a variable"
                />
              </label>
              <button className="secondary-button" onClick={() => setNewVariables((current) => [...current, createEmptyVariable()])}>
                <Plus size={16} /> Add variable
              </button>
            </div>

            <div className="env-list">
              {isLoading ? <div className="drawer-state">Loading variables…</div> : null}
              {error ? <div className="drawer-state error-state">{error.message}</div> : null}
              {!isLoading && !error && filteredVariables.length === 0 ? (
                <div className="drawer-state">
                  {query ? "No variables match this search." : "No environment variables yet."}
                </div>
              ) : null}
              {filteredVariables.map((variable) => {
                const originalIndex = variables.indexOf(variable);
                const identifier = variable.uuid ?? `new-${originalIndex}`;
                const isVisible = visibleValues.has(identifier);

                return (
                  <article className="env-item" key={identifier}>
                    <div className="env-fields">
                      <label>
                        <span>Key</span>
                        <input
                          value={variable.key}
                          onChange={(event) => patchVariable(variable, originalIndex, { key: event.target.value.toUpperCase() })}
                          placeholder="VARIABLE_NAME"
                          spellCheck={false}
                        />
                      </label>
                      <label>
                        <span>Value</span>
                        <div className="secret-input">
                          <input
                            type={isVisible ? "text" : "password"}
                            value={variable.value}
                            onChange={(event) => patchVariable(variable, originalIndex, { value: event.target.value })}
                            placeholder="Enter a value"
                            spellCheck={false}
                          />
                          <button type="button" onClick={() => toggleVisible(identifier)} aria-label={isVisible ? "Hide value" : "Show value"}>
                            {isVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                        </div>
                      </label>
                    </div>
                    <div className="env-options">
                      <label className="check-field">
                        <input
                          type="checkbox"
                          checked={variable.isBuildTime}
                          onChange={(event) => patchVariable(variable, originalIndex, { isBuildTime: event.target.checked })}
                        />
                        Build time
                      </label>
                      <button className="delete-button" onClick={() => removeVariable(variable, originalIndex)} aria-label={`Delete ${variable.key || "variable"}`}>
                        <Trash size={15} />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        )}

        <footer className="drawer-footer">
          <span>{isDeveloperMode ? `${developerVariableCount} entries` : `${variables.length} variables`}</span>
          <div>
            <button className="text-button" onClick={onClose}>Cancel</button>
            <button
              className="secondary-button"
              onClick={() => saveVariables(false)}
              disabled={isSubmitting || isLoading || Boolean(error)}
            >
              {pendingAction === "save" ? "Saving…" : "Save changes"}
            </button>
            <button className="primary-button redeploy-button" onClick={() => saveVariables(true)} disabled={isSubmitting || isLoading || Boolean(error)}>
              {pendingAction === "redeploy" ? <span className="button-spinner" /> : <Rocket size={14} />}
              {pendingAction === "redeploy" ? "Updating…" : "Update & redeploy"}
            </button>
          </div>
        </footer>
      </aside>
    </div>
  );
}
