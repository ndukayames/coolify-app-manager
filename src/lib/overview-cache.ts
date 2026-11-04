// Per-tenant overview cache, stale-while-revalidate. Coolify takes ~6s to list a large team's
// apps plus ~1.5s per app history call, so viewers get the last result immediately while one
// background refresh runs. Cleared on deploy/rollback so a client's own actions show up.
const defaultFreshMs = 20_000;
const maxStaleMs = 10 * 60_000;

type Entry = { at: number; value: unknown };
const entries = new Map<string, Entry>();
const inFlight = new Map<string, Promise<unknown>>();

const refresh = <T>(key: string, load: () => Promise<T>): Promise<T> => {
  const running = inFlight.get(key);
  if (running) return running as Promise<T>;

  const promise = load()
    .then((value) => {
      entries.set(key, { at: Date.now(), value });
      return value;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
};

// `freshFor` lets a caller keep an expensive result longer, depending on what it holds.
export const getOverview = async <T>(
  key: string,
  load: () => Promise<T>,
  freshFor: (value: T) => number = () => defaultFreshMs,
): Promise<T> => {
  const entry = entries.get(key);
  const age = entry ? Date.now() - entry.at : Infinity;

  if (entry && age < freshFor(entry.value as T)) return entry.value as T;
  if (entry && age < maxStaleMs) {
    // Errors in a background refresh are logged; the stale copy keeps serving.
    refresh(key, load).catch((error: unknown) => console.error("Overview refresh failed:", error));
    return entry.value as T;
  }
  return refresh(key, load).catch((error: unknown) => {
    // Too old or invalidated, and the refresh failed: the last copy still beats an error.
    if (!entry) throw error;
    console.error("Overview refresh failed, serving last copy:", error);
    return entry.value as T;
  });
};

// Keys are "<tenantId>:apps" and "<tenantId>:deployments". Deploys and rollbacks only change the
// deployments list, so the slower app list stays cached. The value is kept as a fallback, and
// age 0 makes the next read wait for a refresh.
export const invalidateOverview = (tenantId: string): void => {
  const entry = entries.get(`${tenantId}:deployments`);
  if (entry) entry.at = 0;
};
