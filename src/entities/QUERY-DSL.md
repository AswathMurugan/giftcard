# Phoenix Query DSL

This is the grammar of a Phoenix saved query's `query` field and the JSON passed
to **`execute_dynamic_query`** for agent-time execution. Saved queries remain
the **only generated-app data mechanism**: every runtime read (§1–8) and write
(§9 — insert/update/delete) is a named saved query. Generated page code has no
direct dynamic-query route or `useEntityMutation`.

Read this doc before authoring anything fancier than a flat `select` — filters,
aggregates, joins, group-by, text search, computed fields.

The Phoenix DSL is **not** SQL, and **not** the typed
`where: { foo: { equals: ... } }` shape of other ORMs. Don't guess it — match
an example below.

### Reads vs writes

Saved queries are the **only generated-app** data path — there is no direct
entity read route and no `useEntityMutation` in page code. Every runtime read
and write is a named saved query created with `create_saved_query`.

| What you need | How |
|---|---|
| Any read (list, single object, aggregate/KPI, count, chart series) | a **read saved query** — find in the catalog or create via `create_saved_query`; author its `query` with the DSL in §1–8, read with `useSavedQueryTable` / `useSavedQuerySingle` |
| Create / update / delete a row | a **write saved query** (`insert` / `update` / `delete`) — create via `create_saved_query`, execute with `useSavedQueryMutation`. See §9. |

---

## 1. Where this DSL goes

The DSL is the value of a saved query's `query` field. It is an object keyed by
the **snake_case entity name**, with the query spec inside. Field names use the
entity's own naming (see `src/types/entities/<entity>.ts` for the canonical
list per entity — fetched live from the tenant at workspace bootstrap).

```json
{
  "account": {
    "select": { "id": true, "account_number": true }
  }
}
```

When you call `create_saved_query`, pass this as the `query` param (as a JSON
string). Phoenix stores it and exposes it as a named, typed saved query you
then read with `useSavedQueryTable` (lists) or `useSavedQuerySingle` (single
object / KPI). Aggregate-without-`groupBy` returns a flat single object — a
natural fit for `useSavedQuerySingle`.

---

## 2. `select` — projections

### Flat fields

```json
{
  "account": {
    "select": { "id": true, "accountNumber": true, "balance": true }
  }
}
```

### Nested linked entities

A link is selected by nesting another `select`. Always pick at least one
scalar field of the link (rendering the link object directly throws
`Objects are not valid as a React child`):

```json
{
  "account": {
    "select": {
      "id": true,
      "accountNumber": true,
      "primaryOwner": {
        "select": { "id": true, "firstName": true, "lastName": true }
      }
    }
  }
}
```

### `selectsingle`

For one-to-one or backlink relationships where exactly one record is
expected, use `selectsingle` instead of `select` on the nested object.

`selectsingle` can also be used at the **top level** of a query when you
expect exactly one row (e.g. filter by a unique business key like
`email == "..."`). When you do that, run it through `useEntityAggregate`
— it returns the single record as `data` directly instead of forcing
you to read `data[0]` from `useEntityList`.

```ts
const { data } = useEntityAggregate<{ user: User }>({
  user: {
    selectsingle: { id: true, email: true, firstName: true },
    filter: `email == "${email}"`,
  },
});
// data?.email, data?.firstName
```

### Select all fields

```json
{ "account": { "select": { "*": true } } }
```

Works inside nested selects too. Convenient for debugging; avoid in
production code because it ships everything every time.

### Explicit join of non-linked entities

When two entities aren't formally linked in the schema but you need to
join them anyway, alias with `::EntityName` and provide a `join`
expression:

```json
{
  "account": {
    "select": {
      "id": true,
      "accountOwner::User": {
        "selectsingle": {},
        "join": "User.userId = Account.createdBy"
      }
    }
  }
}
```

---

## 3. `filter` — string expression DSL

Filters are **strings**, not objects. Supported operators:

| Op | Meaning |
|---|---|
| `==`, `!=` | equality, inequality |
| `>`, `<`, `>=`, `<=` | numeric / date comparisons |
| `&&`, `\|\|`, `!` | logical and/or/not |
| `()` | grouping |

```json
{
  "account": {
    "select": { "id": true, "accountNumber": true },
    "filter": "accountNumber == '1234' && balance >= 10000"
  }
}
```

### Built-in functions

| Function | Example |
|---|---|
| `stringContains(field, 'x')` | case-sensitive substring |
| `stringContainsIgnoreCase(field, 'x')` | case-insensitive substring |
| `dateTimeToDate(field)` | strip time from datetime |

```json
{ "account": { "select": { "id": true },
                "filter": "stringContainsIgnoreCase(name, 'capital')" } }
```

### Parameterized filter (read input) — bare `$name`, no braces, no quotes

When a saved query filters by a value supplied at execute time, reference it
in the `filter` string with a **bare `$placeholder`**. At runtime the value is
passed as a named input and substituted by the server.

```json
{ "client": { "selectsingle": { "id": true, "client_name": true },
              "filter": "id == $id" } }
```

Read it with the input bag — the key matches the placeholder name:

```ts
useSavedQuerySingle('client_by_id', { input: { id: clientId } });
// → server substitutes $id, filter becomes id == '<clientId>'
```

**Get the syntax exactly right — these are the common mistakes:**

| Form | Verdict |
|---|---|
| `"id == $id"` | ✅ correct — bare placeholder |
| `"id == '${id}'"` | ❌ that's JavaScript template-literal syntax, not the DSL. `${…}` and the quotes are wrong |
| `"id == \"$id\""` / `"id == '$id'"` | ❌ do not quote the placeholder |
| `"id == $body.id"` | ❌ `$body.<field>` is the **write** form (§9). Reads use a bare `$name`. |

> Note: the `${email}` you see in a `useEntityAggregate({ filter: \`email == "${email}"\` })`
> call earlier in this doc is **TypeScript** building the string at call time — a
> different thing from a STORED saved-query placeholder. In a saved query's
> `query` body you write `$id`, never `${id}`.

### Nested filters on a linked select

```json
{
  "account": {
    "select": {
      "id": true,
      "primaryOwner": {
        "select": { "firstName": true, "lastName": true },
        "filter": "firstName == 'Alice'",
        "orderBy": "lastName"
      }
    },
    "filter": "(accountNumber == '1234' || accountNumber == '5678') && balance > 1000",
    "orderBy": "desc(accountNumber)"
  }
}
```

---

## 4. `orderBy`, `offset`, `limit`

- `orderBy`: string or array of strings. Wrap with `desc(field)` for descending.
- `offset` / `limit`: numbers. Default offset 0; no implicit limit (always
  set one for list pages).
- Order-by can target a linked field via dot path: `desc(primaryOwner.lastName)`.

```json
{
  "account": {
    "select": { "id": true, "accountNumber": true, "balance": true },
    "orderBy": ["desc(balance)", "accountNumber"],
    "offset": 0,
    "limit": 20
  }
}
```

---

## 5. Aggregates, group-by, distinct, count

### Aggregate without group-by (single object → KPI / count)

`aggregate` is an **array** of `{ "function", "field", "alias" }` specs, and
the body MUST also include a `select` — Phoenix rejects an aggregate-only
query. Functions: `count`, `sum`, `avg`, `min`, `max`.

```json
{
  "account": {
    "select": { "id": true },
    "aggregate": [
      { "function": "count", "field": "id",      "alias": "count" },
      { "function": "min",   "field": "balance", "alias": "minBalance" },
      { "function": "max",   "field": "balance", "alias": "maxBalance" },
      { "function": "avg",   "field": "balance", "alias": "avgBalance" },
      { "function": "sum",   "field": "balance", "alias": "totalBalance" }
    ],
    "filter": "accountType == 'Savings' || accountType == 'Current'"
  }
}
```

Phoenix returns an aggregate-without-`groupBy` body as a **single flat object**
keyed by the aliases (`{ "count": 42, "avgBalance": 1000, … }`). Author it as a
saved query with `isSingle: true` and read it with `useSavedQuerySingle`.

> ❌ Do **not** use the old object form `"aggregate": { "count": "${count(id)}" }`
> — it fails at runtime. `aggregate` is an **array** of
> `{ function, field, alias }`, **always paired with a `select`**:
> `{"client":{"select":{"id":true},"aggregate":[{"function":"count","field":"id","alias":"count"}]}}`.

### Group-by (list → one row per group)

Put the group-by keys in `select`, repeat them in `groupBy`, and put the
aggregates in the `aggregate` array:

```json
{
  "account": {
    "select": { "accountType": true, "createdOn": true },
    "aggregate": [
      { "function": "count", "field": "id",      "alias": "count" },
      { "function": "min",   "field": "balance", "alias": "minBalance" }
    ],
    "filter":  "createdOn >= '2024-01-01' && balance >= 100",
    "groupBy": ["accountType", "createdOn"]
  }
}
```

A grouped aggregate returns a **list** (one row per group) — author with
`isSingle: false` and read with `useSavedQueryTable`.

### Distinct

```json
{ "account": { "distinct": { "accountType": true },
                "filter":   "accountStatus == 'Active'" } }
```

### Counting rows

Every top-level query MUST include `select`, `selectsingle`, or
`aggregate` — Phoenix returns `PHX-ERR-500: query must have select or
selectsingle` otherwise.

To count rows, pair a `select` with a single `count` aggregate (pick any
scalar field, typically `id`). Author it as a saved query with
`isSingle: true` and read with `useSavedQuerySingle`:

```json
{
  "account": {
    "select": { "id": true },
    "aggregate": [ { "function": "count", "field": "id", "alias": "count" } ],
    "filter": "accountStatus == 'Active'"
  }
}
```

Phoenix returns aggregate-without-`groupBy` responses as a **flat object**
(not wrapped under the entity key, not an array), e.g. `{ "count": 42 }`.
`useSavedQuerySingle` exposes that object directly as `data` (`data?.count`).
For a `<list>` + `<list>_count` companion pair (see `TABLE.md`), the count
query uses exactly this shape with `alias: "count"`.

> Do not write `{ "count": {} }` at the top level, and do not use the old
> `"aggregate": { "total": "${count(id)}" }` object form — both fail at
> runtime. Use the array form above (`select` + `aggregate: [{ function,
> field, alias }]`).

### Count of links with filter

```json
{
  "account_balances": {
    "select": {
      "name": true,
      "activeAccounts": {
        "count":  { "accountBalancesAccount": true },
        "filter": "accountStatus == 'Active'"
      }
    }
  }
}
```

---

## 6. `with` clauses — subquery composition

A `with` block defines named subqueries usable elsewhere via `${__.alias…}`.

### Date-part group-by via a `with` shim

```json
{
  "with": [
    {
      "key": "acc",
      "value": {
        "account": {
          "select": { "*": true, "createdDate": "${dateTimeToDate(createdAt)}" }
        }
      }
    }
  ],
  "${__.acc}": {
    "select":    { "createdDate": true },
    "aggregate": [ { "function": "count", "field": "id", "alias": "count" } ],
    "groupBy":   ["createdDate"]
  }
}
```

### Full-text search composing with a follow-up select

(Only works when full-text is enabled on the entity.)

```json
{
  "with": [
    {
      "key": "res",
      "value": { "account": { "search": { "text": "Raj:*" } } }
    }
  ],
  "${__.res.object}": {
    "select": {
      "name":        true,
      "description": true,
      "score":       "${__.res.score}"
    },
    "orderBy": "desc(__.res.score)",
    "limit":   10
  }
}
```

---

## 7. Text search variants

- `search.text`: Postgres full-text. Requires full-text enabled on the
  business object.
- `textsearch`: pg_trgm trigram search across a chosen list of fields. Use
  this for fuzzy / typo-tolerant search.

```json
{
  "security": {
    "textsearch": {
      "fields": ["securityDescription", "symbol"],
      "word":   "BGMO"
    }
  }
}
```

---

## 8. Computed fields via `${ ... }` expressions

You can compute a field in the projection:

```json
{
  "security": {
    "select": {
      "id":          true,
      "description": "${securityDescription1 + securityDescription2}"
    }
  }
}
```

The expression runs server-side over the row. Use sparingly — these don't
benefit from the same indexing/caching as raw fields.

---

## 9. Writes — `insert` / `update` / `delete`

Saved queries also do **writes**: one operation on **one root entity**, one
level (no nested writes, no joins). Author the body in the **simple
single-object form** below, keyed by the snake_case entity name, then create it
with `create_saved_query`. The tool stores every write as
`common_table_expression` and **wraps your body in the CTE sub-query array
automatically** — you do NOT set `type` and do NOT wrap it in `[]` yourself.
Write inputs are **`$body.<field>`** tokens — at execute time they're supplied
as a **flat JSON body** (`{ field: value }`) and substituted into the query.

### insert

```json
{ "account": { "insert": { "account_name": "$body.name", "status": "$body.status" } } }
```

Execute with `useSavedQueryMutation("create_account")` passing `{ name, status }`.
Returns the new row's id: `{ "id": "…" }`.

### update — `filter` is REQUIRED

```json
{ "account": { "update": { "status": "$body.status" }, "filter": "id == $body.id" } }
```

Execute passing `{ id, status }`. Returns the affected row(s): `[{ "id": "…" }]`.

### delete — `filter` is REQUIRED

```json
{ "account": { "delete": {}, "filter": "id == $body.id" } }
```

Execute passing `{ id }`. Returns the deleted row(s): `[{ "id": "…" }]`.

**Rules.** Exactly one root entity; exactly one of `insert` / `update` /
`delete`. `update` and `delete` **must** include a `filter` (the same string
DSL as §3, with `$body.<field>` placeholders, e.g. `id == $body.id`) — without
it the write is rejected. Field names must match the entity type in
`src/types/entities/<entity>.ts`.

### What gets stored (you don't author this)

For an insert like `{"client":{"insert":{"client_name":"$body.name"}}}`, the
tool stores `type: common_table_expression` with the body wrapped as:

```json
[{ "name": "do_insert", "type": "dynamic", "is_single_output": true,
   "query": { "client": { "insert": { "client_name": "$body.name" } } } }]
```

You author only the simple object form; the wrapping is automatic. (You *may*
pass a multi-sub-query array yourself to chain steps, but it's rarely needed.)
For several INDEPENDENT reads in one query (KPI/count bundles, parallel, result
keyed by sub-query name) use `queryType: "multi_query"` instead — see
`src/queries/SAVED-QUERY.md` §multi_query.

```json
[
  {
    "name": "do_insert",
    "is_single_output": true,
    "query": { "client": { "insert": { "client_name": "$body.name", "active": "$body.active" } } }
  }
]
```

Execute with `useSavedQueryMutation("insert_clients_cte")` passing
`{ name, active }` (flat — `$body.name` is the `name` field of the body).

---

## Authoring a saved query's `query` body

Everything above is the grammar for the `query` field you pass to
`create_saved_query`. Workflow:

1. Decide the shape: a **list** (`select`, optional `filter`/`orderBy`/`limit`,
   or aggregate **with** `groupBy`) → read later with `useSavedQueryTable`; a
   **single object** (aggregate without `groupBy`, top-level `selectsingle`,
   KPI/count) → read later with `useSavedQuerySingle` (`isSingle: true`).
2. Author the JSON keyed by the **snake_case entity name**. Example list body:

```json
{
  "account": {
    "select": {
      "id": true,
      "account_number": true,
      "primary_owner": { "select": { "id": true, "first_name": true, "last_name": true } }
    },
    "filter": "balance > 10000",
    "orderBy": "desc(balance)",
    "limit": 20
  }
}
```

Example single-object (KPI) body:

```json
{
  "account": {
    "select": { "id": true },
    "aggregate": [
      { "function": "count", "field": "id",            "alias": "total" },
      { "function": "avg",   "field": "account_value", "alias": "avgAum" }
    ],
    "filter": "is_active == true"
  }
}
```

3. Resolve the entity's app key (`<ENTITY>_APP_KEY` in the entity file, or the
   current app's key in `src/types/catalogs/app.md` — **ask the user which**), then call
   `create_saved_query` with `{ name, label, description, query, appKey,
   isSingle }`. Use the hook it returns.

Field names must match the entity interface in `src/types/entities/<entity>.ts`
— invented names produce `PHX-ERR-500` at runtime (no compile-time check on a
raw JSON `query` string, so be precise).
