# Tables / list pages — `DataTable` + `useSavedQueryTable`

Read this before building any list/grid page. Covers the hook wiring, the
count companion, and table height. Full saved-query contract:
`src/queries/SAVED-QUERY.md`.

## List pages MUST use `useSavedQueryTable` from `@/hooks`

Copy the exact `Hook:` line from the **catalog entry** for your query — it
includes the matched `countQuery` / `countSelector` pair when a
`<name>_count` companion was detected by the codegen, and just the
saved-query name when no companion exists. Don't write your own state,
don't call `useSavedQueryList` directly for a table, don't pass `count`
separately.

The `countSelector` shape is **per-query** (codegen derives it from the
count companion's real response — the field may be `count`, `ID`, etc.).
**NEVER hand-write or guess the selector, and never copy it from an
example in this file or `SAVED-QUERY.md` — those are illustrative and
will not match your query. Copy the `countSelector` verbatim from the
matched catalog `Hook:` line.**

```tsx
// Shape only — copy the REAL countSelector from the catalog Hook line:
const tableProps = useSavedQueryTable('<list_query>', {
  countQuery: '<list_query>_count',
  countSelector: /* paste from catalog, e.g. (r) => r?.count */ undefined,
});
<DataTable<GetListRow> {...tableProps} columnDefs={columnDefs} />
```

Or, for a list with no count companion:

```tsx
const tableProps = useSavedQueryTable('<list_query>');
<DataTable<GetListRow> {...tableProps} columnDefs={columnDefs} />
```

## Saved view tabs

When the user asks for saved table views, use `GridViewSwitcher`; do not build
page-local preference calls or tabs. It loads shared organization views from
`App.Screen.<page>.<componentId>` and personal views from
`User.Datatable.<page>.<componentId>`. Shared views are selectable/read-only;
users can save a personal copy.

```tsx
import { useState } from 'react';
import type { GridApi } from 'ag-grid-community';
import { GridViewSwitcher } from '@/components/shared/GridViewSwitcher';

const [gridApi, setGridApi] = useState<GridApi | null>(null);

<DataTable
  {...tableProps}
  columnDefs={columnDefs}
  onGridReady={(event) => setGridApi(event.api)}
  toolbarLeft={
    gridApi ? (
      <GridViewSwitcher
        api={gridApi}
        page="accounts"
        componentId="accountsTable"
        baseLabel="All Accounts"
      />
    ) : null
  }
/>
```

`page` must equal the route/buildSchema/register_screen slug. `componentId`
must be a stable table identifier and must match the final segment of the
shared preference name. Existing `onGridReady` behavior must be composed, not
discarded.

### Publishing shared views

When the user asks to create/change organization-wide or org-specific views,
use `upsert_shared_table_views` — never `create_preference`. Ask for tenant vs
org scope (for org, list `ORGS` and let the user choose). `views` adds or
updates by case-insensitive name while preserving omitted views; use
`removeViewNames` only for explicit, user-confirmed removals. The tool
assigns/preserves numeric ids and serializes the preference value. A new org
record starts from that org's effective inherited views, so adding an override
does not hide tenant/parent-org views.

Before calling, inspect the page's actual column definitions. Every
`filterModel` key must be a real AG Grid `field`/`colId`, and that column's
client/server data path must support the requested filter. Saved views apply
AG Grid state only; an external page filter is not captured automatically.

```json
{
  "pageName": "service-requests",
  "componentId": "requestsTable",
  "scope": "tenant",
  "views": [
    {
      "name": "Wealth",
      "filterModel": {
        "lob": { "filterType": "text", "type": "equals", "filter": "Wealth" }
      }
    }
  ]
}
```

Shared preferences are session-cached. After publishing, tell the user to
reload an already-open app session before verifying the new view tabs.

The hook handles server-side pagination when a count companion is wired,
or fetches up to **100** rows for client-side mode when none is. **Any
table that can exceed 100 rows MUST have a `<name>_count` companion** so
it paginates server-side — fetch-all caps at 100 to protect performance,
so without a companion a larger table silently shows only its first 100
rows. (The cap is overridable via `fetchAllPageSize` only when the user
explicitly asks for a bigger single fetch.) If you bypass the hook and
the DataTable receives exactly 50 rows in client-side mode, a **visible
red banner** renders above the grid in the preview. Full recipe:
`src/queries/SAVED-QUERY.md`.

## Table height

`DataTable` sizes itself via the `minHeight` prop (default `'32rem'` ≈ 10
rows). Drop it in directly — do NOT wrap it in a fixed-pixel height
(`h-[600px]`, `style={{ height }}`) or compute a height from the row count.
The grid renders at that height and the page scrolls as one (the layout
`<main>` owns the scroll). To make a specific table taller/shorter, set the
prop — don't wrap it:

```tsx
// Default height (32rem):
<DataTable {...tableProps} columnDefs={cols} />

// Taller table (number = px, or pass a string like '40rem' / '60vh'):
<DataTable {...tableProps} columnDefs={cols} minHeight={640} />
```

## Cell renderers: don't trust the declared type of `p.value`

Column `cellRenderer`s receive `p.value` straight off a data row. The generated
row type is a compile-time hint, **not a runtime guarantee** — a field declared
`string` can arrive as `boolean`/`number`/`null` from Phoenix (e.g.
`client_list.active` is typed `string` but returns `true`/`false`). Calling
`.trim()`/`.toLowerCase()`/`.toFixed()` on it then throws, and a thrown error
inside a cell renderer **blanks the whole page** via the error boundary.

Coerce at the boundary — use `@/lib/runtime` (`coerceBool`, `asText`,
`asNumber`) or branch on `typeof`; never transform `p.value` raw:

```tsx
import { coerceBool, asText } from '@/lib/runtime';

// ✅ tolerant of string OR boolean:
{ field: 'active', cellRenderer: (p) =>
    coerceBool(p.value) ? <Badge>Active</Badge> : <Badge variant="muted">Inactive</Badge> }

// ✅ safe text:
{ field: 'name', valueFormatter: (p) => asText(p.value) }

// ❌ throws if the backend returns a boolean/number/null:
{ field: 'active', cellRenderer: (p) => p.value.trim() === 'true' ? … : … }
```

Extract any non-trivial derivation as an exported helper and unit-test it with
**mixed-type** inputs (boolean/number/string/null), not just the declared type.
