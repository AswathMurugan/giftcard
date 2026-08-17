/**
 * Hook for binding a saved query to a `DataTable` in one call.
 *
 * Two modes, chosen automatically by whether you provide `countQuery`:
 *
 * 1. **Server-side pagination** (`countQuery` provided)
 *    Internally manages `ServerParams` state, calls `useSavedQueryList`
 *    for the current page (page/pageSize/sort/filter pass through), and
 *    calls `useSavedQuerySingle(countQuery)` for the real total. AG-Grid
 *    renders "Page N of M" via the returned `count`.
 *
 * 2. **Fetch-all** (no `countQuery`)
 *    Issues a single request for up to `fetchAllPageSize` rows (100 by
 *    default — kept small for performance) and lets AG-Grid run in
 *    client-side mode against that set. For anything larger than 100 rows
 *    ship a `<name>_count` companion so the table paginates server-side
 *    (one page at a time) instead of pulling everything at once.
 *
 * The agent never has to think about which mode applies: the catalog
 * (`src/types/catalogs/saved-queries.catalog.md`) emits the right call already.
 *
 * @example Server-side (count companion found in catalog)
 *   // Copy the countQuery/countSelector VERBATIM from the matched catalog
 *   // `Hook:` line — the selector is per-query (`r?.count`, `r?.ID`, …) and
 *   // will NOT always be `.ID`. Do not guess or reuse this example's shape.
 *   const tableProps = useSavedQueryTable('<list_query>', {
 *     countQuery: '<list_query>_count',
 *     countSelector: (r) => r?.count, // ← replace with YOUR catalog selector
 *   });
 *   <DataTable {...tableProps} columnDefs={columnDefs} />
 *
 * @example Fetch-all (no count companion)
 *   const tableProps = useSavedQueryTable('get_top_positions');
 *   <DataTable {...tableProps} columnDefs={columnDefs} />
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SortModelItem, FilterModel } from 'ag-grid-community';
import type { ServerParams } from '@/components/ui/data-table';
import { escapeCelString } from '@/lib/cel';
import { logger } from '@/utils/logger';
import { useSavedQueryList } from './useSavedQueryList';
import { useSavedQuerySingle } from './useSavedQuerySingle';
import {
  SAVED_QUERY_APP_KEYS,
  type SavedQueryName,
  type SavedQueryInputOf,
  type SavedQueryRowOf,
} from '@/types/saved-queries.generated';

/**
 * Default cap for the fetch-all path. Kept SMALL (100) to avoid pulling a
 * large dataset in one request — that hurts performance and can exceed the
 * data-manager's per-request row limit. A table that needs more than this
 * MUST ship a `<name>_count` companion so it paginates server-side instead.
 *
 * Override per call via `fetchAllPageSize` only when the user explicitly
 * accepts a larger single fetch for a known-small-but->100 reference table.
 */
export const DEFAULT_FETCH_ALL_PAGE_SIZE = 100;

/** Default initial page size for the server-side path. */
export const DEFAULT_INITIAL_PAGE_SIZE = 25;

// ── Pure helpers (exported for unit tests) ───────────────────────────────

/**
 * A colId from AG-Grid is usable as a backend field name iff it matches
 * our identifier regex (letter/underscore lead, then identifier
 * characters and dots for nested paths like `roles.roles.name`).
 *
 * AG-Grid auto-assigns colIds based on **column index** to columns
 * declared without an explicit `field` or `colId` — first column gets
 * `"0"`, second `"1"`, etc. Those numeric strings fail this test and
 * are dropped by both the filter and sort builders, so we never put
 * `containsIgnoreCase(0, 'foo')` or a sort on `0` on the wire when a page author
 * forgot to attach a stable identity to a column (e.g. used a
 * `valueGetter`-only column for a derived display value).
 *
 * Exported for unit tests; not part of the hook's public API.
 */
export function isUsableFieldId(key: string | undefined | null): boolean {
  if (typeof key !== 'string' || key.length === 0) return false;
  return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(key);
}

/**
 * Convert AG-Grid's sort model to the saved-query sort expression.
 * Empty model → `undefined` (no sort sent).
 *
 * Format (parsed into the body `sort` array for dynamic queries, or sent
 * as the legacy `_sort` URL param for non-dynamic ones):
 *   - Ascending: bare `field` (the `+` prefix is optional and omitted)
 *   - Descending: `-field`
 *   - Multiple columns: comma-separated, e.g. `status,-balance`
 *
 * Entries whose `colId` isn't a usable backend field name (see
 * `isUsableFieldId`) are silently dropped — AG-Grid's auto-numeric
 * colIds from field-less columns would otherwise produce a junk
 * `sort` of `0` on the wire.
 */
export function buildSavedQuerySort(
  sortModel: SortModelItem[] | undefined,
): string | undefined {
  if (!sortModel || sortModel.length === 0) return undefined;
  const parts = sortModel
    .filter((s) => isUsableFieldId(s.colId))
    .map((s) => (s.sort === 'desc' ? `-${s.colId}` : s.colId));
  if (parts.length === 0) return undefined;
  return parts.join(',');
}

// CEL string escaping lives in the shared module so page code and this hook
// use the SAME rule — see @/lib/cel (imported at the top of this file).

/**
 * Per-column AG-Grid filter shapes we understand. `filterType` and `type`
 * mirror AG-Grid's `ProvidedFilterModel` discriminator. Anything not in
 * here is silently skipped (kept that way to avoid sending garbage CEL
 * when AG-Grid grows new filter shapes).
 */
type AGFilterModel = {
  filterType?: string;
  type?: string;
  filter?: unknown;
  filterTo?: unknown;
  values?: unknown[];
};

/** Render the CEL for a single column's AG-Grid filter shape. */
function buildSingleColumnCEL(
  field: string,
  model: AGFilterModel,
): string | undefined {
  const filterType = (model.filterType ?? 'text').toLowerCase();
  const op = (model.type ?? '').toLowerCase();

  if (filterType === 'text') {
    const raw =
      typeof model.filter === 'string' ? model.filter.trim() : '';
    // LITERAL-semantics functions, never explicit ILIKE patterns: the
    // data-manager escapes LIKE metacharacters (%/_/~) inside
    // contains/startsWith/endsWith, so a user typing `%` matches a
    // literal percent instead of everything. `ilike()` is reserved for
    // intentional wildcard patterns and is NOT used for user input.
    // Case-insensitive prefix/suffix = startsWith/endsWith over
    // lower(field) with a lowercased value (the server's own structured
    // caseInsensitive form).
    const escaped = escapeCelString(raw);
    const escapedLower = escapeCelString(raw.toLowerCase());
    switch (op) {
      case '':
      case 'contains':
        if (!raw) return undefined;
        return `containsIgnoreCase(${field}, '${escaped}')`;
      case 'notcontains':
        if (!raw) return undefined;
        return `!containsIgnoreCase(${field}, '${escaped}')`;
      case 'equals':
        if (!raw) return undefined;
        return `${field} == '${escaped}'`;
      case 'notequal':
        if (!raw) return undefined;
        return `${field} != '${escaped}'`;
      case 'startswith':
        if (!raw) return undefined;
        return `startsWith(lower(${field}), '${escapedLower}')`;
      case 'endswith':
        if (!raw) return undefined;
        return `endsWith(lower(${field}), '${escapedLower}')`;
      case 'blank':
        return `(${field} == null || ${field} == '')`;
      case 'notblank':
        return `(${field} != null && ${field} != '')`;
      default:
        return undefined;
    }
  }

  if (filterType === 'number') {
    const n =
      typeof model.filter === 'number'
        ? model.filter
        : typeof model.filter === 'string' && model.filter !== ''
          ? Number(model.filter)
          : undefined;
    const n2 =
      typeof model.filterTo === 'number'
        ? model.filterTo
        : typeof model.filterTo === 'string' && model.filterTo !== ''
          ? Number(model.filterTo)
          : undefined;
    switch (op) {
      case 'equals':
        return Number.isFinite(n) ? `${field} == ${n}` : undefined;
      case 'notequal':
        return Number.isFinite(n) ? `${field} != ${n}` : undefined;
      case 'greaterthan':
        return Number.isFinite(n) ? `${field} > ${n}` : undefined;
      case 'greaterthanorequal':
        return Number.isFinite(n) ? `${field} >= ${n}` : undefined;
      case 'lessthan':
        return Number.isFinite(n) ? `${field} < ${n}` : undefined;
      case 'lessthanorequal':
        return Number.isFinite(n) ? `${field} <= ${n}` : undefined;
      case 'inrange':
        if (!Number.isFinite(n) || !Number.isFinite(n2)) return undefined;
        return `(${field} >= ${n} && ${field} <= ${n2})`;
      case 'blank':
        return `${field} == null`;
      case 'notblank':
        return `${field} != null`;
      default:
        return undefined;
    }
  }

  if (filterType === 'date') {
    // AG-Grid date filters use `dateFrom` / `dateTo`; older versions use
    // `filter` / `filterTo` strings. We accept both via duck-typing on the
    // `AGFilterModel` shape.
    const dateModel = model as AGFilterModel & {
      dateFrom?: string | null;
      dateTo?: string | null;
    };
    const d1 =
      (typeof dateModel.dateFrom === 'string' && dateModel.dateFrom) ||
      (typeof model.filter === 'string' && model.filter) ||
      '';
    const d2 =
      (typeof dateModel.dateTo === 'string' && dateModel.dateTo) ||
      (typeof model.filterTo === 'string' && model.filterTo) ||
      '';
    const v1 = `'${escapeCelString(d1)}'`;
    const v2 = `'${escapeCelString(d2)}'`;
    switch (op) {
      case 'equals':
        return d1 ? `${field} == ${v1}` : undefined;
      case 'notequal':
        return d1 ? `${field} != ${v1}` : undefined;
      case 'greaterthan':
        return d1 ? `${field} > ${v1}` : undefined;
      case 'lessthan':
        return d1 ? `${field} < ${v1}` : undefined;
      case 'inrange':
        if (!d1 || !d2) return undefined;
        return `(${field} >= ${v1} && ${field} <= ${v2})`;
      case 'blank':
        return `${field} == null`;
      case 'notblank':
        return `${field} != null`;
      default:
        return undefined;
    }
  }

  if (filterType === 'set') {
    const values = Array.isArray(model.values) ? model.values : undefined;
    if (!values || values.length === 0) return undefined;
    // Set filter uses `includes(field, value)`, OR-joined when multiple
    // values are selected. Matches the data-manager team's confirmed
    // CEL contract (`includes(roles.roles.name, 'Advisor')` example).
    const clauses = values.map((v) => {
      const lit =
        typeof v === 'number'
          ? String(v)
          : `'${escapeCelString(String(v))}'`;
      return `includes(${field}, ${lit})`;
    });
    if (clauses.length === 1) return clauses[0];
    return `(${clauses.join(' || ')})`;
  }

  return undefined;
}

/**
 * Convert AG-Grid's filter model to a CEL string for the saved-query
 * filter binding (body `filterExpression` for dynamic queries, legacy
 * `_filter` URL param for non-dynamic ones).
 *
 * Supported per-column filter shapes:
 *
 * | filterType | types                                                        |
 * |------------|--------------------------------------------------------------|
 * | text       | contains, notContains, equals, notEqual, startsWith,         |
 * |            | endsWith, blank, notBlank                                    |
 * | number     | equals, notEqual, greaterThan, greaterThanOrEqual,           |
 * |            | lessThan, lessThanOrEqual, inRange, blank, notBlank          |
 * | date       | equals, notEqual, greaterThan, lessThan, inRange, blank,     |
 * |            | notBlank (values as ISO strings)                             |
 * | set        | multi-select (emits `field in [...]`)                        |
 *
 * Anything not listed is silently skipped — better no clause than a wrong
 * one that may 400 the saved-query backend.
 */
export function buildFilterCEL(
  filterModel: FilterModel | null | undefined,
): string | undefined {
  if (!filterModel) return undefined;
  const parts: string[] = [];
  for (const [field, modelRaw] of Object.entries(filterModel)) {
    // Reject AG-Grid's auto-numeric colIds ("0", "1", …) so a
    // field-less column doesn't produce `containsIgnoreCase(0, 'foo')` —
    // data-manager parses that as a number literal, not a column
    // reference, and the query returns no rows.
    if (!isUsableFieldId(field)) continue;
    const model = modelRaw as AGFilterModel;
    const clause = buildSingleColumnCEL(field, model);
    if (clause) parts.push(clause);
  }
  return parts.length ? parts.join(' && ') : undefined;
}

/**
 * Build the CEL fragment that implements the top-toolbar global search.
 *
 * Uses only `searchColumns[0]` — the saved-query backend's search model
 * is single-field, and the catalog now emits at most one entry. Extra
 * entries are accepted (in case a caller hand-overrides) but ignored
 * for CEL construction.
 *
 * Returns `undefined` when `value` is empty OR `searchColumns` has no
 * entries — i.e. the search input is inert until the caller opts in by
 * naming the entity field to match against.
 *
 * Emits `containsIgnoreCase(col, 'v')` — LITERAL substring semantics.
 * The data-manager escapes LIKE metacharacters inside contains-family
 * functions, so a user typing `%`/`_` searches for those characters
 * instead of wildcarding. Never build explicit `ilike()` patterns from
 * user input.
 *
 * @example
 *   buildSearchCEL('willi', ['client_name'])
 *     → "containsIgnoreCase(client_name, 'willi')"
 */
export function buildSearchCEL(
  value: string | undefined,
  searchColumns: readonly string[] | undefined,
): string | undefined {
  if (!value || !searchColumns || searchColumns.length === 0) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const col = searchColumns[0];
  if (!col) return undefined;
  return `containsIgnoreCase(${col}, '${escapeCelString(trimmed)}')`;
}

/**
 * Combine the global-search CEL and the filterModel CEL into a single
 * filter string. `undefined` when both are empty.
 */
export function combineFilterCEL(
  ...parts: Array<string | undefined>
): string | undefined {
  const present = parts.filter((p): p is string => !!p && p.length > 0);
  if (present.length === 0) return undefined;
  if (present.length === 1) return present[0];
  return present.join(' && ');
}

/**
 * Determine which required input names are *absent* from the caller's
 * `input` bag. A required input is "missing" when it is not in the bag
 * at all OR its value is `undefined` / `null`.
 *
 * **Empty string is treated as an intentional explicit value** — it
 * passes the check. This matches the sentinel-based Select pattern
 * documented in `CLAUDE.md` (where `__ALL__` is translated to `''` to
 * mean "no filter"). `buildSavedQueryRequest` strips empty-string values
 * from the URL, so an empty value reaches the server as a missing
 * URL param rather than `?type=`.
 *
 * `useSavedQueryTable` uses this to gate the network request — when the
 * result is non-empty the hook returns an empty result set with a
 * `gatedMessage` listing the missing inputs.
 *
 * @example
 *   findMissingRequiredInputs(
 *     ['isActive', 'type'],
 *     { isActive: 'true' },                     // type absent
 *   )
 *     → ['type']
 *
 *   findMissingRequiredInputs(
 *     ['isActive', 'type'],
 *     { isActive: 'true', type: '' },           // type intentionally empty
 *   )
 *     → []
 */
export function findMissingRequiredInputs(
  required: readonly string[] | undefined,
  input: Record<string, unknown> | null | undefined,
): string[] {
  if (!required || required.length === 0) return [];
  const out: string[] = [];
  for (const name of required) {
    const v = input ? input[name] : undefined;
    if (v === undefined || v === null) out.push(name);
  }
  return out;
}

/**
 * Resolve the table's error state from the underlying list fetch.
 *
 * When the LIST query fails, the table must NOT keep rendering: previously
 * the count companion (a separate query) could still return a non-zero total
 * while the list returned `[]`, so AG-Grid padded the grid with that many
 * placeholder rows (every cell `—`). On a list error we force `count: 0`
 * (kills the phantom rows) and surface a message so the user sees the failure
 * instead of a table of dashes.
 *
 * A count-companion error alone is NOT treated as a table error — the rows are
 * fine; only the total is unknown (handled separately by the footer fallback).
 *
 * Pure + exported for unit tests.
 */
export interface TableErrorState {
  isError: boolean;
  errorMessage: string | undefined;
}

export function resolveTableError(listError: unknown): TableErrorState {
  if (listError != null) {
    return {
      isError: true,
      errorMessage: "Couldn't load this list. Please try again.",
    };
  }
  return { isError: false, errorMessage: undefined };
}

/** Build the user-facing message shown when the fetch is gated. */
export function buildGatedMessage(missing: readonly string[]): string {
  if (missing.length === 0) return '';
  if (missing.length === 1) {
    return `Provide a value for \`${missing[0]}\` to load this list.`;
  }
  const last = missing[missing.length - 1];
  const head = missing.slice(0, -1).map((n) => `\`${n}\``).join(', ');
  return `Provide values for ${head} and \`${last}\` to load this list.`;
}

/**
 * Apply a `countSelector` to the count companion's result, returning
 * `undefined` for null/missing data. Kept as a pure function so the
 * selector contract can be tested without React.
 */
export function applyCountSelector<TResult>(
  result: TResult | null | undefined,
  selector:
    | ((data: TResult | null) => number | undefined)
    | undefined,
): number | undefined {
  if (!selector) return undefined;
  if (result == null) return selector(null);
  const value = selector(result);
  if (typeof value !== 'number' || Number.isNaN(value)) return undefined;
  return value;
}

/**
 * Detect a likely-wrong `countSelector`: the count companion finished
 * loading and returned a non-empty object, yet the selector pulled out no
 * number. That's the silent-fallback bug — the footer drops back to
 * `rowData.length` (a per-page count) instead of the real total. Almost
 * always means the selector path doesn't match the runtime response shape
 * (e.g. `r?.client_aggregate?.ID` against a `{ count: 563 }` response).
 *
 * Pure + exported so it can be unit-tested without React.
 */
export function isCountSelectorLikelyBroken(args: {
  isServerSide: boolean;
  countIsLoading: boolean;
  countResult: unknown;
  resolvedCount: number | undefined;
}): boolean {
  const { isServerSide, countIsLoading, countResult, resolvedCount } = args;
  if (!isServerSide) return false;
  if (countIsLoading) return false; // still in flight — undefined is expected
  if (resolvedCount !== undefined) return false; // selector worked
  // The companion returned a usable object but the selector found nothing.
  return (
    countResult != null &&
    typeof countResult === 'object' &&
    Object.keys(countResult as Record<string, unknown>).length > 0
  );
}

// ── Hook API ─────────────────────────────────────────────────────────────

export interface UseSavedQueryTableOptionsBase<N extends SavedQueryName> {
  /** Saved-query input parameters (typed via the registry). */
  input?: SavedQueryInputOf<N>;
  /** Cross-app override; defaults to the appKey baked into the saved-query. */
  appDefinitionKey?: string;
  /** Disable both fetches (e.g. while waiting for a route param). */
  enabled?: boolean;
  /**
   * Whether to auto-apply the page's org scope (`_org`) from OrgContext to
   * BOTH the list and count queries. Defaults to `true`. Set `false` to
   * exclude this table (e.g. its entity has no `org` link). No-op outside
   * `<OrgContextProvider>`.
   */
  orgScoped?: boolean;
  /**
   * Entity field name (single) that the DataTable's top-toolbar global
   * search should filter against. Empty / omitted → search button is
   * **hidden** in the toolbar.
   *
   * The platform's saved-query search model is single-field; only
   * `searchColumns[0]` is used. Extra entries are accepted but ignored.
   * The catalog auto-fills this from a heuristic on the row schema.
   *
   * The resulting CEL is `&&`-merged with any per-column filters from
   * the AG-Grid filter popup, and sent through the saved query's
   * filter binding (body `filterExpression` for dynamic queries).
   */
  searchColumns?: readonly string[];
  /**
   * Names of inputs the saved query marks `required: true`. When any of
   * these is missing/empty in `input`, the hook does NOT fire the list
   * fetch and the DataTable renders a `Provide: …` empty state with the
   * missing names. Auto-filled from the catalog.
   */
  requiredInputs?: readonly string[];
}

export interface UseSavedQueryTableServerOptions<
  N extends SavedQueryName,
  C extends SavedQueryName,
> extends UseSavedQueryTableOptionsBase<N> {
  /** Single-output count companion saved query (see catalog). */
  countQuery: C;
  /**
   * Pull a number out of the count companion's result. The catalog
   * pre-fills this with the per-query matched path (e.g. `r => r?.count`).
   * Copy it verbatim from the catalog `Hook:` line — it is NOT always `.ID`.
   */
  countSelector: (data: SavedQueryRowOf<C> | null) => number | undefined;
  /** Initial page size; defaults to 25. */
  initialPageSize?: number;
}

export interface UseSavedQueryTableFetchAllOptions<N extends SavedQueryName>
  extends UseSavedQueryTableOptionsBase<N> {
  countQuery?: undefined;
  countSelector?: undefined;
  /**
   * Page size used for the single "fetch everything" request. Defaults to
   * 100 (kept small for performance). Raise it ONLY when the user explicitly
   * accepts a larger single fetch for a known reference table that can't ship
   * a `<name>_count` companion; otherwise prefer server-side pagination via a
   * count companion.
   */
  fetchAllPageSize?: number;
}

export type UseSavedQueryTableOptions<
  N extends SavedQueryName,
  C extends SavedQueryName | undefined,
> = C extends SavedQueryName
  ? UseSavedQueryTableServerOptions<N, C>
  : UseSavedQueryTableFetchAllOptions<N>;

export interface UseSavedQueryTableResult<N extends SavedQueryName> {
  /** Rows for the DataTable. Spread or assign to `<DataTable rowData={…}>`. */
  rowData: SavedQueryRowOf<N>[];
  /**
   * Total row count when a count companion is wired, the fetched length
   * in fetch-all mode, or `undefined` while the count fetch is in flight.
   */
  count: number | undefined;
  /** Either the list or the count is still loading. */
  isLoading: boolean;
  /**
   * `setParams`-style callback for the DataTable in server-side mode.
   * `undefined` in fetch-all mode so the DataTable picks client-side
   * rendering automatically.
   */
  onParamsChange: ((p: ServerParams) => void) | undefined;
  /**
   * `false` when the saved query has no searchable column wired (the
   * catalog reported `searchColumns: []` or the caller didn't pass one).
   * DataTable consumes this to hide the toolbar search button.
   */
  searchEnabled: boolean;
  /**
   * Message shown by the DataTable when the network fetch is held back
   * because required inputs are missing. `undefined` when the fetch is
   * active. DataTable spreads this onto its `gatedMessage` prop.
   */
  gatedMessage: string | undefined;
  /**
   * Message shown by the DataTable when the LIST fetch FAILED. `undefined`
   * when there's no error. DataTable spreads this onto its `errorMessage`
   * prop and renders it instead of a grid full of `—` placeholder rows.
   */
  errorMessage: string | undefined;
}

/**
 * Bundle saved-query list + count + DataTable wiring in one call.
 */
export function useSavedQueryTable<
  N extends SavedQueryName,
  C extends SavedQueryName | undefined = undefined,
>(
  name: N,
  options?: UseSavedQueryTableOptions<N, C>,
): UseSavedQueryTableResult<N>;

export function useSavedQueryTable<N extends SavedQueryName>(
  name: N,
  options:
    | UseSavedQueryTableFetchAllOptions<N>
    | UseSavedQueryTableServerOptions<N, SavedQueryName> = {},
): UseSavedQueryTableResult<N> {
  const enabled = options.enabled ?? true;
  // Default to the list query's own app key from the codegen registry so a
  // cross-app saved query targets the correct app; allow an explicit override.
  const appDefinitionKey =
    options.appDefinitionKey ?? SAVED_QUERY_APP_KEYS[name];
  const input = options.input;

  const isServerSide = 'countQuery' in options && !!options.countQuery;

  // ── Required-input gating ───────────────────────────────────────────
  // When the saved query declares required inputs, hold every fetch
  // (list + count) until the caller's `input` bag contains a non-empty
  // value for each one. DataTable renders `gatedMessage` in the body of
  // the grid so the user sees "Provide: …" instead of an empty table.
  const requiredInputs = options.requiredInputs;
  const missingRequired = useMemo(
    () =>
      findMissingRequiredInputs(
        requiredInputs,
        (input as Record<string, unknown> | null | undefined) ?? null,
      ),
    [requiredInputs, input],
  );
  const isGated = missingRequired.length > 0;
  const gatedMessage = isGated ? buildGatedMessage(missingRequired) : undefined;

  // ── Server-side path ──────────────────────────────────────────────────
  // Owns ServerParams state; passes page/pageSize/sort/filter into the
  // list hook; resolves count via useSavedQuerySingle.
  const initialPageSize =
    (isServerSide
      ? (options as UseSavedQueryTableServerOptions<N, SavedQueryName>)
          .initialPageSize
      : undefined) ?? DEFAULT_INITIAL_PAGE_SIZE;

  const [params, setParams] = useState<ServerParams>(() => ({
    page: 0,
    pageSize: initialPageSize,
    sortModel: [],
    filterModel: {},
  }));

  const handleParamsChange = useCallback(
    (p: ServerParams) => {
      setParams((prev) => {
        const sortChanged =
          JSON.stringify(prev.sortModel) !== JSON.stringify(p.sortModel);
        const filterChanged =
          JSON.stringify(prev.filterModel) !== JSON.stringify(p.filterModel);
        const searchChanged = (prev.search ?? '') !== (p.search ?? '');
        if (sortChanged || filterChanged || searchChanged) {
          // Reset to first page on sort / filter / search change so the
          // user lands on the new top of the dataset rather than an empty
          // later page.
          return { ...p, page: 0 };
        }
        return p;
      });
    },
    [],
  );

  // List fetch — branches between server-side (uses ServerParams) and
  // fetch-all (single big page, no state).
  const fetchAllPageSize = isServerSide
    ? undefined
    : (options as UseSavedQueryTableFetchAllOptions<N>).fetchAllPageSize ??
      DEFAULT_FETCH_ALL_PAGE_SIZE;

  // Combine the global-search CEL (top-toolbar input) with the per-column
  // filter CEL (AG-Grid filter popups). Either, neither, or both may be
  // present; `combineFilterCEL` `&&`-joins what's there.
  const searchColumns = options.searchColumns;
  const combinedFilter = isServerSide
    ? combineFilterCEL(
        buildSearchCEL(params.search, searchColumns),
        buildFilterCEL(params.filterModel),
      )
    : undefined;

  const listResult = useSavedQueryList(name, {
    input,
    page: isServerSide ? params.page : 0,
    pageSize: isServerSide ? params.pageSize : fetchAllPageSize,
    sort: isServerSide ? buildSavedQuerySort(params.sortModel) : undefined,
    filter: combinedFilter,
    appDefinitionKey,
    orgScoped: options.orgScoped,
    enabled: enabled && !isGated,
  });

  const rowData = listResult.data;

  // ── Count companion fetch (server-side mode only) ────────────────────
  // useSavedQuerySingle is always called to keep hook order stable across
  // mode switches. When countQuery isn't provided we point it at the list
  // name with `enabled=false` so React Query treats it as a no-op.
  const countQueryName = isServerSide
    ? (options as UseSavedQueryTableServerOptions<N, SavedQueryName>).countQuery
    : (name as SavedQueryName);
  // Mirror the list's input scope and combined filter into the count
  // fetch so the count reflects the same dataset AG-Grid is paginating
  // through. React Query rebuilds the queryKey when `filter` or `input`
  // changes, so a column filter or toolbar-search update triggers a
  // count refetch automatically. Without this, the count stays at the
  // unfiltered total and AG-Grid pads the grid with placeholder rows
  // for the missing entries.
  //
  // The `input` cast is necessary because `useSavedQuerySingle<C>`
  // types it as `SavedQueryInputOf<C>` (the count companion's input
  // shape) while we're handing it the list's `SavedQueryInputOf<N>`.
  // By convention the count companion accepts the same inputs as the
  // list (empty in the common case, identical in the parameterised
  // case); if a tenant ever ships a count companion with divergent
  // inputs, harmless URL params land on the wire — no functional break.
  const countResult = useSavedQuerySingle(countQueryName as SavedQueryName, {
    input: isServerSide ? (input as never) : undefined,
    filter: combinedFilter,
    // Only forward an EXPLICIT caller override; otherwise let
    // useSavedQuerySingle auto-resolve the count companion's own app key
    // from the registry (it's usually the same app as the list, but the
    // registry is the source of truth either way).
    appDefinitionKey: options.appDefinitionKey,
    // Count must use the SAME org scope as the list, or the total won't
    // match the paginated rows.
    orgScoped: options.orgScoped,
    enabled: enabled && isServerSide && !isGated,
  });

  let count: number | undefined;
  if (isServerSide) {
    const selector = (
      options as UseSavedQueryTableServerOptions<N, SavedQueryName>
    ).countSelector;
    count = applyCountSelector(countResult.data, selector);
  } else {
    // Fetch-all mode: total IS what we fetched. DataTable's footer reads
    // this for "1 to N of N" rendering.
    count = rowData.length;
  }

  // DEV tripwire: a wrong `countSelector` fails silently — the footer falls
  // back to the per-page `rowData.length` and shows a misleading total. Warn
  // (once per broken state) so the bug surfaces during development instead of
  // shipping. No-op in production builds and when the selector is fine.
  const warnedBrokenRef = useRef(false);
  const countBroken = isCountSelectorLikelyBroken({
    isServerSide,
    countIsLoading: countResult.isLoading,
    countResult: countResult.data,
    resolvedCount: count,
  });
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (!countBroken) {
      warnedBrokenRef.current = false;
      return;
    }
    if (warnedBrokenRef.current) return;
    warnedBrokenRef.current = true;
    logger.warn('saved-query:table:count-selector-broken', {
      listQuery: name,
      countQuery: countQueryName,
      hint:
        `countSelector returned no number though "${countQueryName}" returned ` +
        `data. The selector path likely doesn't match the response shape — ` +
        `copy the exact countSelector from the catalog Hook line. The footer ` +
        `is falling back to the per-page row count.`,
      countResultKeys:
        countResult.data && typeof countResult.data === 'object'
          ? Object.keys(countResult.data as Record<string, unknown>)
          : [],
    });
  }, [countBroken, name, countQueryName, countResult.data]);

  // Surface search visibility so a `<DataTable {...tableProps}>` spread
  // automatically hides the toolbar search button when nothing is wired.
  // All columns are filterable through the filter CEL; the hook does not
  // restrict per-column filter UI.
  const searchEnabled = !!(searchColumns && searchColumns.length > 0);

  // A failed LIST fetch forces an error state: count 0 (so AG-Grid doesn't
  // pad the grid with placeholder `—` rows for a phantom total) + a message.
  const tableError = resolveTableError(isGated ? null : listResult.error);

  return {
    rowData: isGated || tableError.isError ? [] : rowData,
    count: isGated ? undefined : tableError.isError ? 0 : count,
    isLoading:
      !isGated &&
      (listResult.isLoading || (isServerSide && countResult.isLoading)),
    onParamsChange: isServerSide ? handleParamsChange : undefined,
    searchEnabled,
    gatedMessage,
    errorMessage: tableError.errorMessage,
  };
}
