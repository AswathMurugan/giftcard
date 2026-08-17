# Saved Queries

Server-stored, named parameterized queries. The only read path when the
tenant's security policy blocks direct dynamic queries
(`POST /query/{entity}`). Most are READ-ONLY; one type — **`patch`** — is a
WRITE (use `useSavedQueryMutation`, see "Writes" below).

**Finding the right saved query:** grep
`src/types/catalogs/saved-queries.catalog.md` by intent keyword. Each entry shows the
hook to use, inputs, outputs, and the human-written description copied from
the Phoenix UI.

Three hooks, but **for list pages you only ever call one**:

| Saved-query shape | Hook | When to use |
|---|---|---|
| **List** (`is_single_output: false`) backed by a `DataTable` | **`useSavedQueryTable`** | **Always.** Bundles list + count + state + DataTable props in one call. |
| Single object (`is_single_output: true`) — KPI card, aggregate, lookup by unique key | `useSavedQuerySingle` | Direct, no table. |
| List used outside a DataTable (loader, dropdown options, etc.) | `useSavedQueryList` | Escape hatch. Usually you don't need this. |

Names, input shapes and row/result shapes come from the auto-generated
registry at `src/types/saved-queries.generated.ts`. The registry is
regenerated on every workspace bootstrap by
`scripts/fetch-saved-queries.ts`. Re-sync in-session with
`npm run fetch:saved-queries`.

**App targeting is automatic — do NOT pass `appDefinitionKey`.** A saved
query may be owned by a different app than the one being generated (the
registry records each query's app key). All three hooks auto-resolve the
correct app from the registry, so a cross-app query (e.g. a
`finplanbabutest`-owned query used while generating a `wealthdomain` app)
hits the right app on its own. The `appDefinitionKey` option exists only
as a rare manual override; leave it unset.

## `useSavedQueryTable` — the only list-page hook

> **List pages MUST use `useSavedQueryTable`.** The catalog's `Hook:` line
> already contains the exact call to copy — including the `countQuery` /
> `countSelector` pair when a `<name>_count` companion exists. **Copy
> verbatim.**

`useSavedQueryTable` automatically picks the right mode based on whether
the catalog gave you a `countQuery`:

| Catalog says `countQuery` | Mode | Server requests | DataTable footer |
|---|---|---|---|
| Yes (e.g. `get_client_list` → `get_client_count`) | **Server-side pagination** | One page (body `page`/`sort`/`filterExpression`) + one count fetch | "Page N of M" with real total |
| No | **Fetch-all** (one request, up to **100** rows) | Single request | "1 to N of N" via AG-Grid client-side |

### Server-side mode example (count companion in catalog)

A catalog entry with a count companion looks like this (the
`countSelector` shape is codegen-derived and varies per query — yours may
be `(r) => r?.count`, `(r) => r?.ID`, etc.):

```
### `<list_query>` — "…"
- **Hook:** `useSavedQueryTable("<list_query>", { countQuery: "<list_query>_count", countSelector: /* the real one from YOUR catalog entry */ })`
- **Count companion:** `<list_query>_count`
- **Outputs:** `…`
```

The page — **copy the whole `Hook:` line, including the `countSelector`,
verbatim from your query's catalog entry. Do NOT reuse the placeholder
selector below; it will not match your query:**

```tsx
import { useSavedQueryTable } from '@/hooks';
import { DataTable } from '@/components/ui/data-table';
import type { ColDef } from 'ag-grid-community';
import type { GetListRow } from '@/types/saved-queries/<list_query>';

const columnDefs: ColDef<GetListRow>[] = [
  { field: 'name', headerName: 'Name', minWidth: 200, flex: 2 },
  // …
];

export default function ExampleListPage() {
  // Copy this line VERBATIM from the catalog Hook entry for your query —
  // including the exact countSelector (it is per-query, not always `.ID`).
  const tableProps = useSavedQueryTable('<list_query>', {
    countQuery: '<list_query>_count',
    countSelector: /* paste from catalog, e.g. (r) => r?.count */ undefined,
  });

  return (
    <div className="flex flex-col gap-4 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Items</h1>
        <p className="text-sm text-muted-foreground">
          {tableProps.count != null
            ? `${tableProps.count.toLocaleString()} items`
            : 'Items'}
        </p>
      </div>
      {/* No height wrapper needed: DataTable carries a `minHeight` floor
          (default 32rem ≈ 10 rows) so AG-Grid never collapses. Do NOT wrap
          it in a fixed-pixel height or compute a row-based height. */}
      <DataTable<GetListRow>
        {...tableProps}
        columnDefs={columnDefs}
      />
    </div>
  );
}
```

**Sizing.** `DataTable` sizes via its `minHeight` prop (default `'32rem'`;
pass a number for px or a string like `'24rem'`/`'50vh'`). The grid renders at
that height and the page scrolls as one (the layout `<main>` owns the scroll).
To make a specific table taller/shorter, set the prop — don't wrap it in a
fixed-height div, and never hand-compute a pixel height from the row count.

### Fetch-all mode example (no count companion)

When the catalog entry has no `countQuery` line:

```
### `get_top_positions` — "Get Top Positions"
- **Hook:** `useSavedQueryTable("get_top_positions")` _(fetch-all, no count companion in catalog)_
```

The page is even simpler — no options object:

```tsx
const tableProps = useSavedQueryTable('get_top_positions');
<DataTable<GetTopPositionsRow> {...tableProps} columnDefs={columnDefs} />
```

The hook issues a single request for up to **100** rows and hands that
set to AG-Grid; sort, filter, and pagination happen client-side. **If the
table can exceed 100 rows, ship a `<name>_count` companion** so it
paginates server-side instead of truncating at 100 — fetch-all is only
safe for small reference tables. (Override the cap per call with
`fetchAllPageSize` only when the user explicitly accepts a larger single
fetch.)

### What the spread gives you

`useSavedQueryTable` returns exactly the four `DataTable` props that
matter, so `{...tableProps}` covers wiring:

| Prop | Server-side mode | Fetch-all mode |
|---|---|---|
| `rowData` | current page's rows | every fetched row |
| `count` | count-companion total | `rowData.length` |
| `isLoading` | list or count still loading | list still loading |
| `onParamsChange` | setParams (re-fetches page) | `undefined` (client-side mode) |

You always spread it. Don't pull fields out one at a time — that's how
agents accidentally drop `onParamsChange` and break pagination.

### Truncation guardrail

If the DataTable receives exactly 50 rows (the saved-query default page)
in client-side mode (no `onParamsChange`), it renders a **visible red
banner above the grid**. The banner means the page was not built from
the catalog's `Hook:` line — go back and copy it.

### Filtering — global search + per-column popups

`useSavedQueryTable` server-side mode wires two filter sources, both of
which fire real API calls. The merged CEL is sent as the body
**`filterExpression`** field of the SSRM list request per the
data-manager team's contract (the legacy `_filter` URL param is
deprecated and only used for non-`dynamic` query types).

1. **Per-column filter popups** (funnel icon on header hover, opens
   AG-Grid's filter popup). Automatic, no caller code. Every column is
   filterable; no restriction by saved-query input. Supported AG-Grid
   filter types translate to CEL as follows:

   | AG-Grid filter | Emitted CEL |
   |---|---|
   | `text.contains` | `containsIgnoreCase(field, 'v')` |
   | `text.notContains` | `!containsIgnoreCase(field, 'v')` |
   | `text.startsWith` | `startsWith(lower(field), 'v'‑lowercased)` |
   | `text.endsWith` | `endsWith(lower(field), 'v'‑lowercased)` |
   | `text.equals` / `notEqual` | `field == 'v'` / `field != 'v'` |
   | `text.blank` / `notBlank` | `(field == null \|\| field == '')` / `(field != null && field != '')` |
   | `number.equals` / `notEqual` / `>` / `<` / `>=` / `<=` / `inRange` | `field == 100` / `field != 100` / `field > 100` / `…` / `(field >= 100 && field <= 200)` |
   | `date.equals` / `notEqual` / `>` / `<` / `inRange` / `blank` / `notBlank` | ISO-string literals, same operators as number |
   | `set` (single value) | `includes(field, 'v')` |
   | `set` (multiple values) | `(includes(field, 'a') \|\| includes(field, 'b'))` |

   Anything outside the table is silently skipped — better no clause
   than a wrong one that may 400 the saved-query backend.

   Text filters use LITERAL-semantics functions (`containsIgnoreCase` /
   `startsWith`/`endsWith` over `lower(field)`) — the data-manager escapes
   LIKE metacharacters inside them, so a user typing `%`/`_` matches those
   characters literally. Never build explicit `ilike()` patterns from user
   input; `ilike()` is only for intentional wildcard filters.

2. **Top-toolbar global search** — opt-in via the `searchColumns` option:

   ```ts
   // countQuery/countSelector come verbatim from the catalog Hook line.
   useSavedQueryTable('<list_query>', {
     countQuery: '<list_query>_count',
     countSelector: /* from catalog */ undefined,
     searchColumns: ['<search_field>'],   // ← typing in the toolbar searches this
   });
   ```

   Without `searchColumns`, the toolbar search button is hidden — no CEL
   is sent. Only `searchColumns[0]` is used (the saved-query backend's
   search model is single-field); extra entries are accepted but
   ignored. The emitted CEL is:

   ```
   containsIgnoreCase(client_name, 'willi')
   ```

The two filter sources are `&&`-merged into a single CEL sent as the
body `filterExpression`. The server AND-merges it with the stored
query's own filter (and `_org` when org scoping is active).

### Sorting — body `sort`

`useSavedQueryTable` translates AG-Grid sort changes into a sort
expression which the request builder converts to the body
`sort: [{field, dir}]` array:

- Ascending: bare field name (e.g. `name`). The optional `+` prefix is
  omitted.
- Descending: `-` prefix (e.g. `-balance`).
- Multiple columns: comma-separated (e.g. `status,-balance`).
- Link paths are supported (e.g. `-client.name`) for single-valued
  forward links; unknown/unsupported sort fields are silently dropped
  server-side.

An explicit sort overrides the stored query's `orderBy`; with no sort,
the stored `orderBy` is preserved.

## `useSavedQuerySingle` — single-object response (no table)

```ts
import { useSavedQuerySingle } from '@/hooks';

const { data, isLoading } = useSavedQuerySingle(
  'get_account_summary_details',
  { input: { accountId } },
);
// data: GetAccountSummaryDetailsResult | null
// data?.account?.account_value
```

Maps server `404 NO_RESULTS_FOUND` → `data: null, error: null` so callers
don't have to special-case empty responses. `400 MULTIPLE_RESULTS`
surfaces as a normal error.

## `useSavedQueryList` — low-level escape hatch

Use only when you're not feeding a `DataTable`. Loaders, dropdown option
sources, custom non-table UIs.

```ts
const { data, hasMore } = useSavedQueryList('get_client_list', {
  page: 0,
  pageSize: 25,
  sort: '-client_name',
  filter: "is_active == true",
});
```

Wire mapping for `dynamic` queries (the codegen default — pagination,
sort, and filter travel in the JSON body as an SSRM list request):

- `page` + `pageSize` → body `page: { mode: 'offset', position: '<page × pageSize>', size: <pageSize> }`
  (`position` is the ROW OFFSET, always included when any option is set)
- `sort`   → body `sort: [{ field, dir: 'ASC'|'DESC' }]` (from `'name'`, `'-balance'`, `'status,-name'`)
- `filter` → body `filterExpression` (CEL)
- everything in `input` → `?name=value` (URL-encoded; empty strings dropped)

Non-`dynamic` query types (`sql` / `multi_query` /
`common_table_expression`, and platform queries not in the registry)
fall back to the legacy `_page`/`_size`/`_sort`/`_filter` URL params —
the server rejects SSRM bodies for those types.

Reserved names (`_page`/`_size`/`_sort`/`_filter`/`_org`) inside `input`
are dropped — use the matching option instead. The hook returns `hasMore`
as a heuristic (`data.length >= pageSize`) since the server doesn't
surface totals.

## Imperative wrapper (codegen-emitted, one per saved query)

Each generated module also exports an async wrapper for non-React
callers (loaders, service-layer code, tests):

Per-item modules are foldered by app — use the **Module:** path from the
catalog (`@/types/saved-queries/<app_definition_key>/<name>`), not a flat path.

```ts
// path shown as the catalog's **Module:** line (foldered by app):
import { executeGetClientDocuments } from '@/types/saved-queries/wealthdomain_69c65d7d64bd0f04506bab2b/get_client_documents';

const rows = await executeGetClientDocuments(
  { clientId: 'abc' },
  { page: 0, pageSize: 20 },
);
```

## Saved-query types — what the backend supports

The data-manager accepts these `type` values when *defining* a saved query:

| `type` | Body field | Response shape | Hook |
|---|---|---|---|
| `dynamic` | DynQL JSON | rows (or single object for `is_single_output: true`) | `useSavedQueryTable`/`-List`/`-Single` |
| `sql` | raw SQL `SELECT` | rows | `useSavedQueryTable`/`-List` |
| `multi_query` | array of INDEPENDENT dynamic sub-queries run in PARALLEL | ONE object keyed by sub-query name | **`useSavedQuerySingle`** (values untyped) |
| `common_table_expression` | sub-queries composed sequentially | last sub-query's result, OR a write | `useSavedQueryList` (read) / **`useSavedQueryMutation`** (write) |
| `patch` | flat JSON `{ id, ...fields }` | the patched row | **`useSavedQueryMutation`** |

A `multi_query` / `common_table_expression` used as a **read** is emitted as
`return type: unknown` (composite shapes aren't typed yet — type by hand). But
when its body carries an `insert`/`update`/`delete` op it is detected as a
**write** and gets the mutation hook with typed input/output (see "Writes").

### multi_query — several independent reads in ONE saved query

When a page needs several related reads at once (dashboard KPI/count bundles,
one scope → many aggregates), create **one** `multi_query` instead of N
separate saved queries: call `create_saved_query` with
**`queryType: "multi_query"`** and `query` = a JSON **array** of named dynamic
sub-queries (1–50, unique snake_case names, reads only):

```json
[
  { "name": "total", "type": "dynamic", "is_single_output": true,
    "query": { "sr_instance": { "select": { "id": true },
      "aggregate": [{ "function": "count", "field": "id", "alias": "count" }] } } },
  { "name": "assigned_to_me", "type": "dynamic", "is_single_output": true,
    "query": { "sr_instance": { "select": { "id": true },
      "aggregate": [{ "function": "count", "field": "id", "alias": "count" }],
      "filter": "owner.id == $user_id" } } },
  { "name": "by_priority", "type": "dynamic",
    "query": { "sr_instance": { "select": { "priority": true },
      "aggregate": [{ "function": "count", "field": "id", "alias": "count" }],
      "groupBy": ["priority"] } } }
]
```

Semantics:

- Sub-queries execute **in parallel** and are **independent** — no
  cross-references between them (that's a CTE). Result: **one object keyed by
  sub-query name** (`{ total: {…}, assigned_to_me: {…}, by_priority: [...] }`).
- Per-sub `is_single_output: true` → that key holds a single object (use for
  one-row aggregates; 0 rows errors NO_RESULTS). Omitted/false → an array.
- `$param` placeholders are **shared**: one named input (e.g. `user_id`) binds
  into every sub-query that references it. Inputs are typed `string`.
- Runtime `_filter`/`_org` and pagination apply to **every** dynamic
  sub-query (a table filter composes into each count).
- Read with `useSavedQuerySingle("<name>", { input })`. The result values are
  untyped (composite) — narrow them in page code.
- Reads only; the whole query's `is_single_output` is forced `true`. All
  sub-queries target ONE app: pass `entityAppKey` as usual, don't set per-sub
  `target_app_definition_key`.

## Org scoping (`_org`)

When a page is wrapped in `<OrgContextProvider>` and an
`<OrgHierarchySelector/>` selection exists, the read hooks automatically
append an `_org` URL param — a CEL filter scoping the query to the
selected org(s)/advisor(s): `includes(["<orgId>",…],org.id)` (advisors
AND'd as `includes([…],advisor.id)`). The data-manager merges `_org` into
the query as an additional `AND` condition. `_org` has **no body
equivalent** — it stays a URL param even for dynamic queries whose
pagination/sort/filter travel in the body; the server layers it on top
of any body `filterExpression`.

- Auto-applied to `useSavedQueryTable` / `useSavedQueryList` /
  `useSavedQuerySingle` when an org context + selection exist.
- Pass `orgScoped={false}` to opt a query out (its entity has no `org`
  link, or it must read across orgs).
- **Exact-org only** — no hierarchy/subtree expansion (selecting a Firm
  does NOT include its Branches' rows; the user cascades to the level
  they want). Subtree semantics aren't available on the saved-query path.
- Requires the query's target entity to declare an `org` (or `advisor`)
  link field, or the data-manager generates an invalid join (500) — opt
  out with `orgScoped={false}` for such queries.

See `src/config/org/` (provider + filter) and `src/components/org/`
(selector).

## Writes

A write saved query is one whose body carries an `insert` / `update` /
`delete` op (any `type`), or the legacy `patch` type. All writes use
**`useSavedQueryMutation`** — `mutateAsync(input)` returns the affected
row(s); the hook auto-resolves the app key and invalidates dependent
`saved-query-*` caches on success so reads refetch.

### Transport — always a flat JSON body

**Every write sends its inputs as a flat JSON request body** (`POST
…/execute` with the input object as the body). The stored query references
the inputs as `$body.<field>` (or top-level `id` for `patch`); the server
reads them from the body. There is **no** URL-query-params write form — you
just pass the typed input to `mutateAsync` and the hook posts it as the body.

### Patch

```tsx
import { useSavedQueryMutation } from '@/hooks';

const patchSr = useSavedQueryMutation('patch_sr_instance');
await patchSr.mutateAsync({ id: srId, data: { foo: 'bar' } }); // flat body, `id` required
// patchSr.data is the patched row.
```

### Insert / update / delete

A plain `dynamic` write (or a CTE) is fully typed. The `$body.<field>`
placeholders become **flat** input fields (`$body.name` → `name`), sent as the
JSON body. For a CTE with a declared output attribute, the row type is resolved
from it (e.g. `client` → `clientOutput`) rather than a bare `{ id }`.

```tsx
const insertClient = useSavedQueryMutation('insert_clients_cte');
const row = await insertClient.mutateAsync({ name: 'Acme', active: 'true' });
// row.id / row.client_name / row.active  (typed from the query's output)
```

### Sparse payloads — omit untouched/empty fields

A write's SET-list writes **every field present in the body**. So send a
**sparse payload**: include only the fields the user actually set or changed,
and **omit untouched/empty ones** — do NOT send `""`. An empty string either
fails on number/boolean columns or **overwrites a value the user never
touched** (the SET-list always writes what it's given).

Build the input by dropping blank/nullish fields before calling `mutateAsync`:

```tsx
// Sparse input: keep only fields with a real value. `id` always has one,
// so the row/filter key is never dropped.
const input = Object.fromEntries(
  Object.entries({ id, client_name, type, stage, rating, total_aum, active })
    .filter(([, v]) => v !== '' && v != null),
);
await updateClient.mutateAsync(input);
```

Notes:

- Omitting a field = **leave it unchanged** (update) / **use the column
  default** (insert). It is the safe default for edit forms.
- **Blank ≠ clear.** To *intentionally* clear a field, send an explicit
  value/sentinel agreed with the backend — never rely on `""`.
- This relies on the server **skipping an unbound `$body.<field>`** in the SET
  clause; verify it on the first write for a new query rather than assuming.

## Managing saved queries — update / delete

The same **`create_saved_query`** tool edits and removes existing queries via an
`action` parameter. Both regenerate the local catalog + types (delete also
prunes the query's type file).

- **`action: "update"`** — full replace of an existing query's `label` /
  `description` / `query` body. Pass the same `name` (its identity — to rename,
  delete + create) plus the new `label`/`description`/`query` (and `isSingle`
  for reads). You do **not** pass `appKey`: the tool resolves it from the
  generated registry (`SAVED_QUERY_APP_KEYS` in
  `src/types/saved-queries.generated.ts`). Read the catalog entry, propose the
  change, and confirm with the user first.

  ```
  create_saved_query({
    action: "update",
    name: "cricket_player_kpis",
    label: "Cricket Player KPIs",
    description: "…updated description…",
    query: '{"cricket_player":{"select":{"id":true},"aggregate":[{"function":"count","field":"id","alias":"count"},{"function":"avg","field":"age","alias":"avg_age"}]}}',
    isSingle: true,
  })
  ```

- **`action: "delete"`** — remove a query. Pass only `name` (app auto-resolved).
  **Destructive:** any page using its hook
  (`useSavedQueryTable`/`-Single`/`-Mutation("<name>")`) stops compiling once
  the type file is pruned — remove or repoint those references. Confirm first.

  ```
  create_saved_query({ action: "delete", name: "cricket_player_kpis" })
  ```
