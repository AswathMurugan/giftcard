# Entities — find one, or create one

Entities are the tenant's **data models**. Every saved query (read or write)
targets an entity. Before building a feature, **find the entity that fits**;
only when none exists do you **create** one with the `create_entity` tool.

**Read this whole file before creating an entity.**

---

## 1. Find first

1. Read the barrel **`src/types/entities/index.ts`** — it re-exports every
   entity type (the full list of what exists).
2. Read the candidate's file `src/types/entities/<entity>.ts` for its fields
   (and its `<ENTITY>_APP_KEY`).
3. If an entity covers what you need, **use it** — write saved queries against
   it (`src/queries/SAVED-QUERY.md`). Do **not** create a duplicate.

Only when **no** entity fits (the user asks for something with no backing
model, or supplies a screenshot of data that maps to no entity) do you create
one.

---

## 1b. Field validation — use as default form constraints

Each per-entity file also exports `<ENTITY>_FIELD_CONSTRAINTS` (e.g.
`ALERT_INBOX_FIELD_CONSTRAINTS`) — the field-level validation Phoenix declares,
generated from the entity response (`required` + `constraints`). Only fields
that are required or carry a constraint are listed.

```ts
import { ALERT_INBOX_FIELD_CONSTRAINTS } from '@/types/entities/platform/alert_inbox';
// { id: { required: true },
//   alert_type: { required: true, constraints: { maxLength: { value: "255" } } } }
```

**When you build a form for an entity, use this as the DEFAULT UI validation**
— don't invent rules:

| Constraint | Form behaviour |
|---|---|
| `required: true` | required field (mark `*`, block empty submit) |
| `maxLength` / `minLength` | input `maxLength` / min length check |
| `maxValue` / `minValue` | numeric `max` / `min` |
| `regex` | pattern validation (`constraints.regex.value`) |
| `oneOf` | restrict to `constraints.oneOf.allowedValues` |

A field absent from the map has no declared constraint — leave it unconstrained.
The user may still ask for stricter rules; these are the baseline.

---

## 2. Create with `create_entity`

The agent has no HTTP/shell — the **`create_entity`** tool makes the Phoenix
call (a schema migration), then regenerates the workspace's entity types so the
new interface + `<ENTITY>_APP_KEY` compile.

### Flow (propose → confirm → create → query)

1. **Propose the schema** in chat: the entity `name` (snake_case) + every field
   with its `type`. Derive fields from the user's request or the screenshot —
   **don't invent** extras.
2. **Wait for the user to confirm.** Creating an entity migrates the tenant
   schema — heavier than a saved query, so confirm first.
3. **Call `create_entity`** with `name`, `label`, optional `description`, and
   `fields`. An `id` UUID primary key is added automatically — list only
   business fields.
4. The tool regenerates types. **Then ASK the user whether to generate the
   corresponding saved queries** for the new entity — e.g. a list read, a
   single read, and insert/update/delete writes — and **wait** for their
   answer. Create only the confirmed ones with `create_saved_query`. Don't
   silently generate a full CRUD set they didn't ask for.

### Tool parameters

| Param | Meaning |
|---|---|
| `label` | Human display name, e.g. `Client Note`. The entity `name` (DynQL key) is **derived from this** (slugified) — don't pass a name |
| `description` | What the entity represents (optional) |
| `fields[]` | Business fields (see below). `id: UUID` PK auto-added |

Each field: `{ label, type, required?, isArray?, description?, enumType?, linkTarget?, cardinality? }`.

**Names are derived from labels.** The platform requires `name == slugify(label)`,
so you pass only human `label`s — the snake_case `name` is computed automatically
(`"Humidity (%)"` → `humidity`, `"Call Date"` → `call_date`). Labels may contain
spaces, `%`, parentheses. Two fields must not slug to the same name. Don't pass a
`name` — it's ignored/derived.

### Field types (`type`)

The full supported field-type set (matches the platform's Field Types palette):

- **Text**: `Text`, `Multilinetext`, `Email`, `URL`, `Phonenumber`, `SSN`
- **Numeric**: `Integer`, `Float`, `Decimal`, `Currency`, `Percent`, `Autonumber`
- **Identifier**: `UUID`
- **Date/time**: `Date`, `Datetime`, `Duration`
- **Boolean**: `Checkbox`
- **Document / media**: `File`, `Seal`, `Signature`
- **Structured**: `Json`, `Ltree`

Special (need extra params):
- **`Enumeration`** → also pass `enumType` = an **existing** tenant enum name
  (see `src/types/enumerations/`). Don't invent enum types.
- **`Link`** → also pass `linkTarget` = the snake_case name of an **existing**
  entity, and `cardinality` (`oneToOne` | `oneToMany` | `manyToOne` |
  `manyToMany`; default `oneToOne`).

Notes: `id` is always `UUID` (auto-added — don't declare it). `Autonumber` is
server-assigned (don't seed it in mock data). `File`/`Seal`/`Signature` store a
file/seal reference, not raw content. `Computed`/`Backlink` are derived and not
typically authored on a fresh entity.

Scope: the entity is created in the **current app** only.

### Example

User: "track simple call notes for a client — date, note text, and which client."

Propose, confirm, then:

```
create_entity({
  label: "Client Call Note",   // → entity name "client_call_note"
  description: "A logged phone call note for a client.",
  fields: [
    { label: "Call Date", type: "Date", required: true },        // → call_date
    { label: "Note", type: "Multilinetext", required: true },    // → note
    { label: "Client", type: "Link", linkTarget: "client", cardinality: "manyToOne" }, // → client
  ],
})
```

→ creates the entity (+ auto `id: UUID`), regenerates
`src/types/entities/client_call_note.ts`. **Then ask the user** which saved
queries to generate (e.g. `client_call_note_list`, an insert write) and create
the confirmed ones with `create_saved_query`.

---

## 2b. Update or delete an entity (same `create_entity` tool)

`create_entity` also **edits** and **deletes** existing entities via an
`action` parameter. All three actions migrate the shared tenant schema, so the
same rule applies: **propose the change, get explicit user confirmation, then
call.**

### Update — `action: "update"` (pass the FULL desired field set)

An update is **declarative, not a diff**. You pass `entityName` + the **entire**
list of fields the entity should have afterwards. The tool fetches the live
definition and reconciles by derived name:

- a field whose name **matches an existing one** → kept, **with its data**
  (label/type/description/required can change);
- a field with a **new** name → **added**;
- an existing field you **omit** → **DELETED, along with its column data**.

So always **read `src/types/entities/<name>.ts` first** and carry forward every
field the user wants to keep — a forgotten field is dropped. The `id` PK is
preserved automatically (never list or remove it). Renaming a field = changing
its label → new name → old column dropped + new one added (confirm data loss).

```
// cricket_player currently: name, role, jersey_number, batting_style,
// bowling_style, age, matches_played, is_captain, is_playing_xi
// Goal: add "Batting Order", keep everything else.
create_entity({
  action: "update",
  entityName: "cricket_player",
  fields: [
    { label: "Name", type: "Text", required: true },
    { label: "Role", type: "Text" },
    { label: "Jersey Number", type: "Integer" },
    { label: "Batting Style", type: "Text" },
    { label: "Bowling Style", type: "Text" },
    { label: "Age", type: "Integer" },
    { label: "Matches Played", type: "Integer" },
    { label: "Is Captain", type: "Checkbox" },
    { label: "Is Playing XI", type: "Checkbox" },
    { label: "Batting Order", type: "Integer" },   // ← the only new field
  ],
})
// Omitting, say, "Bowling Style" from this list would DELETE it + its data.
```

The tool regenerates `src/types/entities/<name>.ts` and reports which fields
were removed. After an update, check that saved queries targeting the entity
still reference valid fields.

### Delete — `action: "delete"`

Removes the entity **and all its rows**. Pass only `entityName`.

```
create_entity({ action: "delete", entityName: "cricket_player" })
```

Confirm with the user first (irreversible on the shared tenant). After a
delete, any saved queries that targeted the entity are **orphaned** — remove or
repoint them.

---

## 3. Seed mock data (`create_mock_data`)

When the user asks for **mock / sample / test data** to populate a page or demo,
use the **`create_mock_data`** tool. It inserts rows into an **existing** entity
(`POST /data/internal/entity/<entity>`, one row per object) and returns the new
ids. This is **data only** — no schema change, no type regen.

Flow:
1. The entity must already exist (create it first with `create_entity` if not).
2. Read `src/types/entities/<entity>.ts` and build rows using ONLY its real
   field names — invented fields are silently dropped by the server. Omit `id`.
   Match each field's type (numbers, ISO dates, valid enum values; for `Link`
   fields pass the target row's id).
3. **Confirm with the user** how many rows and into which entity before seeding —
   it writes to the shared tenant.
4. Call `create_mock_data({ entity, rows: [ {...}, {...} ] })` (max 100 rows/call).

```
create_mock_data({
  entity: "client_call_note",
  rows: [
    { call_date: "2026-01-15", note: "Quarterly review call." },
    { call_date: "2026-02-03", note: "Discussed rebalancing." },
  ],
})
```

For Link fields, seed/look up the parent first, then use the returned ids in the
child rows.

## 4. Guardrails

- **Find before create** — never duplicate an existing entity.
- **Confirm with the user** before create, update, OR delete (every action
  migrates the shared tenant schema).
- **Update is full-set, not a diff** — omitting an existing field DELETES it
  and its data. Read `src/types/entities/<name>.ts` first and carry forward
  every field to keep; spell out adds/changes/removals in your proposal.
- **Delete removes the entity and all its rows** (irreversible) and orphans any
  saved queries targeting it. Confirm explicitly.
- **Don't invent** fields, enum types, or link targets — `enumType` /
  `linkTarget` must already exist, or the migration fails.
- `id: UUID` is the primary key, added/kept automatically — don't add, remove,
  or rename your own `id`.
- After creating, **ask the user** which saved queries to generate, then create
  only those — the data path is still **saved queries** (`create_saved_query`,
  `SAVED-QUERY.md`); never read/write the entity directly, and don't
  auto-generate a CRUD set unprompted.
