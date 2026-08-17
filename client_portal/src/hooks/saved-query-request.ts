/**
 * Pure builders for saved-query HTTP requests.
 *
 * Both `useSavedQueryList` and `useSavedQuerySingle` (and the codegen-emitted
 * `executeXxx` wrappers) share this code so the URL/body contract stays in
 * one place. Extracting these as plain functions also lets us unit-test them
 * in the node vitest environment without rendering React.
 *
 * Contract (validated against the data-manager handler at
 * handler/query_handler.go:392-491 and service/saved_query_service.go):
 *   - URL: `/saved-queries/{name}/execute` for both variants.
 *   - Named inputs go through as `?key=value` (URL-encoded). Reserved keys
 *     supplied via `input` are dropped — they MUST come through `options.*`.
 *   - `dynamic` queries (`queryType: 'dynamic'`): pagination, sort, and
 *     filter travel in the JSON BODY as an SSRM list request —
 *     `{ page: {mode:'offset', position, size}, sort: [{field, dir}],
 *     filterExpression: '<CEL>' }`. The server only treats the body as a
 *     list request when `page` is present, so `page` is always included
 *     whenever any list control is set. `position` is the ROW OFFSET
 *     (page × size), not a page index.
 *   - Non-dynamic queries (`sql` / `multi_query` / `common_table_expression`
 *     / unknown): the server rejects SSRM bodies for these, so the legacy
 *     `_page`/`_size`/`_sort`/`_filter` URL params are still used.
 *   - `_org` has NO body equivalent — it stays a URL param for all types
 *     (the data-manager AND-merges it on top of any body filter).
 */

/** URL params that we always own — never accept them from `input`. */
export const RESERVED_SAVED_QUERY_PARAMS = new Set([
  '_page',
  '_size',
  '_sort',
  '_filter',
  '_org',
]);

/**
 * Default page size applied by the data-manager when `_size` is absent on
 * a saved-query execute request. Mirrors `DefaultQueryLimit` in
 * `data-manager/service/saved_query_service.go:344`. Used to compute the
 * `hasMore` heuristic when the caller didn't set `pageSize` explicitly.
 */
export const DEFAULT_SAVED_QUERY_PAGE_SIZE = 50;

/** Common options accepted by both hooks (and the codegen wrappers). */
export interface BuildSavedQueryRequestOptions {
  /** Named saved-query parameters (becomes URL query string). */
  input?: Record<string, unknown> | null;
  /**
   * Zero-based page index. List only. Dynamic queries: converted to the
   * body `page.position` row offset (page × pageSize). Non-dynamic:
   * legacy `_page` URL param.
   */
  page?: number;
  /**
   * Page size. List only. Dynamic queries: body `page.size`. Non-dynamic:
   * legacy `_size` URL param.
   */
  pageSize?: number;
  /**
   * Sort expression: comma-separated fields, `-` prefix for descending
   * (e.g. `status,-balance`; `desc(field)`/`asc(field)` also accepted).
   * Dynamic queries: body `sort: [{field, dir}]`. Non-dynamic: legacy
   * `_sort` URL param.
   */
  sort?: string;
  /**
   * CEL filter expression. Dynamic queries: body `filterExpression`.
   * Non-dynamic: legacy `_filter` URL param.
   */
  filter?: string;
  /**
   * Maps to `_org` URL param — a CEL expression that scopes the query to
   * the selected organization(s)/advisor(s). Built by `buildOrgScopeFilter`
   * from the page's OrgContext. `null`/empty → no org scoping applied.
   * `_org` has no body equivalent; it is a URL param for ALL query types.
   */
  orgFilter?: string | null;
  /**
   * The saved query's type from the codegen registry
   * (`SAVED_QUERY_TYPES[name]`): `dynamic` | `sql` | `multi_query` |
   * `common_table_expression` | `patch`. Only `'dynamic'` supports the
   * body-based list request — anything else (including `undefined` for
   * queries not in the registry, e.g. platform queries) falls back to the
   * legacy URL params, which the server still accepts.
   */
  queryType?: string;
}

/** One body-sort rule in the data-manager's SSRM list-request shape. */
export interface SavedQueryBodySort {
  field: string;
  dir: 'ASC' | 'DESC';
}

/**
 * Parse the starter's sort-expression string into the body `sort` array.
 *
 * Accepted forms (comma-separated, whitespace-tolerant):
 *   - `field`            → ascending
 *   - `+field` / `-field`→ ascending / descending
 *   - `asc(field)` / `desc(field)` → legacy `_sort` fragments, still parsed
 *     so older call sites keep working.
 * Unparseable/empty segments are dropped. Returns `[]` for no sort.
 */
export function parseSortExpression(
  sort: string | undefined | null,
): SavedQueryBodySort[] {
  if (!sort || typeof sort !== 'string') return [];
  const rules: SavedQueryBodySort[] = [];
  for (const rawSegment of sort.split(',')) {
    const segment = rawSegment.trim();
    if (!segment) continue;
    const fnMatch = /^(asc|desc)\((.*)\)$/i.exec(segment);
    if (fnMatch) {
      const field = fnMatch[2].trim();
      if (!field) continue;
      rules.push({
        field,
        dir: fnMatch[1].toLowerCase() === 'desc' ? 'DESC' : 'ASC',
      });
      continue;
    }
    if (segment.startsWith('-')) {
      const field = segment.slice(1).trim();
      if (!field) continue;
      rules.push({ field, dir: 'DESC' });
      continue;
    }
    const field = segment.startsWith('+') ? segment.slice(1).trim() : segment;
    if (!field) continue;
    rules.push({ field, dir: 'ASC' });
  }
  return rules;
}

export interface BuiltSavedQueryRequest {
  url: string;
  body: Record<string, unknown>;
}

/**
 * Build the URL (with query string) and JSON body for a saved-query call.
 *
 * Both variants hit `/saved-queries/{name}/execute`. The `/execute/single`
 * route is not reliably available for read queries (it 404s for some apps),
 * so single-output reads call `/execute` and unwrap the first row via
 * `normaliseSavedQuerySingleResponse`.
 *
 * `variant` still affects the shape: `'list'` pages with the caller's
 * page/pageSize; `'single'` ignores them (dynamic singles page {0, size 1}
 * in the body when a sort/filter forces a list request).
 *
 * Throws when `name` is empty — caller bug.
 */
export function buildSavedQueryRequest(
  name: string,
  variant: 'list' | 'single',
  options: BuildSavedQueryRequestOptions = {},
): BuiltSavedQueryRequest {
  if (!name || typeof name !== 'string') {
    throw new Error(
      `buildSavedQueryRequest: saved-query name must be a non-empty string (got ${JSON.stringify(name)}).`,
    );
  }

  const params = new URLSearchParams();

  // Named input params — URL-encoded, with reserved keys filtered out so
  // a caller cannot accidentally override pagination/sort/filter via the
  // input bag.
  //
  // Empty strings are dropped too: a caller passing `type: ''` almost
  // always means "no value chosen", and sending `?type=` to the
  // saved-query backend produces an unmatchable filter (e.g.
  // `ilike(type, '%%')`) plus a confusing URL.
  if (options.input && typeof options.input === 'object') {
    for (const [k, v] of Object.entries(options.input)) {
      if (v === undefined || v === null || v === '') continue;
      if (RESERVED_SAVED_QUERY_PARAMS.has(k)) continue;
      params.set(k, String(v));
    }
  }

  const body: Record<string, unknown> = {};

  // Dynamic queries carry pagination/sort/filter in the JSON body (the SSRM
  // list request). Everything else — sql / multi_query /
  // common_table_expression / unknown (platform) queries — keeps the legacy
  // URL params: the data-manager rejects SSRM bodies for non-dynamic types.
  const isDynamic = options.queryType === 'dynamic';
  const hasListControls =
    variant === 'list'
      ? options.page !== undefined ||
        options.pageSize !== undefined ||
        !!options.sort ||
        !!options.filter
      : !!options.sort || !!options.filter;

  if (isDynamic && hasListControls) {
    // The server only treats the body as a list request when `page` is
    // present, so it is always included. `position` is the ROW OFFSET.
    // Single-output reads unwrap the first row, so they page {0, size 1}.
    const size =
      variant === 'list'
        ? options.pageSize ?? DEFAULT_SAVED_QUERY_PAGE_SIZE
        : 1;
    const pageIndex = variant === 'list' ? options.page ?? 0 : 0;
    body.page = {
      mode: 'offset',
      position: String(pageIndex * size),
      size,
    };
    const sortRules = parseSortExpression(options.sort);
    if (sortRules.length > 0) {
      body.sort = sortRules;
    }
    if (options.filter) {
      body.filterExpression = options.filter;
    }
  } else if (hasListControls) {
    // Legacy URL-param contract (deprecated on the server for `_filter`,
    // but the only mechanism available to non-dynamic queries).
    if (variant === 'list') {
      if (options.page !== undefined) {
        params.set('_page', String(options.page));
      }
      if (options.pageSize !== undefined) {
        params.set('_size', String(options.pageSize));
      }
    }
    if (options.sort) {
      params.set('_sort', options.sort);
    }
    if (options.filter) {
      params.set('_filter', options.filter);
    }
  }

  if (options.orgFilter) {
    // `_org` is a CEL filter the data-manager AND-merges into the query.
    // It has no body equivalent — always a URL param, layered on top of any
    // body filterExpression by the server.
    // URLSearchParams percent-encodes the brackets/quotes/commas for us.
    params.set('_org', options.orgFilter);
  }

  // Both list and single reads hit `/execute`. The `/execute/single` route is
  // not reliably available for read saved queries (404s for some apps), so we
  // call `/execute` for both and unwrap the first row for single-output
  // (see `normaliseSavedQuerySingleResponse`).
  const base = `/saved-queries/${encodeURIComponent(name)}/execute`;

  // `URLSearchParams.toString()` form-encodes a SPACE as `+`. The data-manager
  // reads query params literally (it does NOT decode `+` → space), so a value
  // like `Account Onboarding` would arrive as `Account+Onboarding` and a filter
  // comparison against it silently fails. Convert `+` → `%20` so spaces survive
  // as real spaces. Safe: URLSearchParams encodes a literal `+` as `%2B`, so the
  // only `+` left in the string are spaces.
  const qs = params.toString().replace(/\+/g, '%20');
  const url = qs ? `${base}?${qs}` : base;

  return { url, body };
}

/**
 * Normalise a saved-query list response. Phoenix returns one of:
 *   - a bare array of rows: `[ {...}, {...} ]`
 *   - an object with a `data` key holding the array: `{ data: [...] }`
 *   - an object with one key whose value is the array (e.g. the renderer-
 *     mirroring case `{ client_list: [...] }`)
 * Anything else falls back to `[]`.
 */
export function normaliseSavedQueryListResponse<TRow>(data: unknown): TRow[] {
  if (Array.isArray(data)) return data as TRow[];
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.data)) return obj.data as TRow[];
    const keys = Object.keys(obj);
    if (keys.length === 1 && Array.isArray(obj[keys[0]])) {
      return obj[keys[0]] as TRow[];
    }
  }
  return [];
}

/**
 * Normalise a saved-query single-output response.
 *
 * Single reads now hit the LIST endpoint (`/execute`), so the response can be:
 *   - a bare array of rows → take the first row (or null when empty);
 *   - `{ data: [...] }` or `{ <key>: [...] }` → take the first row;
 *   - a bare object (the old `/execute/single` shape, or `{ data: {...} }`) →
 *     return it directly.
 * Returns `null` for empty/missing results.
 */
export function normaliseSavedQuerySingleResponse<TResult>(
  data: unknown,
): TResult | null {
  if (data == null) return null;

  // Array response → first row.
  if (Array.isArray(data)) {
    return (data.length > 0 ? (data[0] as TResult) : null);
  }

  if (typeof data === 'object') {
    const obj = data as Record<string, unknown>;

    // `{ data: ... }` wrapper — unwrap then re-normalise (covers array + object).
    if ('data' in obj) {
      if (Array.isArray(obj.data)) {
        return obj.data.length > 0 ? (obj.data[0] as TResult) : null;
      }
      if (obj.data && typeof obj.data === 'object') {
        return obj.data as TResult;
      }
    }

    // Single-key wrapper whose value is the row array (e.g. `{ client_kpis: [...] }`).
    const keys = Object.keys(obj);
    if (keys.length === 1 && Array.isArray(obj[keys[0]])) {
      const arr = obj[keys[0]] as unknown[];
      return arr.length > 0 ? (arr[0] as TResult) : null;
    }

    // Bare object — the result itself.
    return obj as TResult;
  }

  return data as TResult;
}

/**
 * Build the URL + body for a WRITE saved query (patch / insert / update /
 * delete).
 *
 * ALL writes use a FLAT JSON body: `POST /saved-queries/{name}/execute` with
 * the input object as the body. The stored query references the inputs as
 * `$body.<field>` (or top-level `id` for `patch`). No URL query params.
 *
 * Throws when `name` is empty (caller bug). The body is the input object
 * passed straight through.
 */
export function buildSavedQueryWriteRequest(
  name: string,
  input: Record<string, unknown>,
): BuiltSavedQueryRequest {
  if (!name || typeof name !== 'string') {
    throw new Error(
      `buildSavedQueryWriteRequest: saved-query name must be a non-empty string (got ${JSON.stringify(name)}).`,
    );
  }
  return {
    url: `/saved-queries/${encodeURIComponent(name)}/execute`,
    body: input ?? {},
  };
}

/**
 * Resolve which app-definition key a saved-query request should target.
 *
 * Precedence: an explicit caller override wins; otherwise use the query's
 * own app key from the codegen registry; if neither is known, return
 * `undefined` (so `getDataHeaders` falls back to the current app).
 *
 * This is what makes a cross-app saved query (one owned by an app other than
 * the running one) hit the correct app without the caller having to pass
 * `appDefinitionKey` manually.
 */
export function resolveAppDefinitionKey(
  name: string,
  appKeyMap: Record<string, string>,
  override?: string,
): string | undefined {
  if (override) return override;
  return appKeyMap[name] || undefined;
}

// ── Org scoping (`_org` CEL filter) ────────────────────────────────────────
//
// The data-manager `_org` URL param is a generic CEL expression AND-merged
// into the saved query's filter. We always use the `includes([...], <field>)`
// form (not `==`) because it carries the explicit `::uuid[]` cast the
// data-manager requires for UUID/link columns and generalises to N ids.
//
// NOTE: `_org` is EXACT-org — it matches only the named org rows, with NO
// hierarchy/subtree expansion (selecting a Firm does NOT include its
// Branches' rows). Subtree semantics live in a separate request-body
// mechanism the saved-query path does not support. A query can carry only
// ONE `_org`, so org + advisor scoping are AND-combined into a single
// expression here.

/**
 * Build a single `includes([ids], field)` CEL clause. Returns `''` when there
 * are no ids (so callers can skip an empty clause).
 *
 * @param ids   UUID strings (empties are dropped).
 * @param field The CEL link path to match, e.g. `org.id`, `advisor.id`.
 */
export function buildIncludesFilter(ids: string[], field: string): string {
  const clean = (ids ?? []).filter((id) => typeof id === 'string' && id !== '');
  if (clean.length === 0) return '';
  const list = clean.map((id) => `"${id}"`).join(',');
  return `includes([${list}],${field})`;
}

export interface OrgScopeFilterInput {
  /** Selected organization ids → `includes([...],org.id)`. */
  orgIds?: string[];
  /** Selected advisor (user) ids → `includes([...],advisor.id)`. */
  advisorIds?: string[];
  /** Override the org link field (default `org.id`). */
  orgField?: string;
  /** Override the advisor link field (default `advisor.id`). */
  advisorField?: string;
}

/**
 * Compose the combined `_org` CEL expression from the selected orgs (and
 * advisors). Multiple clauses are AND-combined into one expression because
 * the data-manager reads only the FIRST `_org` param.
 *
 * Returns `null` when nothing is selected (caller then omits `_org`).
 */
export function buildOrgScopeFilter(input: OrgScopeFilterInput): string | null {
  const clauses: string[] = [];
  const orgClause = buildIncludesFilter(input.orgIds ?? [], input.orgField ?? 'org.id');
  if (orgClause) clauses.push(orgClause);
  const advClause = buildIncludesFilter(
    input.advisorIds ?? [],
    input.advisorField ?? 'advisor.id',
  );
  if (advClause) clauses.push(advClause);
  if (clauses.length === 0) return null;
  return clauses.join(' && ');
}
