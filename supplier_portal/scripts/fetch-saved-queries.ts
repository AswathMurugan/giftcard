/**
 * Fetches saved-query definitions for a configured tenant from the Phoenix
 * `/api/internal/component-definitions-all/saved-query` endpoint and emits
 * per-query TypeScript modules into `src/types/saved-queries/`.
 *
 * Saved queries are server-stored, named, READ-ONLY parameterized queries.
 * They are the only way to execute reads against the data plane when the
 * tenant's security policy blocks direct dynamic queries
 * (`POST /query/{entity}`). Writes continue to go through entity CRUD
 * (`useEntityMutation` → `POST/PUT/PATCH/DELETE /entity/{name}[/{id}]`).
 *
 * Config (env-only, read from `.env` or the process env):
 *   - PHOENIX_API_URL                e.g. https://jiffy.us.sandbox.phoenix.jiffy.ai
 *   - TENANT_ID                      e.g. aiwithdata
 *   - FETCH_SAVED_QUERIES_OUT_DIR    (optional) absolute path to write into.
 *                                    Defaults to <project>/src/types/saved-queries.
 *                                    Set this when running from the backend
 *                                    bootstrap to redirect output into a
 *                                    workspace's tree.
 *
 * Invocation:
 *   npm run fetch:saved-queries
 *   # or directly:
 *   npx tsx scripts/fetch-saved-queries.ts
 *
 * Output is deterministic (sorted) and the script skips writes when a file's
 * content is unchanged.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

import {
  renderSavedQueryCatalog,
  type SavedQueryCatalogEntry,
  type SavedQueryCatalogField,
} from '../src/hooks/saved-query-catalog';
import { enumClassName } from '../src/lib/enumerations-codegen';
import {
  detectNameCollisions,
  formatCollisionWarning,
  appKeyDir,
} from '../src/lib/codegen-collisions';
import { phoenixUrl, withAuth } from './lib/phoenix-http';

// =============================================================================
// Saved-query response shape (the Phoenix /api/internal endpoint mixes the
// data-manager `dto.SavedQuery` fields with extra metadata like
// `app_definition`, `app_definition_key`, `component_type`, `modified_date`).
// We only use the fields below; anything else is ignored.
// =============================================================================

type QueryAttributeKind = 'input' | 'output' | 'internal';

interface QueryAttribute {
  name: string;
  label?: string;
  /** Vocabulary is mixed: simple ('string', 'number', 'object', 'array', …) or
   *  entity BusinessType ('UUID', 'Text', 'Currency', 'Enumeration', …). */
  type?: string;
  attributeType?: QueryAttributeKind | string;
  required?: boolean;
  description?: string | null;
  /** For object/array attributes, points to a type-definition elsewhere:
   *   `{appKey}.saved-query.{queryName}.{internalName}` → resolve via
   *      sibling `internal` with matching `name`.
   *   `{appKey}.entity.{entityName}` → entity reference; resolved to the
   *      generated entity TS type (with an import) when that entity exists
   *      under `src/types/entities/`, else `Record<string, unknown>` /
   *      `unknown[]`. */
  component_reference?: string | null;
  attributes?: QueryAttribute[] | null;
}

export interface SavedQuery {
  id?: string;
  name: string;
  label?: string;
  description?: string;
  /** "dynamic" | "sql" | "multi_query" | "common_table_expression" */
  type?: string;
  query?: string;
  tenant?: string;
  attributes?: QueryAttribute[];
  is_single_output?: boolean;
  /** The app that OWNS the saved query — the execute call is routed here
   *  (becomes X-Jiffy-App-Name via getDataHeaders). This is what we record
   *  as `<NAME>_APP_KEY` / in SAVED_QUERY_APP_KEYS. */
  app_definition_key?: string;
  /** The app whose ENTITY the query reads (cross-app queries). Used
   *  SERVER-SIDE by the data-manager only — NOT for routing the execute
   *  call, so the codegen does not use it for the app key. */
  target_app_definition_key?: string;
}

// =============================================================================
// .env loader (no `dotenv` dep — keep the script lean, same approach as
// scripts/fetch-entities.ts so both stay in sync)
// =============================================================================

function loadDotEnv(envPath: string): void {
  if (!existsSync(envPath)) return;
  const raw = readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

// =============================================================================
// Naming helpers
// =============================================================================

/**
 * `get_top_accounts` → `GetTopAccounts`. Used for interface and function stems.
 *
 * Digit-guarded: the result is used verbatim as a TypeScript identifier, and a
 * TS identifier cannot start with a digit. Phoenix names can (a saved query
 * named `2024_returns`, or an app key like `123aa_6a3d…`), which would emit
 * `export interface 2024Returns` — a syntax error that breaks the whole
 * generated file. Same guard as `entityClassName` in fetch-entities.ts.
 */
function pascalCase(s: string): string {
  const pascal = s
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
  return /^[A-Za-z_$]/.test(pascal) ? pascal : `_${pascal}`;
}

/**
 * `get_top_accounts` → `GET_TOP_ACCOUNTS`. Used for constant identifiers.
 * Digit-guarded for the same reason as {@link pascalCase}.
 */
function constCase(s: string): string {
  const upper = s
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .join('_')
    .toUpperCase();
  return /^[A-Za-z_$]/.test(upper) ? upper : `_${upper}`;
}

/** Output filename stem — preserves the canonical saved-query name. */
function savedQueryFileStem(name: string): string {
  return name;
}

/** Replace any character that isn't safe for a TS identifier with `_`. */
function safeIdent(s: string): string {
  return s.replace(/[^A-Za-z0-9_]/g, '_');
}

/** True when the identifier must be wrapped in quotes inside an interface. */
function needsQuotedKey(s: string): boolean {
  return !/^[A-Za-z_][A-Za-z0-9_]*$/.test(s);
}

/** Quote an identifier if it isn't a bare ident. */
function quoteKey(s: string): string {
  return needsQuotedKey(s) ? JSON.stringify(s) : s;
}

// =============================================================================
// QueryAttribute.type → TypeScript primitive
//
// Two vocabularies appear in the wild:
//   1. Simple JSON-schema-like: `string`, `number`, `boolean`, `object`, `array`,
//      plus a few aliases. Source: dto/saved_query.go:84.
//   2. Entity BusinessType: `UUID`, `Text`, `Currency`, `Enumeration`, …
//      (when an attribute reflects an entity field). Source:
//      codegen-starter/src/types/entity.ts.
// =============================================================================

const SCALAR_TS_TYPE: Record<string, string> = {
  // Simple vocabulary
  string: 'string',
  date: 'string',
  date_time: 'string',
  datetime: 'string',
  email: 'string',
  uuid: 'string',
  url: 'string',
  integer: 'number',
  number: 'number',
  float: 'number',
  decimal: 'number',
  boolean: 'boolean',
  bool: 'boolean',

  // Entity BusinessType vocabulary (case-insensitive matched via toLowerCase
  // below)
  text: 'string',
  multilinetext: 'string',
  phonenumber: 'string',
  ssn: 'string',
  file: 'string',
  seal: 'string',
  signature: 'string',
  enumeration: 'string',
  duration: 'string',
  ltree: 'string',
  autonumber: 'number',
  currency: 'number',
  percent: 'number',
  checkbox: 'boolean',
  json: 'Record<string, unknown>',
  computed: 'unknown',
  link: 'unknown',
  backlink: 'unknown',
};

// =============================================================================
// Reference resolution
//
// `component_reference` may look like:
//   wealthdomain_xxx.saved-query.get_account_summary_details.account
//   wealthdomain_xxx.entity.account
// The first form resolves to a sibling `internal` attribute with `name="account"`
// inside THE SAME saved query. The second form points to an entity definition
// that lives outside the saved-query files; we don't try to bridge that.
// =============================================================================

interface ResolverContext {
  queryName: string;
  /** Map of internal-attribute name → its attributes[] (the nested fields). */
  internals: Map<string, QueryAttribute[]>;
  /**
   * Names of enumerations available on disk under `src/types/enumerations/`.
   * When an attribute's `type` is `enumeration` and a matching name is
   * present here, the codegen emits the union type + an import. Otherwise
   * the attribute falls back to `string`.
   */
  knownEnumerationNames: Set<string>;
  /**
   * Collected enum names actually referenced by this saved query's
   * rendering. Mutated as `attrTsType` resolves them; the file emitter
   * reads it to know which imports to add.
   */
  referencedEnumerations: Set<string>;
  /**
   * Names of entities available on disk under `src/types/entities/`
   * (snake_case stems). When an `object`/`array` attribute's
   * `component_reference` points to `{appKey}.entity.{name}` and that name
   * is present here, the codegen emits the entity's TS type + an import
   * instead of falling back to `Record<string, unknown>`.
   */
  knownEntityNames: Set<string>;
  /**
   * Map of entity name (snake_case stem) → the per-app-key folder it lives in
   * under `src/types/entities/<appKeyDir>/`. Entities are foldered per app
   * (`fetch-entities.ts`), and the SAME name can exist in two apps — so the
   * emitter must point each import at the correct folder, not a bare name.
   */
  entityDirsByName: Map<string, Set<string>>;
  /**
   * The app-key folder of the entity this saved query reads (from
   * `target_app_definition_key ?? app_definition_key`), used to disambiguate
   * when an entity name exists under more than one app folder.
   */
  sqEntityAppDir: string;
  /**
   * Collected entity refs actually used by this saved query's rendering, as
   * `name → appKeyDir`. Mutated as `attrTsType` resolves entity refs; the file
   * emitter reads it to emit `@/types/entities/<appKeyDir>/<name>` imports.
   */
  referencedEntities: Map<string, string>;
}

function buildResolverContext(
  sq: SavedQuery,
  knownEnumerationNames: Set<string>,
  knownEntityNames: Set<string> = new Set(),
  entityDirsByName: Map<string, Set<string>> = new Map(),
): ResolverContext {
  const internals = new Map<string, QueryAttribute[]>();
  for (const a of sq.attributes ?? []) {
    if ((a.attributeType ?? '').toLowerCase() === 'internal') {
      internals.set(a.name, a.attributes ?? []);
    }
  }
  // The entity a (possibly cross-app) saved query reads lives in
  // `target_app_definition_key`; fall back to the owning app.
  const sqEntityAppDir = appKeyDir(
    (sq as { target_app_definition_key?: string; app_definition_key?: string })
      .target_app_definition_key ??
      sq.app_definition_key ??
      '',
  );
  return {
    queryName: sq.name,
    internals,
    knownEnumerationNames,
    referencedEnumerations: new Set<string>(),
    knownEntityNames,
    entityDirsByName,
    sqEntityAppDir,
    referencedEntities: new Map<string, string>(),
  };
}

/**
 * Try to resolve a saved-query attribute (typically `Enumeration`-typed)
 * to a known enum name from the lookup. Search order:
 *   1. `<queryName>_<attrName>`
 *   2. `<attrName>`
 *   3. `<attrName>_enum`
 */
function resolveSavedQueryEnumName(
  queryName: string,
  attrName: string,
  enums: Set<string>,
): string | undefined {
  if (enums.size === 0 || !attrName) return undefined;
  const candidates = [
    `${queryName}_${attrName}`,
    attrName,
    `${attrName}_enum`,
  ];
  for (const c of candidates) {
    if (enums.has(c)) return c;
  }
  return undefined;
}

/**
 * If `ref` looks like `...saved-query.<thisQuery>.<name>`, return `<name>`.
 * Otherwise return `null` (entity ref, malformed, or missing).
 */
export function parseSavedQueryRef(
  ref: string | null | undefined,
  queryName: string,
): string | null {
  if (!ref) return null;
  const parts = ref.split('.');
  // Expect a `.saved-query.` (or `.saved-queries.`) segment followed by the
  // query name and the internal attribute name.
  let sqIdx = parts.indexOf('saved-query');
  if (sqIdx < 0) sqIdx = parts.indexOf('saved-queries');
  if (sqIdx < 0 || sqIdx + 2 >= parts.length) return null;
  if (parts[sqIdx + 1] !== queryName) return null;
  return parts[sqIdx + 2];
}

/**
 * If `ref` looks like `{appKey}.entity.<name>`, return the entity `<name>`
 * (snake_case). Otherwise return `null`.
 *
 * Used to bridge `object`/`array` attributes whose `component_reference`
 * points at an entity definition (e.g. `wealthdomain_xxx.entity.account`)
 * to the generated entity TS type under `src/types/entities/`. We take the
 * segment immediately after `entity` and ignore any trailing field path
 * (e.g. `.entity.sr_instance.id` → `sr_instance`); a field-level ref is a
 * scalar handled by `type`, not an object shape.
 */
function parseEntityRef(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const parts = ref.split('.');
  const idx = parts.indexOf('entity');
  if (idx < 0 || idx + 1 >= parts.length) return null;
  const name = parts[idx + 1];
  return name && name.length > 0 ? name : null;
}

/**
 * Extract the owning app key from `{appKey}.entity.<name>` — the segments
 * BEFORE `entity` (e.g. `wealthdomain_xxx.entity.account` → `wealthdomain_xxx`).
 * Returns `null` when the ref carries no app-key prefix.
 */
function parseEntityRefAppKey(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const parts = ref.split('.');
  const idx = parts.indexOf('entity');
  if (idx <= 0) return null;
  const appKey = parts.slice(0, idx).join('.');
  return appKey.length > 0 ? appKey : null;
}

/**
 * Resolve which per-app `entities/<appKeyDir>/` folder an entity import should
 * point at. Entities are foldered per app and a name can exist in several, so
 * prefer (1) the ref's own app key, then (2) the saved query's entity app,
 * then (3) the only folder on disk, falling back to the ref/sq hint.
 */
function resolveEntityDir(
  name: string,
  refAppKey: string | null,
  ctx: ResolverContext,
): string {
  const refDir = refAppKey ? appKeyDir(refAppKey) : '';
  const dirs = ctx.entityDirsByName.get(name);
  if (dirs && dirs.size > 0) {
    if (refDir && dirs.has(refDir)) return refDir;
    if (ctx.sqEntityAppDir && dirs.has(ctx.sqEntityAppDir)) return ctx.sqEntityAppDir;
    if (dirs.size === 1) return [...dirs][0];
    return refDir || ctx.sqEntityAppDir || [...dirs].sort()[0];
  }
  return refDir || ctx.sqEntityAppDir;
}

/**
 * Resolve an attribute (of type `object` or `array` whose own `attributes` are
 * empty) into an inline TS object body by following its `component_reference`
 * to a sibling `internal` attribute.
 *
 * Returns the resolved attributes, or `null` when unresolvable.
 */
function resolveByRef(
  attr: QueryAttribute,
  ctx: ResolverContext,
  visited: Set<string>,
): QueryAttribute[] | null {
  if (attr.attributes && attr.attributes.length > 0) return attr.attributes;
  const refName = parseSavedQueryRef(attr.component_reference, ctx.queryName);
  if (!refName) return null;
  if (visited.has(refName)) return null;
  const target = ctx.internals.get(refName);
  if (!target) return null;
  visited.add(refName);
  return target;
}

/**
 * Resolve an `object`/`array` attribute whose `component_reference` points at
 * an entity definition (`{appKey}.entity.<name>`) to the generated entity TS
 * type name (e.g. `account` → `Account`), recording the entity name so the
 * file emitter adds the import. Returns `null` when the ref isn't an entity
 * ref or the entity type isn't generated on disk (caller falls back to
 * `Record<string, unknown>` / `unknown[]`).
 */
function resolveEntityRefType(
  attr: QueryAttribute,
  ctx: ResolverContext,
): string | null {
  const entityName = parseEntityRef(attr.component_reference);
  if (!entityName) return null;
  // A field-level ref (e.g. `.entity.sr_instance.id`) is a scalar, not an
  // object — only bridge when the ref names an entity we actually generated.
  if (!ctx.knownEntityNames.has(entityName)) return null;
  const refAppKey = parseEntityRefAppKey(attr.component_reference);
  ctx.referencedEntities.set(entityName, resolveEntityDir(entityName, refAppKey, ctx));
  return pascalCase(entityName);
}

// =============================================================================
// Type rendering
// =============================================================================

/** Render the TS type for a single attribute. */
function attrTsType(
  attr: QueryAttribute,
  ctx: ResolverContext,
  indent: number,
  visited: Set<string>,
): string {
  const t = (attr.type ?? '').toLowerCase();
  if (t === 'array') {
    const inner = resolveByRef(attr, ctx, visited);
    if (inner) {
      return `${renderObjectInline(inner, ctx, indent + 1, visited)}[]`;
    }
    // Element shape via entity reference (e.g. `.entity.document`).
    const entityType = resolveEntityRefType(attr, ctx);
    if (entityType) return `${entityType}[]`;
    return 'unknown[]';
  }
  if (t === 'object') {
    const inner = resolveByRef(attr, ctx, visited);
    if (inner) {
      return renderObjectInline(inner, ctx, indent + 1, visited);
    }
    // Object shape via entity reference (e.g. `.entity.account`).
    const entityType = resolveEntityRefType(attr, ctx);
    if (entityType) return entityType;
    return 'Record<string, unknown>';
  }
  if (t === 'enumeration') {
    const enumName = resolveSavedQueryEnumName(
      ctx.queryName,
      attr.name,
      ctx.knownEnumerationNames,
    );
    if (enumName) {
      ctx.referencedEnumerations.add(enumName);
      return enumPascalFromName(enumName);
    }
    return SCALAR_TS_TYPE[t] ?? 'string';
  }
  return SCALAR_TS_TYPE[t] ?? 'unknown';
}

/** Delegates to `enumClassName` from `src/lib/enumerations-codegen.ts` so the
 *  PascalCase (and its non-identifier-char sanitisation) stays in sync with
 *  the enum codegen — a Phoenix enum name may contain a `/` (e.g.
 *  `AccountTypeOptions_Corporate/Business`). */
function enumPascalFromName(name: string): string {
  return enumClassName(name);
}

function renderObjectInline(
  attrs: QueryAttribute[],
  ctx: ResolverContext,
  indent: number,
  visited: Set<string>,
): string {
  if (attrs.length === 0) return 'Record<string, unknown>';
  const pad = '  '.repeat(indent);
  const closePad = '  '.repeat(indent - 1);
  const lines: string[] = ['{'];
  for (const a of attrs) {
    const optional = a.required ? '' : '?';
    const ts = attrTsType(a, ctx, indent, new Set(visited));
    if (a.label || a.description) {
      const docBits: string[] = [];
      if (a.label) docBits.push(a.label);
      if (a.description) docBits.push(a.description);
      lines.push(`${pad}/** ${docBits.join(' — ')} */`);
    }
    lines.push(`${pad}${quoteKey(a.name)}${optional}: ${ts};`);
  }
  lines.push(`${closePad}}`);
  return lines.join('\n');
}

/**
 * For LIST saved queries (`is_single_output: false`), detect the common
 * pattern: exactly one top-level `output` attribute of `type: 'array'` whose
 * element shape can be resolved (either inline `attributes` or a sibling
 * `internal` matched via `component_reference`).
 *
 * In that case the runtime hook normaliser unwraps the server response
 * (`{ <key>: [...rows] }`) to a flat `Row[]`, so emitting the wrapper
 * shape (`{ <key>?: Row[] }`) creates a type-vs-runtime mismatch (see
 * docstring on `useSavedQueryList`). Detect and unwrap — return the
 * element's resolved attributes so the caller emits `Row` as the element
 * type itself.
 *
 * Returns `null` when the pattern doesn't apply (caller falls back to the
 * default wrapping behaviour).
 */
function tryUnwrapListRowAttributes(
  outputs: QueryAttribute[],
  ctx: ResolverContext,
): QueryAttribute[] | null {
  if (outputs.length !== 1) return null;
  const only = outputs[0];
  if ((only.type ?? '').toLowerCase() !== 'array') return null;
  const elementAttrs = resolveByRef(only, ctx, new Set());
  if (!elementAttrs || elementAttrs.length === 0) return null;
  return elementAttrs;
}

/**
 * For SINGLE-output saved queries (`is_single_output: true`), mirror the list
 * unwrap: when there's exactly one top-level `output` attribute of type
 * `object` whose inner shape resolves, the `/execute/single` endpoint
 * returns the inner object directly (without the wrapper key).
 *
 * Without this unwrap, the generated `Result` type wraps the inner shape
 * under the metadata's output-attribute name (e.g. `client_aggregate`),
 * which doesn't exist in the actual response. Catalog-emitted
 * `countSelector` paths and direct field access via `useSavedQuerySingle`
 * both silently return `undefined`.
 *
 * Returns `null` when the pattern doesn't apply (e.g. multiple outputs, or
 * a scalar single output) — caller falls back to wrapping.
 */
function tryUnwrapSingleResultAttributes(
  outputs: QueryAttribute[],
  ctx: ResolverContext,
): QueryAttribute[] | null {
  if (outputs.length !== 1) return null;
  const only = outputs[0];
  if ((only.type ?? '').toLowerCase() !== 'object') return null;
  const innerAttrs = resolveByRef(only, ctx, new Set());
  if (!innerAttrs || innerAttrs.length === 0) return null;
  return innerAttrs;
}

// =============================================================================
// Searchable-column heuristic (for the top-toolbar global search)
// =============================================================================

/**
 * Attribute `type` values that we consider plain text — safe to feed to
 * `stringContainsIgnoreCase(...)` server-side. Both simple-DSL and
 * BusinessType vocabularies are listed (all lower-cased for comparison).
 */
const SEARCHABLE_TYPE_ALLOWLIST = new Set([
  // Simple
  'string',
  'text',
  'email',
  'url',
  // BusinessType
  'multilinetext',
  'phonenumber',
  'ssn',
  'enumeration',
  'ltree',
]);

/**
 * Types we explicitly exclude even though some map to TS `string`. UUIDs
 * are noise (rarely what users mean by "search"), dates need range/exact
 * matchers, file/seal/signature are binary-ish.
 */
const SEARCHABLE_TYPE_BLOCKLIST = new Set([
  'uuid',
  'date',
  'date_time',
  'datetime',
  'file',
  'seal',
  'signature',
  'json',
  'computed',
  'link',
  'backlink',
]);

/** Field-name fragments that strongly suggest a search target. */
const PREFERRED_SEARCH_NAMES = [
  'name',
  'title',
  'label',
  'email',
  'username',
  'number',
];

/** Field names we never want as search targets even if their type is text. */
const SKIP_SEARCH_NAMES = new Set([
  'id',
  'uuid',
  'created_at',
  'modified_at',
  'updated_at',
  'created_by',
  'modified_by',
  'updated_by',
]);

interface SearchableCandidate {
  name: string;
  /** Higher = better candidate. */
  score: number;
}

function scoreSearchableField(attr: QueryAttribute): SearchableCandidate | null {
  const name = attr.name;
  if (!name) return null;
  const lower = name.toLowerCase();
  if (SKIP_SEARCH_NAMES.has(lower)) return null;
  if (lower.endsWith('_id')) return null;
  const t = (attr.type ?? '').toLowerCase();
  if (SEARCHABLE_TYPE_BLOCKLIST.has(t)) return null;
  if (!SEARCHABLE_TYPE_ALLOWLIST.has(t)) return null;
  // Preferred-name boost: highest priority to fields whose name suggests
  // a common search target.
  let score = 1;
  for (let i = 0; i < PREFERRED_SEARCH_NAMES.length; i++) {
    const frag = PREFERRED_SEARCH_NAMES[i];
    if (lower === frag) { score += 100 - i; break; }
    if (lower.includes(frag)) { score += 50 - i; break; }
  }
  // Required fields are likely visible columns (and therefore likely
  // search targets); small tie-breaker bump.
  if (attr.required) score += 1;
  return { name, score };
}

/**
 * Pick up to `maxColumns` top-level entity field names that the global
 * search should match. Conservative: only top-level fields, allow-listed
 * text types, no UUID/date/composite. Sorted by name-pattern preference.
 *
 * Default cap is 1: the runtime hook only uses `searchColumns[0]`, so
 * surfacing more in the catalog would be misleading. Callers can override
 * if a different policy is desired in the future.
 */
function findSearchableColumns(
  rowAttrs: QueryAttribute[],
  maxColumns = 1,
): string[] {
  if (!rowAttrs || rowAttrs.length === 0) return [];
  const candidates: SearchableCandidate[] = [];
  for (const attr of rowAttrs) {
    const c = scoreSearchableField(attr);
    if (c) candidates.push(c);
  }
  // Stable sort: by score desc, then declaration order (preserve via
  // original index since `attr.name` is unique here).
  const indexed = candidates.map((c, i) => ({ c, i }));
  indexed.sort((a, b) => b.c.score - a.c.score || a.i - b.i);
  return indexed.slice(0, maxColumns).map((x) => x.c.name);
}

/**
 * Extract the saved query's REQUIRED input attribute names. The runtime
 * hook (`useSavedQueryTable`) gates the network request on these being
 * non-empty: when any is missing, no API call is made and the DataTable
 * renders a "Provide: …" empty state instead of firing a request that
 * would 400 or return zero rows.
 */
function findRequiredInputs(attrs: QueryAttribute[]): string[] {
  if (!attrs || attrs.length === 0) return [];
  const out: string[] = [];
  for (const a of attrs) {
    if ((a.attributeType ?? '').toLowerCase() !== 'input') continue;
    if (RESERVED_INPUT_NAMES.has(a.name)) continue;
    if (a.required !== true) continue;
    out.push(a.name);
  }
  return out;
}

/** Render `export interface Name { … }` (top-level, indent = 1). */
function renderInterface(
  name: string,
  attrs: QueryAttribute[],
  ctx: ResolverContext,
): string {
  if (attrs.length === 0) {
    return `export interface ${name} {\n  [key: string]: unknown;\n}`;
  }
  const lines: string[] = [];
  lines.push(`export interface ${name} {`);
  for (const a of attrs) {
    const optional = a.required ? '' : '?';
    const ts = attrTsType(a, ctx, 2, new Set());
    if (a.label || a.description) {
      const docBits: string[] = [];
      if (a.label) docBits.push(a.label);
      if (a.description) docBits.push(a.description);
      lines.push(`  /** ${docBits.join(' — ')} */`);
    }
    lines.push(`  ${quoteKey(a.name)}${optional}: ${ts};`);
  }
  lines.push(`}`);
  return lines.join('\n');
}

// =============================================================================
// Per-saved-query module emitter
// =============================================================================

/** Pagination/sort/filter names — never surfaced on the generated Input type. */
const RESERVED_INPUT_NAMES = new Set(['_page', '_size', '_sort', '_filter']);

const WRITE_OPS = ['insert', 'update', 'delete'] as const;
type WriteOp = (typeof WRITE_OPS)[number];

/**
 * Find a write op (insert/update/delete) under an entity spec object, e.g.
 * `{ client: { insert: {...} } }` → `insert`.
 */
function writeOpInEntitySpec(obj: unknown): WriteOp | null {
  if (!obj || typeof obj !== 'object') return null;
  for (const root of Object.keys(obj as Record<string, unknown>)) {
    const spec = (obj as Record<string, unknown>)[root];
    if (spec && typeof spec === 'object') {
      for (const op of WRITE_OPS) {
        if (op in (spec as Record<string, unknown>)) return op;
      }
    }
  }
  return null;
}

/**
 * Detect a write op (insert/update/delete) from a saved query's `query` body.
 *
 * Handles two shapes:
 *  - dynamic / patch: a single object `{ <entity>: { insert|update|delete } }`.
 *  - common_table_expression / multi_query: an ARRAY of sub-queries, each
 *    `{ name, type, query: { <entity>: { insert|... } } }`. We scan each
 *    element's `query` for the op (the first one found wins).
 */
export function detectWriteOp(queryStr: string | undefined): WriteOp | null {
  if (!queryStr) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(queryStr);
  } catch {
    return null;
  }
  if (Array.isArray(obj)) {
    for (const el of obj) {
      const inner =
        el && typeof el === 'object'
          ? (el as Record<string, unknown>).query
          : null;
      const op = writeOpInEntitySpec(inner);
      if (op) return op;
    }
    return null;
  }
  return writeOpInEntitySpec(obj);
}

/**
 * Extract input field names from a write query body's placeholders — both the
 * `$body.<field>` form (e.g. `$body.id`, `$body.name`) and a bare `$field`.
 * The server only surfaces FILTER placeholders as input attributes — SET-clause
 * ones (`insert`/`update` values) are dropped — so we parse the raw string to
 * recover the full write input set.
 */
export function extractPlaceholders(queryStr: string | undefined): string[] {
  if (!queryStr) return [];
  const seen = new Set<string>();
  const re = /\$(?:body\.)?([A-Za-z_][A-Za-z0-9_]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(queryStr)) !== null) seen.add(m[1]);
  return [...seen];
}

interface RenderedSavedQuery {
  source: string;
  name: string;
  /**
   * Registry key for the typed maps/union. Equals `name` for the common case;
   * for a name that exists in 2+ apps the FIRST occurrence keeps the bare
   * `name` (so existing `useSavedQueryTable("name")` calls keep working) and
   * the later ones get `name__<appKeyDir>` so both are represented and the
   * hook lookups don't collide.
   */
  registryName?: string;
  pascal: string;
  isSingle: boolean;
  appKey: string;
  isComposite: boolean;
  /** Write op (insert/update/delete) when this is a write query, else undefined. */
  operation?: WriteOp;
  inputTypeName: string;
  rowTypeName: string;
  /** Fields needed by the catalog renderer. */
  label: string;
  description: string;
  type: string;
  inputNames: SavedQueryCatalogField[];
  outputNames: string[];
  /**
   * Raw output attribute tree (post-internal resolution). Used by the
   * count-companion auto-detection to find the numeric leaf path.
   */
  outputAttrs: QueryAttribute[];
  /**
   * Heuristically-picked text fields from the unwrapped row shape that
   * the toolbar search should match against. Empty array when no
   * appropriate field was detected.
   */
  searchColumns: string[];
  /**
   * Names of input attributes marked `required: true`. The runtime hook
   * gates the network request on these being non-empty in the page's
   * `input` bag.
   */
  requiredInputs: string[];
  /** Filled in by the count-companion detector after all queries render. */
  countCompanion?: string;
  countSelectorPath?: string;
}

export function renderSavedQueryFile(
  sq: SavedQuery,
  knownEnumerationNames: Set<string>,
  knownEntityNames: Set<string> = new Set(),
  entityDirsByName: Map<string, Set<string>> = new Map(),
): RenderedSavedQuery {
  const pascal = pascalCase(sq.name);
  const prefix = constCase(sq.name);
  const ctx = buildResolverContext(
    sq,
    knownEnumerationNames,
    knownEntityNames,
    entityDirsByName,
  );
  const allAttrs = sq.attributes ?? [];

  const inputs = allAttrs
    .filter((a) => (a.attributeType ?? '').toLowerCase() === 'input')
    // Strip pagination/sort/filter from the input interface — these are
    // surfaced via the `options` arg on the wrapper, not the input bag.
    .filter((a) => !RESERVED_INPUT_NAMES.has(a.name));

  const outputs = allAttrs.filter(
    (a) => (a.attributeType ?? '').toLowerCase() === 'output',
  );

  const isSingle = sq.is_single_output === true;
  // The saved-query `execute` call is ROUTED by the app that OWNS the query
  // (`app_definition_key`), which becomes `X-Jiffy-App-Name`. A cross-app
  // saved query also has `target_app_definition_key` — the app whose ENTITY
  // it reads — but that's used SERVER-SIDE by the data-manager, NOT for
  // routing the execute call. Using `target_*` here sent the request to the
  // wrong app for cross-app queries. Always prefer the owner.
  const appKey =
    sq.app_definition_key ?? sq.target_app_definition_key ?? '';
  const type = sq.type ?? 'dynamic';
  const isComposite =
    type === 'multi_query' || type === 'common_table_expression';
  // `patch` is the only mutating saved-query type. It is dispatched
  // server-side before any read/SSRM parsing: POST /execute with a FLAT
  // JSON body of the input params (top-level `id` required), returning the
  // patched row. See data-manager handler/query_handler.go:384.
  const isPatch = type === 'patch';
  // PHX-3814 writes: type stays `dynamic`, but the query body carries an
  // insert/update/delete op. Detect it so we emit a mutation — not a read.
  const writeOp = detectWriteOp(sq.query);
  const isWrite = writeOp !== null;

  const inputTypeName = `${pascal}Input`;
  const rowTypeName = isSingle ? `${pascal}Result` : `${pascal}Row`;
  const optionsTypeName = `Execute${pascal}Options`;
  const fnName = `execute${pascal}`;
  // All saved queries POST to `/execute`. The `/execute/single` route is not
  // reliably available for read queries (it 404s for some apps), so single-
  // output reads also call `/execute` and unwrap the first row (see the read
  // wrapper below). Writes/patch were always `/execute`.
  const endpoint = `/saved-queries/${sq.name}/execute`;
  // `isWrite` is tested BEFORE `isComposite`: a CTE/multi_query body can carry
  // an insert/update/delete, in which case it's a write (not a composite read).
  const returnType = isWrite
    ? writeOp === 'insert'
      ? rowTypeName // insert returns the new row's id object
      : `${rowTypeName}[]` // update/delete return the affected row(s)
    : isComposite
      ? 'unknown'
      : isPatch
        ? rowTypeName // patch returns the single patched row object
        : isSingle
          ? `${rowTypeName} | null`
          : `${rowTypeName}[]`;

  // Split file emission into header, imports, and body. Enum imports are
  // appended after the body has been rendered (and `ctx.referencedEnumerations`
  // is populated) so we know which enums to import without a two-pass scan.
  const header: string[] = [];
  header.push(
    `// AUTO-GENERATED by scripts/fetch-saved-queries.ts - do not edit by hand.`,
  );
  header.push(
    `// Source: Phoenix /api/internal/component-definitions-all/saved-query`,
  );
  header.push(
    `// Saved query: ${sq.name}${
      sq.label ? ` ("${sq.label.replace(/\r?\n/g, ' ').trim()}")` : ''
    }`,
  );
  header.push(
    `// Type: ${type}  |  Single output: ${isSingle ? 'true' : 'false'}` +
      `${appKey ? `  |  App: ${appKey}` : ''}`,
  );
  if (sq.description) {
    header.push(`// ${sq.description.replace(/\r?\n/g, ' ').trim()}`);
  }
  header.push(``);
  header.push(`import { apiManager } from '@/services/api-manager';`);
  header.push(`import { getDataHeaders } from '@/config/api-config';`);
  if (!isWrite && !isPatch && !isComposite && type === 'dynamic') {
    // Dynamic read wrappers translate the sort expression into the body
    // `sort` array; the parser lives with the shared request builder.
    header.push(
      `import { parseSortExpression } from '@/hooks/saved-query-request';`,
    );
  }
  // Enum imports placeholder — filled in after body rendering.
  const enumImportPlaceholder = '__ENUM_IMPORTS__';
  header.push(enumImportPlaceholder);
  header.push(``);

  const lines: string[] = [];

  // Input interface.
  if (isWrite) {
    // Write inputs are always FLAT fields — the `$body.<field>` (or bare
    // `$field`) placeholders in the query body — sent as a flat JSON body.
    // `$body.name` means "the `name` field of the request payload", NOT a
    // nested `{ body: { name } }`. The server drops SET-clause placeholders,
    // so recover them from the raw query string.
    const placeholders = extractPlaceholders(sq.query).sort();
    if (placeholders.length > 0) {
      lines.push(
        `/** Input parameters for \`${sq.name}\` (write — sent as a flat JSON body). */`,
      );
      lines.push(`export interface ${inputTypeName} {`);
      for (const ph of placeholders) lines.push(`  ${ph}: string;`);
      lines.push(`}`);
    } else {
      lines.push(`/** Input parameters for \`${sq.name}\` (none). */`);
      lines.push(`export type ${inputTypeName} = Record<string, never>;`);
    }
  } else if (inputs.length > 0) {
    lines.push(`/** Input parameters for \`${sq.name}\`. */`);
    lines.push(renderInterface(inputTypeName, inputs, ctx));
  } else if (isPatch) {
    // A patch with no declared attributes is schema-less server-side: the
    // only structurally-required field is the top-level `id` (UUID); any
    // other entity fields are allowed.
    lines.push(
      `/** Patch body for \`${sq.name}\` (no attributes declared — \`id\` required, other entity fields allowed). */`,
    );
    lines.push(
      `export type ${inputTypeName} = { id: string } & Record<string, unknown>;`,
    );
  } else {
    lines.push(
      `/** Input parameters for \`${sq.name}\` (none declared). */`,
    );
    lines.push(`export type ${inputTypeName} = Record<string, never>;`);
  }
  lines.push(``);

  // Output / Row interface.
  if (isWrite) {
    // Prefer the declared single `output` attribute (resolved via its internal
    // sibling — e.g. `client` → `clientOutput` with id/client_name/active).
    // Otherwise a write returns just the affected row's id (`{id}` insert,
    // `[{id}]` update/delete).
    const writeOut =
      outputs.length === 1
        ? tryUnwrapSingleResultAttributes(outputs, ctx)
        : null;
    if (writeOut) {
      lines.push(
        `/** Row returned by \`${sq.name}\` (write).`,
      );
      lines.push(
        ` *  (Unwrapped from the saved query's \`${outputs[0].name}\` output.) */`,
      );
      lines.push(renderInterface(rowTypeName, writeOut, ctx));
    } else {
      lines.push(
        `/** Row returned by \`${sq.name}\` (write — the affected row's id). */`,
      );
      lines.push(`export interface ${rowTypeName} {`);
      lines.push(`  id: string;`);
      lines.push(`}`);
    }
  } else if (isPatch) {
    // Patch returns the patched entity row. Prefer the declared single
    // `output` shape (resolved via its internal sibling or entity ref);
    // otherwise the patched row is an open object.
    const patchOut =
      outputs.length === 1
        ? tryUnwrapSingleResultAttributes(outputs, ctx)
        : null;
    if (patchOut) {
      lines.push(
        `/** Patched row returned by \`${sq.name}\`.`,
      );
      lines.push(
        ` *  (Unwrapped from the saved query's \`${outputs[0].name}\` output.) */`,
      );
      lines.push(renderInterface(rowTypeName, patchOut, ctx));
    } else {
      const entityType =
        outputs.length === 1 ? resolveEntityRefType(outputs[0], ctx) : null;
      lines.push(`/** Patched row returned by \`${sq.name}\`. */`);
      lines.push(
        `export type ${rowTypeName} = ${entityType ?? 'Record<string, unknown>'};`,
      );
    }
  } else if (isComposite) {
    lines.push(
      `// TODO: ${type} saved queries return a map keyed by sub-query name`,
    );
    lines.push(
      `//       (multi_query) or the last sub-query's result (CTE). Codegen`,
    );
    lines.push(
      `//       for composite shapes is not implemented yet — the wrapper`,
    );
    lines.push(`//       returns \`unknown\` until typed by hand.`);
    lines.push(`export type ${rowTypeName} = unknown;`);
  } else if (isSingle) {
    // Same as the list unwrap, but for `/execute/single`: when there's
    // exactly one top-level object output, the server returns the inner
    // shape directly (without the wrapper key).
    const unwrappedSingle = tryUnwrapSingleResultAttributes(outputs, ctx);
    if (unwrappedSingle) {
      const onlyOutput = outputs[0];
      lines.push(
        `/** Result for \`${sq.name}\` (single output).`,
      );
      lines.push(
        ` *  (Unwrapped from the saved query's \`${onlyOutput.name}\` output.) */`,
      );
      lines.push(renderInterface(rowTypeName, unwrappedSingle, ctx));
    } else {
      lines.push(`/** Result for \`${sq.name}\` (single output). */`);
      lines.push(renderInterface(rowTypeName, outputs, ctx));
    }
  } else {
    // List saved query: when there's exactly one top-level array output,
    // emit Row as the element shape (the hook normaliser already unwraps
    // `{ <key>: [...] }` to a flat array at runtime).
    const unwrapped = tryUnwrapListRowAttributes(outputs, ctx);
    if (unwrapped) {
      const onlyOutput = outputs[0];
      lines.push(
        `/** Single row in the \`${sq.name}\` result set.`,
      );
      lines.push(
        ` *  (Unwrapped from the saved query's \`${onlyOutput.name}\` output array.) */`,
      );
      lines.push(renderInterface(rowTypeName, unwrapped, ctx));
    } else {
      lines.push(`/** Single row in the \`${sq.name}\` result set. */`);
      lines.push(renderInterface(rowTypeName, outputs, ctx));
    }
  }
  lines.push(``);

  // Constants.
  lines.push(`export const ${prefix}_NAME = ${JSON.stringify(sq.name)};`);
  lines.push(`export const ${prefix}_IS_SINGLE = ${isSingle} as const;`);
  lines.push(`export const ${prefix}_APP_KEY = ${JSON.stringify(appKey)};`);
  lines.push(``);

  if (isWrite) {
    // ---- Write wrapper (insert/update/delete) ----------------------------
    // All writes POST /execute with the inputs as a FLAT JSON body; the stored
    // query references them as `$body.<field>`. The server substitutes and
    // runs the op. Returns the affected row id(s) ({id} insert, [{id}] else).
    lines.push(`/**`);
    lines.push(` * Execute the \`${sq.name}\` saved query. WRITE (${writeOp}).`);
    lines.push(
      ` * Inputs are sent as a flat JSON body; returns the affected row(s).`,
    );
    lines.push(` */`);
    lines.push(`export async function ${fnName}(`);
    lines.push(`  input: ${inputTypeName},`);
    lines.push(`): Promise<${returnType}> {`);
    lines.push(
      `  const headers = getDataHeaders(${prefix}_APP_KEY || undefined);`,
    );
    lines.push(
      `  const response = await apiManager.post('data', ${JSON.stringify(endpoint)}, input, headers);`,
    );
    lines.push(`  return response.data as ${returnType};`);
    lines.push(`}`);
    lines.push(``);
  } else if (isPatch) {
    // ---- Write (patch) wrapper -------------------------------------------
    // Patch is a mutation: POST /execute with the input object as a FLAT
    // JSON body (top-level `id` required; the server strips it and treats
    // the rest as entity fields). No URL params, no _page/_sort/_filter.
    // Returns the patched row. Server errors (404 unknown id, 400 bad id,
    // 422 validation) propagate as thrown errors.
    lines.push(`/**`);
    lines.push(` * Execute the \`${sq.name}\` saved query. WRITE (patch).`);
    lines.push(
      ` * Sends the input as a flat JSON body and returns the patched row.`,
    );
    lines.push(
      ` * \`id\` is required; the server maps it to the record being patched.`,
    );
    lines.push(` */`);
    lines.push(`export async function ${fnName}(`);
    lines.push(`  input: ${inputTypeName},`);
    lines.push(`): Promise<${returnType}> {`);
    lines.push(
      `  const headers = getDataHeaders(${prefix}_APP_KEY || undefined);`,
    );
    lines.push(
      `  const response = await apiManager.post('data', ${JSON.stringify(endpoint)}, input, headers);`,
    );
    lines.push(`  return response.data as ${returnType};`);
    lines.push(`}`);
    lines.push(``);
  } else {
    // ---- Read wrapper (dynamic / single / composite) ---------------------
    // Dynamic reads carry pagination/sort/filter in the JSON body (SSRM list
    // request). Non-dynamic reads (sql / multi_query / CTE) keep the legacy
    // URL params — the data-manager rejects SSRM bodies for those types.
    const usesBodyControls = type === 'dynamic';
    // Options interface.
    lines.push(`export interface ${optionsTypeName} {`);
    if (!isSingle) {
      if (usesBodyControls) {
        lines.push(`  /** Zero-based page index (body \`page\`, offset mode). */`);
        lines.push(`  page?: number;`);
        lines.push(`  /** Page size (body \`page.size\`). */`);
        lines.push(`  pageSize?: number;`);
      } else {
        lines.push(`  /** Maps to \`_page\` URL query param. */`);
        lines.push(`  page?: number;`);
        lines.push(`  /** Maps to \`_size\` URL query param. */`);
        lines.push(`  pageSize?: number;`);
      }
    }
    if (usesBodyControls) {
      lines.push(
        `  /** Sort: comma-separated, \`-\` prefix for descending (e.g. 'status,-balance'). Body \`sort\`. */`,
      );
      lines.push(`  sort?: string;`);
      lines.push(`  /** CEL filter expression (body \`filterExpression\`). */`);
      lines.push(`  filter?: string;`);
    } else {
      lines.push(
        `  /** Maps to \`_sort\` URL query param (e.g. 'status,-balance'). */`,
      );
      lines.push(`  sort?: string;`);
      lines.push(`  /** Maps to \`_filter\` URL param (CEL expression). */`);
      lines.push(`  filter?: string;`);
    }
    lines.push(`}`);
    lines.push(``);

    // Wrapper.
    lines.push(`/**`);
    lines.push(` * Execute the \`${sq.name}\` saved query. Read-only.`);
    if (isSingle) {
      lines.push(
        ` * Returns \`null\` when the server reports NO_RESULTS_FOUND (HTTP 404).`,
      );
    }
    lines.push(` */`);
    lines.push(`export async function ${fnName}(`);
    const inputOptional =
      inputs.length === 0 || inputs.every((a) => !a.required);
    lines.push(`  input${inputOptional ? '?' : ''}: ${inputTypeName},`);
    lines.push(`  options?: ${optionsTypeName},`);
    lines.push(`): Promise<${returnType}> {`);
    lines.push(
      `  const headers = getDataHeaders(${prefix}_APP_KEY || undefined);`,
    );
    lines.push(`  const params = new URLSearchParams();`);
    lines.push(`  if (input) {`);
    lines.push(`    for (const [k, v] of Object.entries(input)) {`);
    lines.push(`      if (v === undefined || v === null) continue;`);
    lines.push(
      `      if (k === '_page' || k === '_size' || k === '_sort' || k === '_filter') continue;`,
    );
    lines.push(`      params.set(k, String(v));`);
    lines.push(`    }`);
    lines.push(`  }`);
    if (usesBodyControls) {
      // Body-based SSRM list request. The server only treats the body as a
      // list request when `page` is present, so include it whenever any
      // control is set. `position` is the ROW OFFSET (page × size).
      lines.push(`  const body: Record<string, unknown> = {};`);
      if (isSingle) {
        lines.push(`  if (options?.sort || options?.filter) {`);
        lines.push(
          `    body.page = { mode: 'offset', position: '0', size: 1 };`,
        );
      } else {
        lines.push(
          `  if (options?.page !== undefined || options?.pageSize !== undefined || options?.sort || options?.filter) {`,
        );
        lines.push(`    const size = options?.pageSize ?? 50;`);
        lines.push(
          `    body.page = { mode: 'offset', position: String((options?.page ?? 0) * size), size };`,
        );
      }
      lines.push(`    const sortRules = parseSortExpression(options?.sort);`);
      lines.push(`    if (sortRules.length > 0) body.sort = sortRules;`);
      lines.push(
        `    if (options?.filter) body.filterExpression = options.filter;`,
      );
      lines.push(`  }`);
    } else {
      // Legacy URL-param transport (sql / multi_query / CTE reads).
      if (!isSingle) {
        lines.push(
          `  if (options?.page !== undefined) params.set('_page', String(options.page));`,
        );
        lines.push(
          `  if (options?.pageSize !== undefined) params.set('_size', String(options.pageSize));`,
        );
      }
      lines.push(`  if (options?.sort) params.set('_sort', options.sort);`);
      lines.push(`  if (options?.filter) params.set('_filter', options.filter);`);
      lines.push(`  const body = {};`);
    }
    lines.push(`  const qs = params.toString();`);
    lines.push(
      `  const url = qs ? \`${endpoint}?\${qs}\` : ${JSON.stringify(endpoint)};`,
    );
    if (isSingle) {
      lines.push(`  try {`);
      lines.push(`    const response = await apiManager.post('data', url, body, headers);`);
      lines.push(`    const data = response.data;`);
      // Single reads hit the LIST endpoint (`/execute`), so the response can be
      // an array, `{data:[...]}`, `{<key>:[...]}`, or a bare object. Unwrap the
      // first row; null when empty.
      lines.push(`    if (data == null) return null;`);
      lines.push(`    if (Array.isArray(data)) return (data.length ? data[0] : null) as ${returnType};`);
      lines.push(`    if (typeof data === 'object') {`);
      lines.push(`      const obj = data as Record<string, unknown>;`);
      lines.push(`      if (Array.isArray(obj.data)) return (obj.data.length ? obj.data[0] : null) as ${returnType};`);
      lines.push(`      if (obj.data && typeof obj.data === 'object') return obj.data as ${returnType};`);
      lines.push(`      const keys = Object.keys(obj);`);
      lines.push(`      if (keys.length === 1 && Array.isArray(obj[keys[0]])) {`);
      lines.push(`        const arr = obj[keys[0]] as unknown[];`);
      lines.push(`        return (arr.length ? arr[0] : null) as ${returnType};`);
      lines.push(`      }`);
      // `obj` is `Record<string, unknown>`; a direct cast to a result type with
      // required fields is a TS2352 error under `tsc -b`. Widen via `unknown`.
      lines.push(`      return obj as unknown as ${returnType};`);
      lines.push(`    }`);
      lines.push(`    return data as ${returnType};`);
      lines.push(`  } catch (err: unknown) {`);
      lines.push(
        `    // Map server 404 NO_RESULTS_FOUND → null so callers can render`,
      );
      lines.push(`    // "no data" without branching on errors.`);
      lines.push(`    const status = (err as { response?: { status?: number } })?.response?.status;`);
      lines.push(`    if (status === 404) return null;`);
      lines.push(`    throw err;`);
      lines.push(`  }`);
    } else if (isComposite) {
      lines.push(`  const response = await apiManager.post('data', url, body, headers);`);
      lines.push(`  return response.data as ${returnType};`);
    } else {
      lines.push(`  const response = await apiManager.post('data', url, body, headers);`);
      lines.push(`  const data = response.data;`);
      // Response normalisation: Phoenix may return either a bare array, an
      // object with a single key holding the array (e.g. `{client_list: [...]}`),
      // or `{data: [...]}`. Cover all three.
      lines.push(`  if (Array.isArray(data)) return data as ${returnType};`);
      lines.push(`  if (data && typeof data === 'object') {`);
      lines.push(`    const obj = data as Record<string, unknown>;`);
      lines.push(`    if (Array.isArray(obj.data)) return obj.data as ${returnType};`);
      lines.push(`    const keys = Object.keys(obj);`);
      lines.push(`    if (keys.length === 1 && Array.isArray(obj[keys[0]])) {`);
      lines.push(`      return obj[keys[0]] as ${returnType};`);
      lines.push(`    }`);
      lines.push(`  }`);
      lines.push(`  return [] as ${returnType};`);
    }
    lines.push(`}`);
    lines.push(``);
  }

  // Build enum + entity imports based on what the body actually referenced.
  const refImportLines: string[] = [];
  for (const enumName of [...ctx.referencedEnumerations].sort()) {
    refImportLines.push(
      `import type { ${enumPascalFromName(enumName)} } from '@/types/enumerations';`,
    );
  }
  for (const [entityName, appDir] of [...ctx.referencedEntities].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    // Entities are foldered per app (`entities/<appKeyDir>/<name>.ts`), and the
    // saved-query file is itself nested under its own app folder — so a bare
    // `../entities/<name>` is wrong on both depth and folder. Use the `@/`
    // alias (depth-independent) pointing at the entity's actual app folder.
    const importPath = appDir
      ? `@/types/entities/${appDir}/${entityName}`
      : `@/types/entities/${entityName}`;
    refImportLines.push(
      `import type { ${pascalCase(entityName)} } from '${importPath}';`,
    );
  }
  const enumImportsBlock = refImportLines.join('\n');

  const headerJoined = header
    .map((l) =>
      l === enumImportPlaceholder
        ? enumImportsBlock
        : l,
    )
    // Trim consecutive empty lines that might be left when the placeholder
    // is replaced by ''.
    .filter((l, i, arr) => !(l === '' && arr[i - 1] === ''))
    .join('\n');

  return {
    source: `${headerJoined}\n${lines.join('\n')}`,
    name: sq.name,
    pascal,
    isSingle,
    appKey,
    isComposite,
    inputTypeName,
    rowTypeName,
    label: sq.label ?? '',
    description: sq.description ?? '',
    type,
    // For writes: list the declared input attributes when present (e.g. a
    // `body` object for CTE inserts); otherwise fall back to the $placeholders
    // (flat writes — the server drops SET-clause placeholders).
    inputNames:
      isWrite && inputs.length === 0
        ? extractPlaceholders(sq.query)
            .sort()
            .map((name) => ({ name, required: true }))
        : inputs.map((a) => ({
            name: a.name,
            required: a.required === true,
          })),
    outputNames: outputs.map((a) => a.name),
    outputAttrs: outputs,
    operation: writeOp ?? undefined,
    // Searchable-column heuristic — only meaningful for list saved queries
    // (server-side mode via useSavedQueryTable). For single-output, composite,
    // and write queries we still emit `[]` so the catalog can omit the field.
    searchColumns:
      isSingle || isComposite || isWrite
        ? []
        : findSearchableColumns(
            // Prefer unwrapped row attrs (the actual runtime shape) when
            // the list was unwrapped; otherwise the metadata outputs.
            tryUnwrapListRowAttributes(outputs, ctx) ?? outputs,
          ),
    // Required-input gating — list queries only. Single/composite hooks
    // get input via their own paths and are not gated by this mechanism.
    requiredInputs:
      isSingle || isComposite || isWrite
        ? []
        : findRequiredInputs(allAttrs),
  };
}

// =============================================================================
// Count-companion detection
//
// Conventionally a paginated list saved query named `X` (or `X_list`) is
// paired with a single-output count saved query named `X_count` (or
// `<base>_count`). When we find a pair, we:
//
//  1. Attach `countCompanion` to the list entry so the catalog renderer
//     emits `useSavedQueryTable(<list>, { countQuery, countSelector })`.
//  2. Walk the count companion's output schema looking for the first
//     numeric leaf and emit a `countSelectorPath` (e.g.
//     `client_aggregate.ID`). The catalog renderer turns this into
//     `(r) => r?.client_aggregate?.ID`.
//
// When the count companion has no obvious numeric leaf (rare) we leave
// `countSelectorPath` undefined; the catalog falls back to a TODO
// placeholder selector.
// =============================================================================

/** Walk an attribute tree depth-first; return the dotted path of the first
 *  attribute whose type maps to TS `number`. */
function findFirstNumericLeafPath(
  attrs: QueryAttribute[],
  ctx: ResolverContext,
  prefix: string[] = [],
  visited: Set<string> = new Set(),
): string | undefined {
  for (const a of attrs) {
    const t = (a.type ?? '').toLowerCase();
    if (SCALAR_TS_TYPE[t] === 'number') {
      return [...prefix, a.name].join('.');
    }
    if (t === 'object' || t === 'array') {
      const inner = resolveByRef(a, ctx, new Set(visited));
      if (inner && inner.length > 0) {
        const found = findFirstNumericLeafPath(
          inner,
          ctx,
          [...prefix, a.name],
          new Set(visited),
        );
        if (found) return found;
      }
    }
  }
  return undefined;
}

/** Try a list-name → count-name match by convention. */
function findCountCompanionName(
  listName: string,
  allNames: Set<string>,
): string | undefined {
  const candidates: string[] = [];
  candidates.push(`${listName}_count`);
  if (listName.endsWith('_list')) {
    const base = listName.slice(0, -'_list'.length);
    candidates.push(`${base}_count`);
  }
  // Also handle kebab-case variants: `client-list` → `client-count`.
  if (listName.endsWith('-list')) {
    const base = listName.slice(0, -'-list'.length);
    candidates.push(`${base}-count`);
  }
  for (const c of candidates) {
    if (allNames.has(c)) return c;
  }
  return undefined;
}

/**
 * Mutates the entries in place: for every non-composite list query whose
 * conventional count companion exists, set `countCompanion` and (when
 * derivable) `countSelectorPath`. The count companion's own entry is left
 * untouched (it stays a normal `useSavedQuerySingle` invocation).
 */
function attachCountCompanions(
  rendered: RenderedSavedQuery[],
  sqByName: Map<string, SavedQuery>,
  knownEnumerationNames: Set<string>,
  knownEntityNames: Set<string> = new Set(),
  entityDirsByName: Map<string, Set<string>> = new Map(),
): void {
  const nameSet = new Set(rendered.map((r) => r.name));
  for (const r of rendered) {
    if (r.isComposite || r.isSingle || r.operation) continue;
    const companionName = findCountCompanionName(r.name, nameSet);
    if (!companionName) continue;
    const companion = sqByName.get(companionName);
    if (!companion) continue;
    // Companions must be single-output to be useful here. If they aren't,
    // the naming is coincidental — skip.
    if (companion.is_single_output !== true) continue;
    r.countCompanion = companionName;
    const companionOutputs = (companion.attributes ?? []).filter(
      (a) => (a.attributeType ?? '').toLowerCase() === 'output',
    );
    const ctx = buildResolverContext(
      companion,
      knownEnumerationNames,
      knownEntityNames,
      entityDirsByName,
    );

    // Mirror the single-output unwrap (`tryUnwrapSingleResultAttributes`)
    // so the countSelector path matches the emitted `Result` type. Without
    // this, the catalog emits `(r) => r?.client_aggregate?.ID` while the
    // runtime shape is the unwrapped `{ ID: 563 }`.
    let searchRoot = companionOutputs;
    if (
      companionOutputs.length === 1 &&
      (companionOutputs[0].type ?? '').toLowerCase() === 'object'
    ) {
      const inner = resolveByRef(companionOutputs[0], ctx, new Set());
      if (inner && inner.length > 0) {
        searchRoot = inner;
      }
    }

    r.countSelectorPath = findFirstNumericLeafPath(searchRoot, ctx);
  }
}

// =============================================================================
// Aggregate file emitters
// =============================================================================

function renderBarrelFile(rendered: RenderedSavedQuery[]): string {
  const lines: string[] = [];
  lines.push(
    `// AUTO-GENERATED by scripts/fetch-saved-queries.ts - do not edit by hand.`,
  );
  lines.push(``);
  const sorted = [...rendered].sort(
    (a, b) =>
      a.name.localeCompare(b.name) || a.appKey.localeCompare(b.appKey),
  );
  for (const r of sorted) {
    const path = `./${appKeyDir(r.appKey)}/${savedQueryFileStem(r.name)}`;
    if ((r.registryName ?? r.name) === r.name) {
      lines.push(`export * from '${path}';`);
    } else {
      // Cross-app duplicate name — its module exports clash with the bare one,
      // so don't `export *` it here; import from its path directly.
      lines.push(`// '${r.registryName}' (cross-app dup of '${r.name}') → import from '${path}'`);
    }
  }
  lines.push(``);
  return lines.join('\n');
}

function renderSavedQueriesGeneratedFile(
  rendered: RenderedSavedQuery[],
): string {
  const lines: string[] = [];
  lines.push(`/* eslint-disable */`);
  lines.push(
    `// AUTO-GENERATED by scripts/fetch-saved-queries.ts - do not edit by hand.`,
  );
  lines.push(
    `// Source: Phoenix /api/internal/component-definitions-all/saved-query`,
  );
  lines.push(
    `// Regenerated on every workspace bootstrap; stays in sync with`,
  );
  lines.push(`// src/types/saved-queries/*.ts.`);
  lines.push(``);

  if (rendered.length === 0) {
    lines.push(`export type SavedQueryName = never;`);
    lines.push(``);
    lines.push(`export interface SavedQuerySchema {}`);
    lines.push(``);
    // Underscore-prefixed type params are accepted by `noUnusedParameters`.
    // Consumers calling `SavedQueryInputOf<'foo'>` still type-check because
    // the parameter name has no effect on resolution.
    lines.push(`export type SavedQueryInputOf<_N extends SavedQueryName> = never;`);
    lines.push(`export type SavedQueryRowOf<_N extends SavedQueryName> = never;`);
    lines.push(`export type SavedQueryIsSingleOf<_N extends SavedQueryName> = never;`);
    lines.push(`export type SavedQueryAppKeyOf<_N extends SavedQueryName> = never;`);
    lines.push(`export type SavedQueryTypeOf<_N extends SavedQueryName> = never;`);
    lines.push(``);
    lines.push(
      `/** Runtime map of saved-query name → target app-definition key. */`,
    );
    lines.push(
      `export const SAVED_QUERY_APP_KEYS: Record<string, string> = {};`,
    );
    lines.push(``);
    lines.push(
      `/** Runtime map of saved-query name → query type (dynamic|sql|patch|…). */`,
    );
    lines.push(`export const SAVED_QUERY_TYPES: Record<string, string> = {};`);
    lines.push(``);
    lines.push(
      `/** Runtime map of saved-query name → write op (insert|update|delete), '' for reads. */`,
    );
    lines.push(`export const SAVED_QUERY_OPERATIONS: Record<string, string> = {};`);
    lines.push(``);
    return lines.join('\n');
  }

  const sorted = [...rendered].sort(
    (a, b) =>
      a.name.localeCompare(b.name) || a.appKey.localeCompare(b.appKey),
  );
  // Only the "primary" (first-wins, bare-named) query per name goes into the
  // typed registry/maps — its wire name must stay bare (Phoenix resolves the
  // app via the request header). Cross-app duplicates keep their foldered FILE
  // and are listed in the catalog; call them with the bare name + an
  // `appDefinitionKey` override to target the other app.
  const primary = sorted.filter((r) => (r.registryName ?? r.name) === r.name);
  for (const r of primary) {
    const path = `./saved-queries/${appKeyDir(r.appKey)}/${savedQueryFileStem(r.name)}`;
    lines.push(
      `import type { ${r.inputTypeName}, ${r.rowTypeName} } from '${path}';`,
    );
  }
  lines.push(``);

  const namesUnion = primary.map((r) => JSON.stringify(r.name)).join(' | ');
  lines.push(`/** All known saved-query names (typed union). */`);
  lines.push(`export type SavedQueryName = ${namesUnion};`);
  lines.push(``);

  lines.push(`/**`);
  lines.push(` * Master saved-query registry. Consumed by useSavedQueryList /`);
  lines.push(` * useSavedQuerySingle to derive input + row types per query name.`);
  lines.push(` */`);
  lines.push(`export interface SavedQuerySchema {`);
  for (const r of primary) {
    lines.push(`  ${JSON.stringify(r.name)}: {`);
    lines.push(`    input: ${r.inputTypeName};`);
    lines.push(`    row: ${r.rowTypeName};`);
    lines.push(`    isSingle: ${r.isSingle};`);
    lines.push(`    appKey: ${JSON.stringify(r.appKey)};`);
    lines.push(`    type: ${JSON.stringify(r.type)};`);
    lines.push(`  };`);
  }
  lines.push(`}`);
  lines.push(``);

  lines.push(`/** Input shape for a given saved query. */`);
  lines.push(
    `export type SavedQueryInputOf<N extends SavedQueryName> = SavedQuerySchema[N]['input'];`,
  );
  lines.push(``);
  lines.push(
    `/** Output row (list) or result (single) for a given saved query. */`,
  );
  lines.push(
    `export type SavedQueryRowOf<N extends SavedQueryName> = SavedQuerySchema[N]['row'];`,
  );
  lines.push(``);
  lines.push(`/** Whether the saved query is single-output. */`);
  lines.push(
    `export type SavedQueryIsSingleOf<N extends SavedQueryName> = SavedQuerySchema[N]['isSingle'];`,
  );
  lines.push(``);
  lines.push(`/** Target app-definition key for cross-app saved queries. */`);
  lines.push(
    `export type SavedQueryAppKeyOf<N extends SavedQueryName> = SavedQuerySchema[N]['appKey'];`,
  );
  lines.push(``);
  lines.push(`/** Query type (dynamic|sql|multi_query|common_table_expression|patch). */`);
  lines.push(
    `export type SavedQueryTypeOf<N extends SavedQueryName> = SavedQuerySchema[N]['type'];`,
  );
  lines.push(``);

  // Runtime map so the hooks can auto-resolve each query's target app key
  // (the type-level `appKey` above is not available at runtime). Without
  // this, a cross-app saved query (e.g. one owned by `finplanbabutest` while
  // the running app is `wealthdomain`) would be requested against the wrong
  // app because `getDataHeaders(undefined)` falls back to the current app.
  lines.push(
    `/** Runtime map of saved-query name → target app-definition key. */`,
  );
  lines.push(
    `export const SAVED_QUERY_APP_KEYS: Record<SavedQueryName, string> = {`,
  );
  for (const r of primary) {
    lines.push(`  ${JSON.stringify(r.name)}: ${JSON.stringify(r.appKey)},`);
  }
  lines.push(`};`);
  lines.push(``);

  // Runtime map of query type so a runtime hook (useSavedQueryMutation) can
  // assert it's targeting a write/patch query.
  lines.push(
    `/** Runtime map of saved-query name → query type (dynamic|sql|patch|…). */`,
  );
  lines.push(
    `export const SAVED_QUERY_TYPES: Record<SavedQueryName, string> = {`,
  );
  for (const r of primary) {
    lines.push(`  ${JSON.stringify(r.name)}: ${JSON.stringify(r.type)},`);
  }
  lines.push(`};`);
  lines.push(``);

  // Runtime map of write operation (insert|update|delete) for write saved
  // queries; '' for reads. Lets a runtime hook route writes without
  // re-parsing the query body.
  lines.push(
    `/** Runtime map of saved-query name → write op (insert|update|delete), '' for reads. */`,
  );
  lines.push(
    `export const SAVED_QUERY_OPERATIONS: Record<SavedQueryName, string> = {`,
  );
  for (const r of primary) {
    lines.push(`  ${JSON.stringify(r.name)}: ${JSON.stringify(r.operation ?? "")},`);
  }
  lines.push(`};`);
  lines.push(``);

  return lines.join('\n');
}

function writeIfChanged(filePath: string, contents: string): boolean {
  if (existsSync(filePath)) {
    const existing = readFileSync(filePath, 'utf8');
    if (existing === contents) return false;
  }
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
  return true;
}

/** All `.ts` files under `dir`, recursing into per-app subfolders. */
function listSqTsFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, ent.name);
    if (ent.isDirectory()) out.push(...listSqTsFilesRecursive(full));
    else if (ent.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

// =============================================================================
// API call
// =============================================================================

async function fetchSavedQueries(
  apiUrl: string,
  tenant: string,
): Promise<SavedQuery[]> {
  const base = apiUrl.replace(/\/+$/, '');
  const url = phoenixUrl(`${base}/api/internal/component-definitions-all/saved-query`);

  const res = await fetch(url, {
    method: 'GET',
    headers: withAuth({
      accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Jiffy-Tenant': tenant,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `Phoenix API call failed: ${res.status} ${res.statusText} for ${url}\n${body.slice(
        0,
        500,
      )}`,
    );
  }

  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) {
    throw new Error(
      `Unexpected response shape from ${url}: expected an array, got ${typeof data}`,
    );
  }
  return data as SavedQuery[];
}

// =============================================================================
// Main
// =============================================================================

interface RunOptions {
  envPath: string;
  outDir: string;
  generatedTypesPath: string;
  catalogPath: string;
  /**
   * Sibling directory containing per-enum modules from
   * `scripts/fetch-enumerations.ts`. Defaults to `<outDir>/../enumerations`.
   * When omitted or empty, `enumeration`-typed attributes fall back to
   * `string`.
   */
  enumDir?: string;
  /**
   * Sibling directory containing per-entity modules from
   * `scripts/fetch-entities.ts`. Defaults to `<outDir>/../entities`. Used to
   * resolve `{appKey}.entity.<name>` references to the entity TS type.
   */
  entityDir?: string;
}

/**
 * Scan the enumeration outDir for per-enum modules (excluding the barrel)
 * to build a set of available enum names. Each `.ts` filename stem IS the
 * enum name (per `fetch-enumerations.ts`'s `enumFileStem`).
 */
function discoverEnumerationNames(enumDir: string): Set<string> {
  const out = new Set<string>();
  if (!existsSync(enumDir)) return out;
  for (const ent of readdirSync(enumDir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      // Recurse into per-app-key subfolders (enumerations/<appKeyDir>/<stem>.ts).
      for (const name of discoverEnumerationNames(resolve(enumDir, ent.name))) {
        out.add(name);
      }
      continue;
    }
    if (!ent.name.endsWith('.ts')) continue;
    if (ent.name === 'index.ts') continue;
    out.add(ent.name.slice(0, -'.ts'.length));
  }
  return out;
}

/**
 * Scan `src/types/entities/` for generated per-entity modules; the file stem
 * is the snake_case entity name (per `fetch-entities.ts`). Recurses into the
 * per-app-key subfolders (`entities/<appKeyDir>/<name>.ts`) that
 * `fetch-entities.ts` now writes. Used to bridge `{appKey}.entity.<name>`
 * component references to the entity TS type.
 */
function discoverEntityNames(entityDir: string): Set<string> {
  const out = new Set<string>();
  if (!existsSync(entityDir)) return out;
  for (const ent of readdirSync(entityDir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      for (const name of discoverEntityNames(resolve(entityDir, ent.name))) {
        out.add(name);
      }
      continue;
    }
    if (!ent.name.endsWith('.ts')) continue;
    if (ent.name === 'index.ts') continue;
    out.add(ent.name.slice(0, -'.ts'.length));
  }
  return out;
}

/**
 * Like `discoverEntityNames`, but maps each entity name (snake_case stem) to
 * the set of per-app-key folders it appears in under `src/types/entities/`
 * (`entities/<appKeyDir>/<name>.ts`). `prefix` accumulates the folder path
 * relative to the top-level entities dir as we recurse. The emitter uses this
 * to point each entity import at the right folder (a name can exist in 2 apps).
 */
function discoverEntityDirsByName(
  entityDir: string,
  prefix = '',
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  if (!existsSync(entityDir)) return out;
  for (const ent of readdirSync(entityDir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      const childPrefix = prefix ? `${prefix}/${ent.name}` : ent.name;
      for (const [name, dirs] of discoverEntityDirsByName(
        resolve(entityDir, ent.name),
        childPrefix,
      )) {
        const set = out.get(name) ?? new Set<string>();
        for (const d of dirs) set.add(d);
        out.set(name, set);
      }
      continue;
    }
    if (!ent.name.endsWith('.ts')) continue;
    if (ent.name === 'index.ts') continue;
    const stem = ent.name.slice(0, -'.ts'.length);
    const set = out.get(stem) ?? new Set<string>();
    set.add(prefix);
    out.set(stem, set);
  }
  return out;
}

/** Adapt a `RenderedSavedQuery` to the catalog renderer's input shape. */
function toCatalogEntry(r: RenderedSavedQuery): SavedQueryCatalogEntry {
  return {
    name: r.name,
    label: r.label,
    description: r.description,
    type: r.type,
    operation: r.operation,
    isSingle: r.isSingle,
    isComposite: r.isComposite,
    appKey: r.appKey,
    inputs: r.inputNames,
    outputs: r.outputNames,
    countCompanion: r.countCompanion,
    countSelectorPath: r.countSelectorPath,
    // Only surface searchColumns / requiredInputs on list queries (the
    // only path that uses useSavedQueryTable). Single/composite catalog
    // entries omit them so the catalog stays terse for those cases.
    searchColumns:
      r.isSingle || r.isComposite || r.operation ? undefined : r.searchColumns,
    requiredInputs:
      r.isSingle || r.isComposite || r.operation ? undefined : r.requiredInputs,
  };
}

async function run(opts: RunOptions): Promise<void> {
  loadDotEnv(opts.envPath);

  const apiUrl = process.env.PHOENIX_API_URL?.trim();
  const tenant = process.env.TENANT_ID?.trim();

  if (!apiUrl || !tenant) {
    const missing =
      !apiUrl && !tenant
        ? 'PHOENIX_API_URL and TENANT_ID'
        : !apiUrl
          ? 'PHOENIX_API_URL'
          : 'TENANT_ID';
    console.log(
      `fetch-saved-queries: skipped — ${missing} not set. ` +
        `Add to .env and re-run \`npm run fetch:saved-queries\` to populate ` +
        `src/types/saved-queries/ with live tenant data.`,
    );
    // Emit empty registry + empty catalog so the hooks still typecheck and
    // the catalog still exists for the agent to discover (it'll say "no
    // saved queries available" rather than 404).
    //
    // PHX-4513: NEVER clobber an already-populated registry/catalog when we
    // skip for missing creds. A credential-less refetch (e.g. a refetch
    // button that runs this step without PHOENIX_API_URL/TENANT_ID) would
    // otherwise overwrite a good `saved-queries.generated.ts` with an empty
    // stub (`SAVED_QUERY_APP_KEYS = {}`) while leaving the per-item modules
    // intact — silently breaking cross-app saved-query routing (every
    // cross-app query 404s because its app key is no longer in the map).
    // Only write the empty stubs when the files don't exist yet.
    if (!existsSync(opts.generatedTypesPath)) {
      mkdirSync(dirname(opts.generatedTypesPath), { recursive: true });
      writeIfChanged(opts.generatedTypesPath, renderSavedQueriesGeneratedFile([]));
    } else {
      console.log(
        `fetch-saved-queries: preserving existing ${opts.generatedTypesPath} ` +
          `(not overwriting with an empty stub).`,
      );
    }
    if (!existsSync(opts.catalogPath)) {
      mkdirSync(dirname(opts.catalogPath), { recursive: true });
      writeIfChanged(opts.catalogPath, renderSavedQueryCatalog([]));
    }
    return;
  }

  console.log(
    `fetch-saved-queries: GET ${apiUrl}/api/internal/component-definitions-all/saved-query (tenant=${tenant})`,
  );

  const savedQueries = await fetchSavedQueries(apiUrl, tenant);

  const valid = savedQueries.filter(
    (q): q is SavedQuery =>
      !!q && typeof q.name === 'string' && q.name.length > 0,
  );

  // PHX-4513: A successful API call that yields ZERO usable saved queries is
  // almost always a transient backend/auth/tenant failure during bootstrap,
  // not a legitimate "this tenant has no saved queries" state. Writing the
  // empty registry here would blank SAVED_QUERY_APP_KEYS (and prune every
  // per-item module), silently breaking cross-app saved-query routing. Fail
  // loudly instead so the orchestrator / refetch surfaces it rather than
  // committing a corrupt registry.
  if (valid.length === 0) {
    throw new Error(
      `fetch-saved-queries: API returned 0 usable saved queries for tenant ` +
        `"${tenant}" — refusing to write an empty registry (would blank ` +
        `SAVED_QUERY_APP_KEYS and break cross-app routing). Treating an empty ` +
        `result as a fetch failure; re-run once the backend is reachable.`,
    );
  }

  const collisionWarning = formatCollisionWarning(
    'saved-query',
    detectNameCollisions(
      valid.map((q) => ({
        name: q.name,
        appKey:
          (q as { app_definition_key?: string; target_app_definition_key?: string })
            .app_definition_key ??
          (q as { target_app_definition_key?: string }).target_app_definition_key ??
          '',
      })),
    ),
  );
  if (collisionWarning) console.warn(collisionWarning);

  // appKey precedence must match renderSavedQueryFile (`app_definition_key ??
  // target_app_definition_key`).
  const sqAppKey = (q: SavedQuery) =>
    q.app_definition_key ?? q.target_app_definition_key ?? '';

  // Registry name per (app, name): bare for the FIRST occurrence of a name (in
  // API order — preserves today's first-wins so existing hook calls keep
  // resolving), `name__<appKeyDir>` for later cross-app duplicates (previously
  // dropped). Keyed by `${appKey}\u0000${name}`.
  const registryNameByKey = new Map<string, string>();
  const seenSqName = new Set<string>();
  for (const q of valid) {
    const k = `${sqAppKey(q)}\u0000${q.name}`;
    if (registryNameByKey.has(k)) continue;
    const reg = seenSqName.has(q.name)
      ? `${q.name}__${appKeyDir(sqAppKey(q))}`
      : q.name;
    seenSqName.add(q.name);
    registryNameByKey.set(k, reg);
  }

  // Dedupe by (appKey, name) — keep BOTH when the same name exists in 2+ apps
  // (previously the second was silently dropped + would overwrite the file).
  const byName = new Map<string, SavedQuery>();
  for (const q of valid) {
    const k = `${sqAppKey(q)}\u0000${q.name}`;
    if (!byName.has(k)) byName.set(k, q);
  }
  const sorted = [...byName.values()].sort(
    (a, b) =>
      a.name.localeCompare(b.name) || sqAppKey(a).localeCompare(sqAppKey(b)),
  );

  // Bare-name first-wins map for count-companion lookup (companions are
  // referenced by bare `<list>_count` name).
  const byBareName = new Map<string, SavedQuery>();
  for (const q of valid) {
    if (!byBareName.has(q.name)) byBareName.set(q.name, q);
  }

  mkdirSync(opts.outDir, { recursive: true });

  const generatedFiles = new Set<string>();
  // Discover available enumeration names from the sibling enumerations/
  // directory (written earlier by fetch-enumerations.ts). When empty,
  // `enumeration`-typed attributes fall back to `string`.
  const enumDir = opts.enumDir ?? resolve(opts.outDir, '../enumerations');
  const knownEnumerationNames = discoverEnumerationNames(enumDir);
  if (knownEnumerationNames.size > 0) {
    console.log(
      `fetch-saved-queries: resolved ${knownEnumerationNames.size} enumerations from ${enumDir}`,
    );
  }
  // Discover generated entity types (sibling entities/ dir) so object/array
  // attributes referencing `{appKey}.entity.<name>` resolve to the entity TS
  // type instead of `Record<string, unknown>`.
  const entityDir = opts.entityDir ?? resolve(opts.outDir, '../entities');
  const knownEntityNames = discoverEntityNames(entityDir);
  // Per-app folder each entity name lives in, so cross-entity imports point at
  // `entities/<appKeyDir>/<name>` rather than a bare (and wrong-depth) name.
  const entityDirsByName = discoverEntityDirsByName(entityDir);
  if (knownEntityNames.size > 0) {
    console.log(
      `fetch-saved-queries: resolved ${knownEntityNames.size} entities from ${entityDir}`,
    );
  }

  const rendered: RenderedSavedQuery[] = [];
  let written = 0;
  let unchanged = 0;
  for (const sq of sorted) {
    // Fold under the app-definition-key folder so same-named queries in
    // different apps never overwrite each other.
    const appDir = appKeyDir(sqAppKey(sq));
    const filePath = resolve(
      opts.outDir,
      appDir,
      `${savedQueryFileStem(sq.name)}.ts`,
    );
    generatedFiles.add(filePath);
    const r = renderSavedQueryFile(
      sq,
      knownEnumerationNames,
      knownEntityNames,
      entityDirsByName,
    );
    r.registryName =
      registryNameByKey.get(`${sqAppKey(sq)}\u0000${sq.name}`) ?? r.name;
    rendered.push(r);
    if (writeIfChanged(filePath, r.source)) written++;
    else unchanged++;
  }

  // After all queries are rendered, scan the set for `<list>` ↔ `<list>_count`
  // pairs so the catalog can emit a paired `useSavedQueryTable` invocation
  // with the count companion pre-wired.
  attachCountCompanions(
    rendered,
    byBareName,
    knownEnumerationNames,
    knownEntityNames,
    entityDirsByName,
  );

  // Barrel
  const barrelPath = resolve(opts.outDir, 'index.ts');
  generatedFiles.add(barrelPath);
  if (writeIfChanged(barrelPath, renderBarrelFile(rendered))) written++;
  else unchanged++;

  // Consolidated saved-queries.generated.ts used by the hooks.
  const generatedTypesContents = renderSavedQueriesGeneratedFile(rendered);
  if (writeIfChanged(opts.generatedTypesPath, generatedTypesContents)) {
    written++;
    console.log(
      `fetch-saved-queries: also wrote ${opts.generatedTypesPath}`,
    );
  } else {
    unchanged++;
  }

  // Agent-facing markdown catalog. Single greppable file pointing every
  // saved query to its hook + inputs + description. CLAUDE.md points
  // the agent here as the first stop for saved-query discovery.
  const catalogContents = renderSavedQueryCatalog(
    rendered.map(toCatalogEntry),
  );
  if (writeIfChanged(opts.catalogPath, catalogContents)) {
    written++;
    console.log(`fetch-saved-queries: also wrote ${opts.catalogPath}`);
  } else {
    unchanged++;
  }

  // Prune stale .ts files recursively (removes old flat-layout files + any
  // per-app file no longer produced).
  let removed = 0;
  for (const full of listSqTsFilesRecursive(opts.outDir)) {
    if (!generatedFiles.has(full)) {
      unlinkSync(full);
      removed++;
    }
  }

  console.log(
    `fetch-saved-queries: ${sorted.length} saved queries → ${opts.outDir} ` +
      `(${written} written, ${unchanged} unchanged, ${removed} removed)`,
  );
}

// CLI entry
if (
  typeof process !== 'undefined' &&
  process.argv[1] &&
  process.argv[1] === fileURLToPath(import.meta.url)
) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const outDir = process.env.FETCH_SAVED_QUERIES_OUT_DIR
    ? resolve(process.env.FETCH_SAVED_QUERIES_OUT_DIR)
    : resolve(root, 'src/types/saved-queries');
  const generatedTypesPath = resolve(outDir, '../saved-queries.generated.ts');
  const catalogPath = resolve(outDir, '../catalogs/saved-queries.catalog.md');
  run({
    envPath: resolve(root, '.env'),
    outDir,
    generatedTypesPath,
    catalogPath,
  }).catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
