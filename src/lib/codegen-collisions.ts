/**
 * Shared helpers for the bootstrap codegens (`scripts/fetch-*.ts`) to handle
 * **cross-app name collisions**.
 *
 * Every codegen fetches definitions for the whole tenant, which spans multiple
 * apps (`app_definition_key`), then writes per-item files + a typed registry
 * keyed by the item's bare `name`. Historically each script deduped
 * `byName` **first-wins** — so when two apps both define e.g. an `account`
 * entity, the second was **silently dropped** (and would otherwise overwrite
 * the first's file).
 *
 * These helpers make that situation **visible** (and, for callers that opt in,
 * disambiguable). The bare `name` stays the identity for the common
 * (single-app) case — it must, because the Phoenix DynQL wire contract keys a
 * query body by the bare snake_case name and disambiguates the app via the
 * request header, and the agent authors queries by bare name. Only a true
 * cross-app collision needs an app qualifier.
 */

/** Minimal shape every fetched definition shares for collision detection. */
export interface NamedAppScoped {
  name: string;
  /** `app_definition_key` (or the DTO's `target_app_definition_key`). */
  appKey: string;
}

/**
 * Group definitions by `name` and return the names that appear under **more
 * than one distinct appKey** — the true cross-app collisions. The value is the
 * sorted list of app keys that share the name. Names unique to a single app
 * are omitted (no collision).
 *
 * Exported for unit tests.
 */
export function detectNameCollisions(
  items: readonly NamedAppScoped[],
): Map<string, string[]> {
  const appsByName = new Map<string, Set<string>>();
  for (const it of items) {
    if (!it || typeof it.name !== 'string' || !it.name) continue;
    let apps = appsByName.get(it.name);
    if (!apps) {
      apps = new Set<string>();
      appsByName.set(it.name, apps);
    }
    apps.add(it.appKey ?? '');
  }
  const collisions = new Map<string, string[]>();
  for (const [name, apps] of appsByName) {
    if (apps.size > 1) collisions.set(name, [...apps].sort());
  }
  return collisions;
}

/**
 * Render a one-line warning enumerating cross-app collisions for a namespace
 * (e.g. `"entity"`). Returns `null` when there are none, so callers can
 * `const w = formatCollisionWarning(...); if (w) console.warn(w);`.
 *
 * Exported for unit tests.
 */
export function formatCollisionWarning(
  kind: string,
  collisions: Map<string, string[]>,
): string | null {
  if (collisions.size === 0) return null;
  const detail = [...collisions.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, apps]) => `${name} (${apps.join(', ')})`)
    .join('; ');
  return (
    `fetch: ${collisions.size} ${kind} name(s) exist in multiple apps and ` +
    `were previously dropped first-wins — disambiguating by app: ${detail}`
  );
}

/**
 * Filesystem-safe directory slug for an app-definition key. App keys are
 * normally `[a-z0-9_]+` (e.g. `wealthdomain_69c65d7d…`, `platform`), but
 * sanitise defensively so a stray character can't escape the namespace dir.
 * Empty / missing keys fall back to `_unknown_app`.
 *
 * Exported for unit tests.
 */
export function appKeyDir(appKey: string | undefined | null): string {
  const trimmed = (appKey ?? '').trim();
  if (!trimmed) return '_unknown_app';
  return trimmed.replace(/[^A-Za-z0-9_-]+/g, '_');
}
