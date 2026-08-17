/**
 * Pure helpers for the enumeration codegen script.
 *
 * Lives under `src/lib/` (rather than `scripts/`) so vitest can pick up
 * the colocated tests. The script (`scripts/fetch-enumerations.ts`) imports
 * from here for the rendering / normalisation logic and only keeps the
 * I/O + CLI wiring in scripts/.
 */

import { appKeyDir } from './codegen-collisions';

// =============================================================================
// Phoenix /enum response shape (defensive — accept both `values` and
// `allowedValues` since the API hasn't been observed populated for this
// tenant yet)
// =============================================================================

export interface PhoenixEnumeration {
  name: string;
  label?: string;
  description?: string;
  /** Modern shape: an explicit values list. */
  values?: string[];
  /** Legacy shape sometimes seen in Phoenix payloads. */
  allowedValues?: string[];
  /** Even older shape using items[] of { value, label }. */
  items?: Array<{ value?: string; label?: string }>;
  tenant?: string;
  app_definition_key?: string;
}

// =============================================================================
// Naming helpers
//
// Phoenix enum names are NOT guaranteed to be valid TS identifiers — a real
// tenant enum is named `AccountTypeOptions_Corporate/Business` (note the
// `/`). The helpers below therefore split on ANY run of non-alphanumeric
// characters (not just `_`/`-`/space) so the emitted const + type names are
// always valid identifiers, and the file stem is always a flat, safe
// filename (no nested directories from a `/`). The registry keeps the raw
// Phoenix name as a quoted string key elsewhere, so runtime lookups by the
// real name still work.
// =============================================================================

/** Split a raw enum name into alphanumeric word parts (drops `_`, `-`, space,
 *  `/`, `.`, and any other non-alphanumeric run). */
function enumWordParts(name: string): string[] {
  return name.split(/[^A-Za-z0-9]+/).filter(Boolean);
}

/** If an identifier would start with a digit, prefix `_` so it stays valid. */
function ensureIdentStart(ident: string): string {
  return /^[0-9]/.test(ident) ? `_${ident}` : ident;
}

/** Fallback for enum names with NO alphanumeric characters at all (a real
 *  tenant enum is literally named `_`). `enumWordParts` yields `[]` for such
 *  names, which used to produce an EMPTY identifier — emitting invalid TS
 *  like `export type  = never;`. Map every character to `_` so the result is
 *  a valid, non-empty identifier (`_` → `_`, `--` → `__`, …). */
function fallbackIdent(name: string): string {
  return name.replace(/[^A-Za-z0-9]/g, '_') || '_';
}

/** `account_type` → `AccountType`; `AccountTypeOptions_Corporate/Business` →
 *  `AccountTypeOptionsCorporateBusiness`; `_` → `_` (fallback). */
export function enumClassName(name: string): string {
  const pascal = enumWordParts(name)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
  return ensureIdentStart(pascal || fallbackIdent(name));
}

/** `account_type` → `ACCOUNT_TYPE`; `AccountTypeOptions_Corporate/Business` →
 *  `ACCOUNTTYPEOPTIONS_CORPORATE_BUSINESS`; `_` → `_` (fallback). */
export function enumConstName(name: string): string {
  const upper = enumWordParts(name).join('_').toUpperCase();
  return ensureIdentStart(upper || fallbackIdent(name));
}

/** Output filename stem — flattened to a filesystem-safe slug so a `/` in the
 *  enum name does NOT create a nested directory. `account_type` is unchanged;
 *  `AccountTypeOptions_Corporate/Business` → `AccountTypeOptions_Corporate_Business`. */
export function enumFileStem(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]+/g, '_');
}

// =============================================================================
// Value extraction (defensive across observed Phoenix shapes)
// =============================================================================

/**
 * Normalise a raw Phoenix enum entry into a `{ name, values[] }` shape,
 * trying each known field that may carry the list. Returns `null` when
 * the entry can't be normalised (missing name).
 */
export function normaliseEnumeration(
  entry: PhoenixEnumeration | null | undefined,
): { name: string; values: string[] } | null {
  if (!entry || typeof entry.name !== 'string' || !entry.name) return null;

  // Try each potential source in priority order; first non-empty wins.
  let rawValues: string[] = [];
  if (Array.isArray(entry.values) && entry.values.length > 0) {
    rawValues = entry.values.filter(
      (v): v is string => typeof v === 'string' && v.length > 0,
    );
  } else if (
    Array.isArray(entry.allowedValues) &&
    entry.allowedValues.length > 0
  ) {
    rawValues = entry.allowedValues.filter(
      (v): v is string => typeof v === 'string' && v.length > 0,
    );
  } else if (Array.isArray(entry.items) && entry.items.length > 0) {
    rawValues = entry.items
      .map((it) => (typeof it?.value === 'string' ? it.value : ''))
      .filter((v): v is string => v.length > 0);
  }

  // De-dupe while preserving order.
  const seen = new Set<string>();
  const values: string[] = [];
  for (const v of rawValues) {
    if (!seen.has(v)) {
      seen.add(v);
      values.push(v);
    }
  }

  return { name: entry.name, values };
}

// =============================================================================
// File emission
// =============================================================================

export interface RenderedEnumeration {
  source: string;
  name: string;
  pascal: string;
  values: string[];
  /** Owning app-definition key — drives the per-app folder placement. */
  appKey: string;
}

export function renderEnumerationFile(
  name: string,
  values: readonly string[],
  appKey = '',
): RenderedEnumeration {
  const pascal = enumClassName(name);
  const constPrefix = enumConstName(name);
  const constName = `${constPrefix}_VALUES`;
  const typeName = pascal;

  const lines: string[] = [];
  lines.push(`// AUTO-GENERATED by scripts/fetch-enumerations.ts - do not edit by hand.`);
  lines.push(`// Source: Phoenix /api/internal/component-definitions-all/enum`);
  lines.push(`// Enum: ${name}${values.length === 0 ? '  (no values declared)' : ''}`);
  lines.push(``);

  if (values.length === 0) {
    lines.push(
      `/** No values declared in Phoenix; emits an empty union. Fields whose`,
    );
    lines.push(
      ` *  type references this enum will resolve to \`never\` until the tenant`,
    );
    lines.push(` *  defines values via the \`/component-definitions-all/enum\` endpoint. */`);
    lines.push(`export const ${constName} = [] as const;`);
    lines.push(`export type ${typeName} = never;`);
  } else {
    const literalList = values
      .map((v) => `  ${JSON.stringify(v)},`)
      .join('\n');
    lines.push(`export const ${constName} = [`);
    lines.push(literalList);
    lines.push(`] as const;`);
    lines.push(`export type ${typeName} = typeof ${constName}[number];`);
  }
  lines.push(``);

  return {
    source: lines.join('\n'),
    name,
    pascal,
    values: [...values],
    appKey,
  };
}

export function renderEnumerationsBarrelFile(
  rendered: RenderedEnumeration[],
): string {
  const lines: string[] = [];
  lines.push(
    `// AUTO-GENERATED by scripts/fetch-enumerations.ts - do not edit by hand.`,
  );
  lines.push(``);
  const sorted = [...rendered].sort((a, b) => a.name.localeCompare(b.name));
  for (const r of sorted) {
    lines.push(`export * from './${appKeyDir(r.appKey)}/${enumFileStem(r.name)}';`);
  }
  lines.push(``);
  return lines.join('\n');
}

/**
 * Emit the master registry consumed by entity / saved-query codegen
 * (and any runtime code that wants to iterate over enums).
 */
export function renderEnumerationsGeneratedFile(
  rendered: RenderedEnumeration[],
): string {
  const lines: string[] = [];
  lines.push(`/* eslint-disable */`);
  lines.push(
    `// AUTO-GENERATED by scripts/fetch-enumerations.ts - do not edit by hand.`,
  );
  lines.push(
    `// Source: Phoenix /api/internal/component-definitions-all/enum`,
  );
  lines.push(``);

  if (rendered.length === 0) {
    lines.push(`export type EnumerationName = never;`);
    lines.push(``);
    lines.push(
      `/** Lookup of enumeration values by name. Empty when the tenant has`,
    );
    lines.push(` *  no enumerations defined in Phoenix. */`);
    lines.push(
      `export const ENUMERATION_VALUES: Record<string, readonly string[]> = {};`,
    );
    lines.push(``);
    lines.push(
      `export type EnumerationValuesOf<_N extends EnumerationName> = never;`,
    );
    lines.push(``);
    return lines.join('\n');
  }

  const sorted = [...rendered].sort((a, b) => a.name.localeCompare(b.name));
  for (const r of sorted) {
    lines.push(
      `import { ${enumConstName(r.name)}_VALUES } from './enumerations/${appKeyDir(r.appKey)}/${enumFileStem(r.name)}';`,
    );
  }
  lines.push(``);
  const union = sorted.map((r) => JSON.stringify(r.name)).join(' | ');
  lines.push(`export type EnumerationName = ${union};`);
  lines.push(``);
  lines.push(`/** Lookup of enumeration values by name. */`);
  lines.push(`export const ENUMERATION_VALUES = {`);
  for (const r of sorted) {
    lines.push(
      `  ${JSON.stringify(r.name)}: ${enumConstName(r.name)}_VALUES,`,
    );
  }
  lines.push(`} as const;`);
  lines.push(``);
  lines.push(
    `export type EnumerationValuesOf<N extends EnumerationName> =`,
  );
  lines.push(`  typeof ENUMERATION_VALUES[N][number];`);
  lines.push(``);
  return lines.join('\n');
}

// =============================================================================
// Lookup-map builder (consumed by entity + saved-query codegen)
// =============================================================================

/**
 * Build a `{ enumName → values[] }` lookup map from the rendered list.
 * Entity and saved-query codegen use this to convert `Enumeration`-typed
 * fields into union types.
 */
export function buildEnumerationLookup(
  rendered: readonly RenderedEnumeration[],
): Map<string, readonly string[]> {
  const out = new Map<string, readonly string[]>();
  for (const r of rendered) {
    out.set(r.name, r.values);
  }
  return out;
}
