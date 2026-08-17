/**
 * Preference index.
 *
 * Transforms the raw merged preference records (from `usePreferences()`) into
 * an O(1) lookup keyed by component address, plus a per-component table
 * column override map. Ported from the renderer's `preference-parser.ts`
 * (the authoritative server contract) and trimmed to this app's needs:
 *
 *   - Only visual/prop types are kept (`style`, `component`, `string`).
 *   - JSON-looking values (e.g. AG Grid column state) are skipped.
 *   - Env-encoded values (`dev:..|qa:..|prod:..`) are resolved for the
 *     current runtime env.
 *   - Prototype-pollution keys are rejected.
 *
 * Preference name format (server): `App.<Category>.<Page>.<Name>.<Property>`
 *   → addressed here as `<Page>.<Name>` with `<Property>` the leaf.
 *
 * Table column overrides reuse the same scheme with one extra segment:
 *   `App.<Category>.<Page>.<TableName>.<ColId>.<Property>`
 */
import type { CSSProperties } from 'react';
import type { Preference } from '@/queries/use-preferences';
import { ALLOWED_STYLE_PROPERTIES } from './types';

export type EnvKey = 'dev' | 'qa' | 'uat' | 'prod';

/**
 * Lookup of raw resolved values: byAddress[`<Page>.<Name>`][property] = value.
 * Component-level (4-segment names) only; table column overrides (5-segment)
 * are indexed separately in `byTable`.
 */
export type PreferenceLookup = Record<string, Record<string, string>>;

/**
 * Table column overrides: byTable[`<Page>.<TableName>`][colId][property] = value.
 */
export type TablePreferenceLookup = Record<
  string,
  Record<string, Record<string, string>>
>;

export interface PreferenceIndex {
  byAddress: PreferenceLookup;
  byTable: TablePreferenceLookup;
}

/** Preference `type` values that represent visual / prop overrides. */
const VISUAL_PREFERENCE_TYPES = new Set(['style', 'component', 'string']);

/** Keys that must never become object property names (prototype pollution). */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Map a runtime environment string to a canonical preference env key.
 * AppContext returns values like 'develop'; preferences use 'dev'.
 */
export function mapEnvString(env: string): EnvKey {
  const n = env.toLowerCase().trim();
  if (n === 'develop' || n === 'development' || n === 'dev') return 'dev';
  if (n === 'production' || n === 'prod') return 'prod';
  if (n === 'qa') return 'qa';
  if (n === 'uat') return 'uat';
  return 'dev';
}

/**
 * Decode an env-encoded value of the form `dev:..|qa:..|uat:..|prod:..` into
 * a per-env map. Falls back to the plain string for any env when a segment
 * is missing.
 */
export function decodeEnvValues(raw: string): Record<EnvKey, string> {
  const out: Record<EnvKey, string> = { dev: '', qa: '', uat: '', prod: '' };
  for (const part of raw.split('|')) {
    const idx = part.indexOf(':');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim().toLowerCase();
    const value = part.slice(idx + 1);
    if (key === 'dev' || key === 'qa' || key === 'uat' || key === 'prod') {
      out[key] = value;
    }
  }
  return out;
}

/** Resolve a record's raw value for the given env. Returns null to skip. */
export function resolveValue(raw: string | undefined, envKey: EnvKey): string | null {
  const value = raw ?? '';

  // Skip JSON-shaped values (complex prefs like AG Grid column state).
  const trimmed = typeof value === 'string' ? value.trimStart() : '';
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return null;

  let resolved: string;
  if (typeof value === 'string' && value.includes('|') && value.includes(':')) {
    resolved = decodeEnvValues(value)[envKey];
  } else {
    resolved = value;
  }

  // Keep falsy-but-meaningful values ('0', 'false'); drop empty/undefined.
  if (!resolved && resolved !== '0' && resolved !== 'false') return null;
  return resolved;
}

interface ParsedName {
  /** `<Page>.<Name>` (component) or `<Page>.<TableName>` (table). */
  address: string;
  /** For table column overrides, the column id; else undefined. */
  colId?: string;
  /** Leaf property name. */
  property: string;
}

/**
 * Parse a preference `name` into an address + property.
 *
 * Supported formats (segments split on '.'):
 *   6-seg: App.Category.Page.Table.ColId.Property   → table column override
 *   5-seg: App.Category.Page.Name.Property          → component override
 *   4-seg: Category.Page.Name.Property              → component override (legacy)
 *
 * Returns null when unparseable.
 */
export function parsePreferenceName(name: string): ParsedName | null {
  if (!name) return null;
  const s = name.split('.');

  if (s.length === 6) {
    // App.Category.Page.Table.ColId.Property
    return { address: `${s[2]}.${s[3]}`, colId: s[4], property: s[5] };
  }
  if (s.length === 5) {
    // App.Category.Page.Name.Property
    return { address: `${s[2]}.${s[3]}`, property: s[4] };
  }
  if (s.length === 4) {
    // Category.Page.Name.Property (legacy, no App prefix)
    return { address: `${s[1]}.${s[2]}`, property: s[3] };
  }
  return null;
}

/** True if none of the address/property segments are pollution vectors. */
function isSafeParsed(p: ParsedName): boolean {
  if (UNSAFE_KEYS.has(p.property)) return false;
  if (p.colId && UNSAFE_KEYS.has(p.colId)) return false;
  for (const seg of p.address.split('.')) {
    if (UNSAFE_KEYS.has(seg)) return false;
  }
  return true;
}

/**
 * Build the full preference index from raw records for a given env.
 */
export function buildPreferenceIndex(
  records: Preference[],
  env: string,
): PreferenceIndex {
  const envKey = mapEnvString(env);
  const byAddress: PreferenceLookup = Object.create(null);
  const byTable: TablePreferenceLookup = Object.create(null);

  for (const record of records) {
    if (!record || record.disabled) continue;
    if (record.type && !VISUAL_PREFERENCE_TYPES.has(record.type)) continue;

    const parsed = parsePreferenceName(record.name);
    if (!parsed || !isSafeParsed(parsed)) continue;

    const resolved = resolveValue(record.value, envKey);
    if (resolved === null) continue;

    if (parsed.colId) {
      const table = (byTable[parsed.address] ??= Object.create(null));
      const col = (table[parsed.colId] ??= Object.create(null));
      col[parsed.property] = resolved;
    } else {
      const comp = (byAddress[parsed.address] ??= Object.create(null));
      comp[parsed.property] = resolved;
    }
  }

  return { byAddress, byTable };
}

/**
 * Filter a raw property map down to the allowed inline-style properties,
 * producing a React `style` object. Unknown/unsafe properties are dropped.
 */
export function pickStyle(props: Record<string, string>): CSSProperties | undefined {
  let style: Record<string, string> | undefined;
  for (const key of Object.keys(props)) {
    if (ALLOWED_STYLE_PROPERTIES.has(key as keyof CSSProperties)) {
      (style ??= {})[key] = props[key];
    }
  }
  return style as CSSProperties | undefined;
}
