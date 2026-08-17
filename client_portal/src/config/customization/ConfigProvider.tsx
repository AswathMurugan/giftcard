/**
 * ConfigProvider + hooks.
 *
 * Bridges the existing `usePreferences()` query into a single,
 * reference-stable context that every customizable primitive reads. The
 * config is effectively immutable per session (the query fetches once on
 * mount and caches), so the context value's identity is stable after load
 * and consumers don't re-render in a cascade.
 *
 * No new network calls — preferences are already fetched by BrandingProvider.
 *
 * Precedence (org→app→tenant) is resolved SERVER-SIDE; this layer never
 * merges scopes. It only merges code-defaults + the single resolved value.
 *
 * Customization (preferences) is decoupled from access control. A component
 * is hidden by EITHER:
 *   - an explicit admin `visible:false` preference (any component), OR
 *   - a `permission: true` schema flag + the user lacking the component's
 *     `screen_component` permission (opt-in per component).
 * Components NOT flagged `permission: true` are never permission-gated — this
 * is what prevents generated pages (which have no per-screen permission
 * records) from vanishing wholesale. Page/route-level access control remains
 * a separate concern handled by `<PermissionGuard>`.
 */
import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';
import { usePreferences } from '@/queries/use-preferences';
import { useComponentPermissions } from '@/queries/use-permissions';
import { getAppConfig } from '@/config/api-config';
import { buildPreferenceIndex, type PreferenceIndex } from './preference-index';
import { resolveComponentConfig, applyColumnOverrides, type ColumnLike } from './resolve';
import type { ComponentConfig, ComponentType, Slot } from './types';

/** A schema shape that preserves per-slot literal types (from `buildSchema`). */
type AnySchema = Record<string, Slot<ComponentType>>;

/** Names of the `'text'` slots in a schema (the only keys `usePageText` accepts). */
type TextKeys<S extends AnySchema> = {
  [K in keyof S]: S[K]['type'] extends 'text' ? K : never;
}[keyof S] & string;

/** Split a slot id (`<Page>.<name>`) into its page + component name parts. */
export function splitSlotId(id: string): { page: string; name: string } {
  const dot = id.indexOf('.');
  if (dot === -1) return { page: id, name: id };
  return { page: id.slice(0, dot), name: id.slice(dot + 1) };
}

/**
 * Pure access-control decision for a component (no React).
 *
 * @param gated      Whether the slot is flagged `permission: true`.
 * @param name       The component name (from the slot id).
 * @param allowed    The user's allowed-component set, or undefined while
 *                   unresolved (cold-cache load or fetch error).
 * @param _isLoading Retained for signature stability; the decision keys off
 *                   whether `allowed` is resolved, not the in-flight flag.
 * @returns          true → hide the component for access-control reasons.
 *
 * Rules:
 *   - Not gated → never hidden by permission.
 *   - Gated, allow-set UNRESOLVED (cold load / error) → fail CLOSED (hide).
 *     `useComponentPermissions` seeds `allowed` from localStorage via
 *     `placeholderData`, so returning users never hit this branch; only a
 *     genuine first paint briefly hides gated content until it resolves. This
 *     prevents flashing gated content to users who may lack access.
 *   - Gated, resolved, name in allowed set → show.
 *   - Gated, resolved, name NOT in allowed set → hide.
 */
export function isPermissionHidden(
  gated: boolean,
  name: string,
  allowed: ReadonlySet<string> | undefined,
  _isLoading: boolean,
): boolean {
  if (!gated) return false;
  if (!allowed) return true;
  return !allowed.has(name);
}

interface ConfigContextValue {
  index: PreferenceIndex;
}

const EMPTY_INDEX: PreferenceIndex = {
  byAddress: Object.create(null),
  byTable: Object.create(null),
};

const ConfigContext = createContext<ConfigContextValue>({
  index: EMPTY_INDEX,
});

export function ConfigProvider({ children }: { children: ReactNode }) {
  const { data: preferences } = usePreferences();

  const env = getAppConfig().env;

  const index = useMemo<PreferenceIndex>(
    () => (preferences ? buildPreferenceIndex(preferences, env) : EMPTY_INDEX),
    [preferences, env],
  );

  const value = useMemo<ConfigContextValue>(() => ({ index }), [index]);

  return (
    <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>
  );
}

/**
 * Resolve a component's runtime config from admin preferences, plus whether
 * it is hidden by access control.
 *
 * - `config` is the merged preference config (defaults + admin override).
 * - `permissionHidden` is true when the slot is flagged `permission: true` AND
 *   the allowed-component set for the page does not include this component —
 *   OR the set is not yet resolved (cold-cache load / error), in which case we
 *   fail CLOSED (`permissionHidden: true`) so gated content is never flashed to
 *   a user who may lack access. `placeholderData` seeds the set from
 *   localStorage, so returning users skip the closed-while-loading window.
 *
 * Unflagged slots never trigger the permission query and are never
 * permission-hidden.
 *
 * @param slot Schema node ({ id, type, permission? }) from `buildSchema`.
 */
export function useComponentConfig(
  slot: Slot,
): { config: ComponentConfig; permissionHidden: boolean } {
  const { index } = useContext(ConfigContext);

  const { page, name } = useMemo(() => splitSlotId(slot.id), [slot.id]);

  // Only flagged slots consult component permissions. React Query dedupes by
  // the ['component-permissions', page] key, so many flagged components on a
  // page share a single network call.
  const gated = slot.permission === true;
  const { data: allowed, isLoading } = useComponentPermissions(gated ? page : '');

  return useMemo(() => {
    const override = index.byAddress[slot.id];
    const config = resolveComponentConfig(slot.type, override);

    const permissionHidden = isPermissionHidden(gated, name, allowed, isLoading);

    return { config, permissionHidden };
  }, [index, slot.id, slot.type, gated, allowed, isLoading, name]);
}

/**
 * Merge admin column-prop overrides onto a set of AG Grid column defs.
 *
 * @param slot    The TABLE schema node ({ id: `<Page>.<tableName>` }).
 * @param columns Base column definitions (agent-authored).
 */
export function useColumnConfig<T extends ColumnLike>(
  slot: Slot,
  columns: T[],
): T[] {
  const { index } = useContext(ConfigContext);
  return useMemo(
    () => applyColumnOverrides(columns, index.byTable[slot.id]),
    [index, slot.id, columns],
  );
}

/**
 * Translate-style text helper for RAW HTML (`<h1>`, `<p>`, `<span>`, …).
 *
 * Customizable primitives use `config`, but raw HTML can't. `usePageText`
 * gives those elements admin-editable TEXT (and only text — no style, no
 * hide, no permission) via the same preferences API.
 *
 * Text keys are DECLARED in the page schema as `'text'` slots, so they are
 * discoverable in one place and type-checked at the call site (a typo is a
 * compile error). Pass the schema; `t` only accepts declared text keys:
 *
 *   // schema.ts
 *   export const DASH = buildSchema('dashboard', {  // URL slug (route '/dashboard')
 *     pageTitle: 'text', subtitle: 'text', newBtn: 'button',
 *   });
 *   // page.tsx
 *   const t = usePageText(DASH);
 *   <h1>{t('pageTitle', 'Dashboard')}</h1>          // ok
 *   <p>{t('subtitle', 'Overview')}</p>              // ok
 *   <h2>{t('typo', 'x')}</h2>                       // compile error
 *
 * The DEFAULT is the source of truth: with no preference set, `t` returns the
 * default, so the page is always correct. An admin override for
 * `<Page>.<key>` (the `text` property) replaces it at runtime. Keys must stay
 * stable across regenerations or existing overrides break.
 *
 * @param schema The page schema from `buildSchema` (its page name + text keys).
 * @returns      `t(key, defaultText)` → resolved override or the default.
 */
export function usePageText<S extends AnySchema>(
  schema: S,
): (key: TextKeys<S>, defaultText: string) => string {
  const { index } = useContext(ConfigContext);
  // Every slot id is `<Page>.<name>`; derive the page from any slot.
  const page = useMemo(() => {
    const first = Object.values(schema)[0] as Slot | undefined;
    return first ? splitSlotId(first.id).page : '';
  }, [schema]);

  return useMemo(
    () => (key: TextKeys<S>, defaultText: string) =>
      resolveText(index, page, key, defaultText),
    [index, page],
  );
}

/**
 * Pure text resolution (no React) — extracted for unit testing.
 * Returns the admin `text` override for `<page>.<key>`, or the default.
 */
export function resolveText(
  index: PreferenceIndex,
  page: string,
  key: string,
  defaultText: string,
): string {
  const override = index.byAddress[`${page}.${key}`]?.text;
  return override ?? defaultText;
}
