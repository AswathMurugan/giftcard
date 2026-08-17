/**
 * Resolve the app layout/chrome config at runtime.
 *
 * Merges (lowest → highest precedence):
 *   1. DEFAULT_LAYOUT_CONFIG  (stock look)
 *   2. LAYOUT_OVERRIDE        (app-owned static override in src/config/layout.ts)
 *   3. `App.Layout.*` merged preferences (per org→app→tenant, server-resolved)
 *
 * Mirrors the branding pipeline (`src/lib/branding.ts`): preferences are read
 * once via `usePreferences()` and parsed into a typed config. Invalid values
 * are ignored (fall back to the lower layer).
 */
import { usePreferences } from '@/queries/use-preferences';
import {
  DEFAULT_LAYOUT_CONFIG,
  LAYOUT_OVERRIDE,
  type LayoutConfig,
  type LayoutVariant,
  type LayoutVisibility,
} from './layout';

/** Minimal shape of a merged preference record we read for layout. */
export interface LayoutPreferenceRecord {
  name: string;
  value: string;
  category?: string;
  disabled?: boolean;
}

const VISIBILITY_VALUES: readonly LayoutVisibility[] = ['visible', 'hidden'];
const VARIANT_VALUES: readonly LayoutVariant[] = ['default', 'compact'];

function asVisibility(value: string): LayoutVisibility | null {
  return (VISIBILITY_VALUES as readonly string[]).includes(value)
    ? (value as LayoutVisibility)
    : null;
}

function asVariant(value: string): LayoutVariant | null {
  return (VARIANT_VALUES as readonly string[]).includes(value)
    ? (value as LayoutVariant)
    : null;
}

/** Parse a boolean-ish preference string (`true`/`false`, case-insensitive). */
function asBool(value: string): boolean | null {
  const v = value.trim().toLowerCase();
  if (v === 'true') return true;
  if (v === 'false') return false;
  return null;
}

/** Accepts `#rgb`, `#rrggbb`, or `#rrggbbaa`. Returns null otherwise. */
function asColor(value: string): string | null {
  const v = value.trim();
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v) ? v : null;
}

/**
 * Parse `App.Layout.*` preference records into a partial config. Disabled
 * records, non-layout categories, unknown names, and invalid values are
 * skipped. Exported for testing.
 */
export function parseLayoutPreferences(
  records: readonly LayoutPreferenceRecord[] | null | undefined,
): Partial<LayoutConfig> {
  const out: Partial<LayoutConfig> = {};
  if (!Array.isArray(records)) return out;

  for (const record of records) {
    if (!record || typeof record !== 'object' || record.disabled) continue;
    const name = typeof record.name === 'string' ? record.name : '';
    if (!name.startsWith('App.Layout.')) continue;
    const value = typeof record.value === 'string' ? record.value : '';

    switch (name) {
      case 'App.Layout.Sidebar': {
        const v = asVisibility(value);
        if (v) out.sidebar = v;
        break;
      }
      case 'App.Layout.Header': {
        const v = asVisibility(value);
        if (v) out.header = v;
        break;
      }
      case 'App.Layout.SidebarColor': {
        const c = asColor(value);
        if (c) out.sidebarColor = c;
        break;
      }
      case 'App.Layout.SidebarTextColor': {
        const c = asColor(value);
        if (c) out.sidebarTextColor = c;
        break;
      }
      case 'App.Layout.SidebarActiveColor': {
        const c = asColor(value);
        if (c) out.sidebarActiveColor = c;
        break;
      }
      case 'App.Layout.Variant': {
        const v = asVariant(value);
        if (v) out.variant = v;
        break;
      }
      case 'App.Layout.DefaultCollapsed': {
        const b = asBool(value);
        if (b !== null) out.defaultCollapsed = b;
        break;
      }
      default:
        break;
    }
  }

  return out;
}

/**
 * Merge the three config layers. Pure + exported for testing.
 * `prefs` wins over `override`, which wins over the built-in defaults.
 */
export function resolveLayoutConfig(
  override: Partial<LayoutConfig> | null | undefined,
  prefs: Partial<LayoutConfig> | null | undefined,
): LayoutConfig {
  return {
    ...DEFAULT_LAYOUT_CONFIG,
    ...(override ?? {}),
    ...(prefs ?? {}),
  };
}

/**
 * Resolved layout config for the current app/tenant/org. Reads merged
 * preferences (cached by `usePreferences`) and folds in the app-owned
 * override. Safe to call before preferences load — falls back to
 * defaults + override.
 */
export function useLayoutConfig(): LayoutConfig {
  const { data } = usePreferences();
  const prefs = parseLayoutPreferences(
    data as LayoutPreferenceRecord[] | undefined,
  );
  return resolveLayoutConfig(LAYOUT_OVERRIDE, prefs);
}
