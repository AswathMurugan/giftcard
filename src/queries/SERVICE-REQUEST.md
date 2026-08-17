# Service Requests

A Service Request (SR) page lets a user fill, save, and submit a Phoenix
**workflow** that is tagged `Service Request`. **Create** runs the SR workflow
(`useSrCreate` → `/v1/sr/execute/{name}`) to mint the instance and its
mandatory `srInstanceId`; the in-progress form is stored as a draft row in the
**`sr_instance`** entity; **Submit** (`useSrSubmit` → `/v1/signals/{srInstanceId}/trigger`)
fires the SR's submit signal, which returns field-level validation errors.

**Read this whole file before building an SR page.** It is a contract — follow
the order, don't guess names, and don't build a page when no SR workflow
matches the request.

> **Single-step vs multi-step — pick the layout from the field set (§8a):** most
> SRs are a **single** set of fields → render a FLAT form (header + a Card or two
> of fields + a footer with Save-as-draft / Submit), NOT a step rail. Only use a
> wizard chrome (left step rail + `Progress` + summary header + "Save & Next"
> footer) when the SR genuinely splits into **2+ ordered steps** (e.g. Raise
> Cash: Enter Amount → Review & Submit). Do **not** wrap a one-step form (e.g.
> Address Change) in a "Step 1 of 1" rail. Use Phoenix Gold for the single
> primary action; semantic tints for status badges.

The building blocks already exist; you do **not** write new runtime plumbing:

| Need | Use |
|---|---|
| **Create** the SR instance | `useSrCreate('<sr_workflow_name>')` → `POST /v1/sr/execute/{name}`, returns the mandatory `srInstanceId` (replaces the `insert_sr_instance` draft create) |
| **Submit** the SR | `useSrSubmit(srInstanceId)` → `POST /v1/signals/{srInstanceId}/trigger` (replaces the old `useWorkflow('sr_submit')`) |
| Load an existing draft | the platform **read** saved query for `sr_instance` (by draft `id`) |
| Update a draft | the platform **patch** saved query for `sr_instance` (via `useSavedQueryMutation`) |
| Prefill a **brand-new** form with current values | a per-SR **read** saved query named `sr_<workflow_name>` that reads the **master entity** by `entityReferenceId` (boInstanceId) |
| Validate the form **before** submit | a zod schema + `react-hook-form` / `zodResolver` (§8) — gate **submit** on local validity |

> **Both ids are mandatory for the SR create flow.** Creating an SR requires
> **`boInstanceId`** (→ `entity_reference_id`, plus `entity_type` = the root
> business object name) as input to `useSrCreate`; the call returns
> **`srInstanceId`**, which is then mandatory for every downstream step
> (patch/update and submit). Neither is optional: no `boInstanceId` → cannot
> create; no returned `srInstanceId` → cannot update or submit.

---

## 1. The two entry points

A user reaches an SR page one of two ways. Both converge on "resolve a
workflow", then "build the form".

1. **Typed in chat** — e.g. *"create SR for address change"*. You have an
   intent phrase, not a name. **Find** the matching SR workflow (§2).
2. **Navigated from the platform** — the SR / workflow **name arrives in the
   chat context**. You already have the name; confirm it exists in the
   workflow catalog and proceed.

---

## 2. Resolve the SR workflow

SRs are workflows tagged `Service Request`. The tenant's workflows are already
fetched — grep the catalog:

```sh
grep -nE "Service Request" src/types/catalogs/workflows.catalog.md
```

Each entry shows `**Tags:** \`Service Request\``, the `useWorkflow("<name>")`
hook line, inputs, and outputs.

Resolution rules:

- **Name given and it matches** an SR-tagged workflow → use it.
- **Ambiguous, or you're unsure of the exact name** → **list the SR-tagged
  workflow names and ask the user to pick.** Do not guess.
- **No SR-tagged workflow matches the request** → **do NOT build a page.**
  Tell the user that SR isn't available for this tenant.

`<workflow_name>` (snake_case, from the catalog) is the key you reuse
everywhere below — for the form data query name and as the default form
identity.

> The workflow catalog is empty until `npm run fetch:workflows` has run for the
> tenant. If it's empty, regenerate first; if it's still empty, the tenant has
> no SR workflows → don't build a page.

---

## 3. The two values every SR needs — they are PASSED IN, not picked here

An SR is keyed by two things, and **both arrive as route/URL params** —
the SR page does **not** contain a picker for them:

- **`entityReferenceId`** (the *boInstanceId*) — the *business object* the SR
  acts on (for an account-rooted SR, the **account id**). It is chosen
  **elsewhere** (a separate list page, or the platform's deep-link) and passed
  in via the URL (e.g. `?entity_reference_id=<id>`). It maps to
  `sr_instance.entity_reference_id`; the SR's root business object name goes in
  `sr_instance.entity_type` (`sr_definition.root_business_object`).
- **the `srInstanceId`** — the `sr_instance` row's primary key (`id`), returned
  by `useSrCreate`. Present when the user **resumes / reopens** an existing SR,
  passed in via the URL (e.g. `?id=<id>`). Use it to read the SR back (its
  `payload`) and to submit.

> 🚫 **The SR page is a focused FORM, not a list page.** Do NOT embed a
> client/candidate `DataTable` or an "Add" button to pick the business object
> inside the SR page. That selection happens on a **separate** page (or comes
> from the platform). The SR page reads `entity_reference_id` / `id` from the
> URL, and if neither is present it shows a short "no target selected" empty
> state — it does not render a picker table. Keep list-picking and the SR form
> on separate routes.

> ⚠️ The field is **`id`**, not `sr_instance_id` — there is no `sr_instance_id`
> field on the entity. `sr_instance` real fields: `id`, `entity_reference_id`,
> `entity_type`, `payload` (the SR's dynamic form-context object,
> `Record<string, unknown>` — varies per SR), `current_status`,
> `current_status_since`, `current_task`, `sr_definition`, `sr_number`,
> `workflow_id`, `origin`, `priority`, `owner`, `tasks`, `targets`. There is
> **no** `data`, `bo_instance_id`, `client_id`, `account_id`, or `draft` field —
> any client/account context lives **inside `payload`** (e.g.
> `payload.client_id`, `payload.account_id`). Never invent a field name.

---

## 4. Two start modes — and where the form's prefill data comes from

The form is prefilled from **one of two sources**, depending on whether a draft
already exists. They do **not** merge — **the persisted `payload` wins**.

| Mode | You have | Prefill source | Returns |
|---|---|---|---|
| **Resume / reopen** | an `srInstanceId` (`id`) | the platform **`sr_instance` read** query, keyed by `id` | the saved `payload` (the SR's persisted form-context) |
| **New / from start** | an `entityReferenceId` (boInstanceId) | the **`sr_<workflow_name>`** read query over the **master entity**, keyed by `entityReferenceId` | the master record's **current** field values |

### A. New SR (no `srInstanceId`)
1. Read `entity_reference_id` from the URL (it was chosen on a separate page or
   the platform deep-link — §3). If it's missing, show a short empty state — do
   **not** render a picker.
2. Read the **master entity** (the SR's root business object — see §5) by
   `id == entityReferenceId` using the `sr_<workflow_name>` query, and
   **prefill the form with those current values**.
3. The SR instance is **created up front** via `useSrCreate` from the
   dashboard "Create SR" popup (§6) — passing `entityReferenceId` (boInstanceId)
   + `entityType` (root BO name) + the mandatory **`payload`** (the dynamic
   form-context: `client_id`, `account_id`, any initial form values) and
   capturing the returned `srInstanceId`. The `payload` is persisted on
   `sr_instance.payload`. Subsequent Save-as-draft calls patch that instance by
   `srInstanceId`.

### B. Resume / reopen (you have an `srInstanceId`)
1. Load the SR via the platform **`sr_instance` read** saved query, keyed by
   `id`. It returns `payload`, `entity_reference_id`, `entity_type`,
   `current_status`. This is the **round-trip**: an SR table row holds only the
   `srInstanceId`, so reopening reads `sr_instance.payload` back to restore the
   context (`payload.client_id`, `payload.account_id`, prior form values).
2. Prefill the form from `payload`. **Do not** re-read the master entity — the
   persisted `payload` is authoritative.
3. Save-as-draft updates the row via the platform **patch** query (§6).

---

## 5. The form's data saved query — `sr_<workflow_name>`

For the **new / from-start** mode (§4.A), the form is prefilled from the SR's
**master entity** — *not* from `sr_instance`. Each SR needs a **single-object
read** saved query that reads that master entity by `entityReferenceId`
(boInstanceId), named with the `sr_` prefix + the workflow name:

```
workflow `address_change`  →  saved query `sr_address_change`
  reads the CLIENT (master) by id == entityReferenceId, returning the
  current address fields to prefill the form.
```

### Find the master entity and the field set first

1. **Master entity** = the SR's root business object. Read it from the SR's
   `sr_definition.root_business_object` (`src/types/entities/sr_definition.ts`).
   For an address change this resolves to the **client** entity (current
   address lives on the linked `address` entity).
2. **Field set** = the fields the SR edits, read from the master entity's type
   file (`src/types/entities/`). Include **both scalar and link fields** that
   belong to what the SR edits — **do not skip a field just because it's a
   link.** For an address-change-style SR that means the address's scalars
   (`line_1`, `line_2`, `city`, `state_or_province`, `postal_code`, …) **and**
   its link fields (e.g. `country`).
   - A **scalar** field (its type is `string`/`number`/`boolean`/etc.) is
     selected as `field: true`.
   - A **link** field (its type is another entity, e.g. `country?: Country`) is
     **never selected raw** — nest it and pick its real leaf fields from *that*
     entity's type file (e.g.
     `country: { selectsingle: { id: true, full_name: true } }`). Selecting a
     link raw, or guessing a leaf that doesn't exist (e.g. `country.name` when
     `Country` only has `full_name`/`short_name`/`code`), fails. See
     `src/entities/QUERY-DSL.md` → "Nested linked entities".

   Build this **complete** set (scalars + resolved links) first, **then confirm
   the list with the user** before creating the query — don't present a partial
   set that omits link fields, and don't show a field you haven't confirmed
   exists in its entity's type file. (If the submit workflow happens to declare
   inputs in `workflows.catalog.md`, use them to scope which fields; most SR
   workflows declare none, so the master entity is the source.)

### Find the query, then create only if missing

3. Grep the catalog for the exact name:
   ```sh
   grep -nE "sr_<workflow_name>" src/types/catalogs/saved-queries.catalog.md
   ```
   If it exists, use it via `useSavedQuerySingle('sr_<workflow_name>', { input: { id: boInstanceId } })`.
4. **If absent, create it** (§7) as a **single-object read over the master
   entity**, filtered by the bare placeholder **`id == $id`** (NOT `${id}`,
   NOT quoted — see QUERY-DSL.md §3 "Parameterized filter"), selecting the
   confirmed fields. The `$id` binds to the input you pass at read time:
   `useSavedQuerySingle('sr_<workflow_name>', { input: { id: boInstanceId } })`.
   Example `query` body:
   ```json
   { "client": { "selectsingle": { "id": true, "line_1": true, "city": true },
                 "filter": "id == $id" } }
   ```
   Pass **`entityAppKey` = the MASTER entity's `<ENTITY>_APP_KEY`**
   (e.g. `CLIENT_APP_KEY` from `src/types/entities/client.ts`) — **not**
   `SR_INSTANCE_APP_KEY`. Set `isSingle: true`.

Do **not** create read/insert/patch queries for `sr_instance` itself — those
are platform-provided (§6). The only query you create is this per-SR
`sr_<workflow_name>` master-entity read.

---

## 6. Create, Save-as-draft, and Submit

An SR form has three moments: **Create** the instance, optionally **Save as
draft**, and **Submit**.

### Create the SR instance → `useSrCreate` (`/v1/sr/execute/{name}`)

Creating a brand-new SR no longer inserts an `sr_instance` row via a saved
query — **`insert_sr_instance` is not needed.** Instead, the dashboard
**"Create SR" popup** calls **`useSrCreate('<sr_workflow_name>')`**, which
POSTs to `/v1/sr/execute/{name}` and returns the mandatory `srInstanceId`.

**Three inputs are mandatory:**

- `entityReferenceId` (the `boInstanceId`) → `sr_instance.entity_reference_id`.
- `entityType` (the SR's **root business object name** =
  `sr_definition.root_business_object`, e.g. `account`) →
  `sr_instance.entity_type`.
- **`payload`** — the SR's **dynamic form-context object** (`client_id`,
  `account_id`, and any initial form values). Its shape **varies per SR**
  (`Record<string, unknown>`). It is persisted to `sr_instance.payload`, so a
  later SR table row (which holds only the `srInstanceId`) can read it back to
  restore the context (see §4.B round-trip).

The full request body sent to `/v1/sr/execute/{name}`:

```json
{
  "srInstance": {
    "entity_reference_id": "832c4049-39ba-43aa-b909-df173a59c153",
    "entity_type": "account",
    "payload": { "client_id": "<selected client_id>", "account_id": "<selected account_id>" }
  },
  "arguments": {}
}
```

```tsx
import { useSrCreate } from '@/hooks';

const createSr = useSrCreate('<sr_workflow_name>');

// On the "Create SR" popup confirm (user action, never on mount):
const { srInstanceId } = await createSr.mutateAsync({
  entityReferenceId: accountId,  // boInstanceId — MANDATORY
  entityType: 'account',         // root BO name — MANDATORY
  payload: {                     // dynamic form-context — MANDATORY
    client_id: selectedClientId,
    account_id: selectedAccountId,
    // …any initial form values to persist on sr_instance.payload
  },
});
// → keep srInstanceId; it is MANDATORY for every step below.
```

### Save as draft → `sr_instance` patch

Once the instance exists (you hold `srInstanceId`), Save-as-draft persists
partial edits to **`sr_instance.payload`** via the platform **patch** saved
query through **`useSavedQueryMutation`** (a flat-body POST to
`/saved-queries/{name}/execute`). The patch query writes the `payload` column,
so the body key matches its `$body.payload` placeholder:

```tsx
import { useSavedQueryMutation } from '@/hooks';

const patchDraft = useSavedQueryMutation('<sr_instance_patch_query>');

await patchDraft.mutateAsync({ id: srInstanceId, payload: formValues });
```

> Save-as-draft is **not validated** — drafts are intentionally partial.
> The persisted field is **`payload`** (not `data` — that column no longer
> exists on `sr_instance`).

### Submit → `useSrSubmit` (`/v1/signals/{srInstanceId}/trigger`)

Submit replaces the old named `sr_submit` workflow. It is keyed by the
**mandatory `srInstanceId`** (no workflow name is involved) and carries the
form values as the body:

```tsx
import { useSrSubmit } from '@/hooks';

const submit = useSrSubmit(srInstanceId);   // srInstanceId from useSrCreate

await submit.mutateAsync(formValues);
```

Submit should run **only on the user's click**, never on mount, and only
after local validation passes (§8). Field-level validation errors come back
in the response — map them with `mapWorkflowErrors` (§9).

---

## 7. Creating the `sr_<workflow_name>` data query

Creation uses the **`create_saved_query` tool** — it creates the query on
Phoenix **and** regenerates the catalog + types. This is **not** the
`fetch:saved-queries` script (that only refreshes queries that already exist).

Standard flow (same contract as any saved query — see `CLAUDE.md`):

1. **Resolve the master entity** = `sr_definition.root_business_object` (e.g.
   `client`). Read its `<ENTITY>_APP_KEY` from `src/types/entities/<entity>.ts`
   (e.g. `CLIENT_APP_KEY`).
2. **STOP and ASK which app** the query lives in (the current app's
   `app_definition_key` from `src/types/catalogs/app.md`, or the master entity's
   `<ENTITY>_APP_KEY`). Wait for the answer.
3. **Build the field set FROM the schema first, then confirm with the user.**
   Derive candidate fields from the submit workflow's inputs when it declares
   them. **If the workflow declares no inputs, do NOT free-form field names
   from convention** — open the master entity's type file (and, for every link
   field you traverse, that linked entity's OWN file) and build the list
   **only** from fields that actually exist there. **Include link fields the SR
   edits — don't skip a field because it's a link** (see §5): select a scalar
   as `field: true`, and a link field nested with real leaf fields from the
   linked entity (`country: { selectsingle: { id: true, full_name: true } }`),
   never raw and never with a guessed leaf. **Only then** present this
   complete, schema-verified list to the user. **Never show the user a field
   you haven't confirmed exists in `src/types/entities/*`, and never present a
   set that drops link fields**; if unsure, ask.
4. **STOP before calling `create_saved_query`.** Re-verify every field in the
   final DynQL — at **every** nesting depth, including each linked entity's
   leaves — against `src/types/entities/*`. If any field cannot be found in its
   entity's type file, do NOT call the tool: fix it to the real field, or ask
   the user. An invented field is accepted at author time but silently
   removed/rejected by Phoenix when the query is opened or run.
5. Call `create_saved_query` with `name` (`sr_<workflow_name>`), `label`,
   an elaborate `description`, `query` (DynQL JSON string over the **master
   entity**, filtered by the bare placeholder `id == $id` (bound to the
   `entityReferenceId`/boInstanceId), selecting the confirmed fields
   — **every field, including nested link leaves, verified against its entity's
   generated type in `src/types/entities/`**), `appKey` (chosen in step 2),
   **`entityAppKey` = the master entity's `<ENTITY>_APP_KEY`** (e.g.
   `CLIENT_APP_KEY`, **not** `SR_INSTANCE_APP_KEY`), and `isSingle: true`.
6. The tool regenerates types and returns the hook to use.

---

## 7b. Sync the SR workflow model — `update_workflow_model`

The SR workflow validates Submit against its **`service_request_model`** — an
attribute schema stored on the workflow definition. After you create or change
the `sr_<workflow_name>` saved query, **sync that model** with the
**`update_workflow_model`** tool. Skipping this means the workflow has no schema
to validate the submitted form against.

> This sync is a **mandatory, automatic** part of building/updating an SR — the
> workflow can't validate submits without it. Do it as part of the flow; **don't
> ask the user for permission** to PATCH the model.

The tool builds `service_request_model` as **`[rootEntity, body, bodyStructure]`**
from the SR's **read** saved query:

- **`rootEntity`** (internal) → `component_reference: <app>.entity.<rootBO>` — the
  SR's root business object (derived from the read query's root, or pass
  `rootEntity`).
- **`body`** (input) → `component_reference: <app>.entity.<rootBO>` (the actual
  root entity).
- **`bodyStructure`** (internal) → the **read saved query's attributes** (entity
  `component_reference`s) **PLUS** the SR-only payload fields you pass via
  `extraFields`. `bodyStructure` must match the **full SR payload schema**.

```
update_workflow_model({
  workflowName: "address_change",
  savedQueryName: "sr_address_change",   // entity attributes → bodyStructure
  extraFields: [ /* one entry per SR-only key your buildSrPayload emits */ ],
})
```

- **Entity fields** come from the read query (real `component_reference`).
- **SR-only payload fields** aren't on any entity — pass them via `extraFields`
  (empty `component_reference`). The source of truth is **your `buildSrPayload`**:
  read the object it returns and add an `extraField` for every key that isn't an
  entity field. Don't work from a memorized list — derive it from the payload
  builder so it can't drift. A name already on the query isn't duplicated.

> ⚠️ **Every field you add to the SR form/payload MUST be reflected in the model
> — re-run `update_workflow_model`.** `bodyStructure` has to match the full
> submitted payload: add an **entity** field via the saved query, an **SR-only**
> field via `extraFields`, then re-sync. If a submitted field isn't in
> `bodyStructure`, the workflow can't validate/fill it. So any time you add a
> field to the wizard (a new capture field, a new payload key), update the
> workflow model in the same change.

### Add / edit / delete an SR field

The PATCH **replaces the whole** `service_request_model`. To change an entity
field, change the **saved query** and re-sync. To change an SR-only field, adjust
`extraFields` (pass the FULL set every call). Re-call
`update_workflow_model({ workflowName, savedQueryName, extraFields })`.

---

## 8a. Choose the form layout — flat (default) vs wizard

Decide the shell from the field set resolved in §5, **before** writing JSX:

- **Single set of fields → FLAT form (the default).** Header (title + subtitle)
  → an optional "Request for" context Card → one or two Cards of fields → a
  footer with `Save as draft` (tertiary) + `Submit` (gold primary). No step
  rail, no `Progress`, no "Save & Next". **Address Change is this case.** Most
  SRs are.
- **2+ genuinely ordered steps → WIZARD.** Only when the workflow's inputs
  naturally split into sequential stages that benefit from being shown one at a
  time (e.g. Raise Cash: *Enter Amount* → *Review & Submit*). Then adopt a wizard
  chrome: a left step rail + `Progress` (gold fill) + a `bg-secondary` summary
  header strip + `Back` / `Save & Exit` / `Save & Next` footer.

Don't manufacture steps to justify the wizard — a one-step form must **not**
render a "Step 1 of 1" rail. When unsure, default to flat. Either way the
validation (§8), draft (§6), and submit (§9) wiring is identical; only the
surrounding layout differs.

**Every SR form includes a Notes field.** Regardless of layout, render a
free-text **`Textarea`** labelled `Notes (optional)` alongside the SR's own
fields (on the entry step for a wizard). It is **always optional** — declare it
`.optional()` in the zod schema, never gate Submit on it, and persist it in the
SR's `payload` (§6) like any other field (e.g. a `notes` key). Don't
invent a different name or make it required.

## 8. Client-side validation — before submit

Validate the form **locally** before it ever reaches the submit trigger
(`useSrSubmit`). The SR still validates server-side (§9), but a pre-submit
check gives instant inline errors and avoids a round-trip on obviously-invalid
input.

Use the **same stack the starter already uses** (`src/login/login.tsx` is the
reference): `zod` + `react-hook-form` + `@hookform/resolvers/zod`. All three are
installed — do not add a library.

### Build the schema from the SR's field set — don't invent rules

The zod schema mirrors the **exact field set resolved in §5** — submit-workflow
inputs first; the **master entity's** types when the workflow declares no inputs.
Reuse the real field names; never add a field or a rule that isn't backed by the
schema.

Rule derivation:

- **Workflow input declared required** → required rule (`z.string().min(1, …)`,
  or the typed equivalent).
- **Master-entity field type** → matching zod type: `string` → `z.string()`,
  `number` → `z.number()` (or `z.coerce.number()` for an `<input>` value),
  `boolean` → `z.boolean()`, an `Enumeration` field → `z.enum([...])` built from
  its `*_VALUES` const in `src/types/enumerations/<name>.ts` (don't hand-list
  values). A field the entity marks **optional** (`field?:`) → `.optional()`.
- **Link field the SR edits** → validate the **id leaf**, not the object
  (e.g. `country` → require `country.id` with `z.string().min(1, …)`), matching
  the nested leaf you selected in §5.

### Wire it, and gate Submit on validity

```tsx
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';

// Field set + rules from §5 (workflow inputs → master entity).
const srSchema = z.object({
  line_1: z.string().min(1, 'Address line 1 is required'),
  line_2: z.string().optional(),
  city: z.string().min(1, 'City is required'),
  // enum from src/types/enumerations/*, link id leaf, etc.
});
type SrFormData = z.infer<typeof srSchema>;

const { register, handleSubmit, setError, clearErrors, formState: { errors } } =
  useForm<SrFormData>({ resolver: zodResolver(srSchema), defaultValues: prefill });

// Submit runs ONLY when the local schema passes — never call the trigger
// with a locally-invalid form. Submit on click only, never on mount.
const onSubmit = handleSubmit(async (values) => {
  const resp = await submit.mutateAsync(values);   // useSrSubmit(srInstanceId)
  applyErrors(mapWorkflowErrors(resp));   // server errors merge in — see §9
});
<form onSubmit={onSubmit}> … </form>
```

Render inline errors via `errors.<field>.message` exactly as `login.tsx` does.

- **Save-as-draft is NOT validated.** Drafts are intentionally partial (§4, §6)
  — never block a draft write on the schema. Only **Submit** is gated.
- **Precedence / merge:** client (zod) errors show first; on submit the
  **server** errors from §9 (`mapWorkflowErrors`) merge in and **win per field**
  via `setError`. **Clear** a field's error on edit (`clearErrors('<field>')`).
- **Ship a colocated test** for the schema (valid, invalid-required,
  edge cases — empty/whitespace, bad enum), same as the `mapWorkflowErrors` test.

---

## 9. Validation errors → fields (server-side)

The submit trigger returns field-level validation errors. `useSrSubmit` does
**no** error normalization — you must inspect the response yourself, in **both**
places:

- a **success** response can carry an embedded errors payload → check
  `submit.data` (e.g. `data.errors` / `data.validationErrors`);
- a **failure** rejects with the raw axios error → check
  `error.response?.data`.

Map each error to its field and render it inline on that field; collect any
errors that don't map to a known field into a **form-level summary**.

```tsx
// Pure helper — extract & colocate a test for it.
export function mapWorkflowErrors(
  resp: unknown,
): { fieldErrors: Record<string, string>; formErrors: string[] } {
  // read resp.errors / resp.validationErrors / resp.response.data.* ,
  // bucket by field name vs. unmapped. Return both.
}

const submit = useSrSubmit(srInstanceId, {
  onSuccess: (data) => applyErrors(mapWorkflowErrors(data)),
  onError:   (err)  => applyErrors(mapWorkflowErrors(err)),
});
```

Clear field errors when the user edits the field; re-run on each submit.

---

## 10. Worked example — Address Change

```
1. Resolve workflow: grep src/types/catalogs/workflows.catalog.md for "Service Request";
   match `address_change`. (Ambiguous → list + ask. None → no page.)
2. Entry: the page is opened with the ids in the URL —
   `?entity_reference_id=<id>` (new) or `?id=<srInstanceId>` (resume).
   The page does NOT pick the client; that happens on a separate page /
   the platform. No client DataTable, no "Add" button on this page.
   If neither param is present → short empty state, not a picker.
 3. Master entity + fields: address_change's sr_definition.root_business_object
    → CLIENT. Field set = address_change workflow inputs (workflows.catalog.md),
    confirmed with the user.
 3a. Layout (§8a): one set of address fields → FLAT form (header + context Card
    + address Card + Save-as-draft / Submit footer). NOT a wizard — there are no
    ordered steps, so no step rail / Progress / "Save & Next".
 4. Form data query: grep for `sr_address_change`. Present → use it.
    Absent → create_saved_query: single-object READ over CLIENT with
    "filter": "id == $id" (bare placeholder — NOT ${id}, NOT quoted),
    selecting the current address fields, with entityAppKey = CLIENT_APP_KEY
    (NOT SR_INSTANCE_APP_KEY), isSingle: true.
    Call: useSavedQuerySingle('sr_address_change', { input: { id: boInstanceId } }).
5. Prefill:
     new (no srInstanceId) → sr_address_change → client's CURRENT address.
     resume (have id)      → platform sr_instance read by id → payload (wins).
6. Create + Save as draft:
     create   → useSrCreate('address_change') from the "Create SR" popup,
                { entityReferenceId: boInstanceId, entityType: 'client',
                  payload: { client_id, account_id, …initial form values } }
                → persists sr_instance.payload; keep the MANDATORY srInstanceId
     draft    → useSavedQueryMutation(<sr_instance patch>) { id: srInstanceId, payload }
7. Client-side validation (§8): zod schema over the SAME field set as step 3
   — required line_1, city, state_or_province, postal_code, country.id;
   line_2 optional. Wire with useForm({ resolver: zodResolver(schema) }).
   Save-as-draft stays unvalidated; only Submit is gated.
8. Submit: handleSubmit gates it; useSrSubmit(srInstanceId).mutateAsync(values)
   runs only when the schema passes → POST /v1/signals/{srInstanceId}/trigger.
9. On submit result: mapWorkflowErrors(...) merges server errors over the
   client ones → inline field errors + form-level summary.
10. Register the route in src/PrivateApp.tsx (hideFromNav — it's reached
    with params, not from the sidebar):
      PrivateRoute({ path: '/sr/address-change',
                     element: <AddressChangePage />, hideFromNav: true })
11. register_screen: include root_component = the SR workflow name (e.g.
    "address_change", the useSrCreate(...) name) as a key in componentTree
    so the screen links to the SR workflow.
12. Ship a colocated *.test.ts covering the zod schema (valid/invalid/edge)
    + mapWorkflowErrors + any pure field-extraction helper (node env, no DOM).
```

---

## 11. Guardrails

- **The SR page is a FORM, not a list.** It receives `entity_reference_id` /
  `id` (srInstanceId) from the URL — it does **not** embed a client/candidate
  `DataTable` or an "Add" button to pick the business object. Picking happens on
  a separate page or via the platform deep-link. No target in the URL → short
  empty state, not a picker. Register the route `hideFromNav: true`.
- **No SR workflow match → no page.** Don't fabricate one.
- **Create + Submit are the two SR runtime hooks, not `sr_submit`.** Create via
  `useSrCreate('<sr_workflow_name>')` → `/v1/sr/execute/{name}` (returns the
  mandatory `srInstanceId`); submit via `useSrSubmit(srInstanceId)` →
  `/v1/signals/{srInstanceId}/trigger`. Do **not** use the old
  `useWorkflow('sr_submit')` path or create an `insert_sr_instance` query.
- **Three inputs are mandatory to create:** `boInstanceId`
  (→ `entity_reference_id`), `entityType` (root BO name), and **`payload`** (the
  dynamic form-context object → persisted on `sr_instance.payload`). The
  returned `srInstanceId` is mandatory for patch and submit.
- **Never create `sr_instance` read/patch queries** — they're platform-provided
  (`insert_sr_instance` is no longer needed — `useSrCreate` creates the
  instance). You only create the per-SR `sr_<workflow_name>` read query, and
  only when it's missing, after confirming fields with the user.
- **`sr_<workflow_name>` reads the MASTER entity, not `sr_instance`.** The
  master entity is `sr_definition.root_business_object`; filter it with the
  bare placeholder `"filter": "id == $id"` (NOT `${id}`, NOT quoted),
  `isSingle: true`, and pass the **master entity's** `<ENTITY>_APP_KEY` as
  `entityAppKey` (e.g. `CLIENT_APP_KEY`) — never `SR_INSTANCE_APP_KEY`.
- **Field set comes from the submit workflow's inputs**, confirmed with the
  user — not guessed from `sr_instance.payload` (which is untyped).
- **Validate fields against the generated schema BEFORE proposing them to the
  user, and AGAIN as a hard STOP before `create_saved_query`.** Every field in
  the `sr_<workflow_name>` DynQL must exist in `src/types/entities/*` at every
  nesting level — a link field resolves to another entity, so verify each
  linked entity's OWN type file before selecting its leaves; never assume a
  field name from convention. A field you can't find (at any depth) must never
  appear in your proposal OR the query; ask the user if unsure. Invented fields
  are accepted at author time but removed/rejected by Phoenix on open/run.
- **Include the link fields the SR edits — don't skip them.** A link field
  (e.g. `country` on an address) belongs in the field set; select it nested
  with real leaf fields from the linked entity (`{ selectsingle: { id, ... } }`),
  never raw and never omitted just because it's a link.
- **Prefill precedence: persisted `payload` wins.** If an `srInstanceId` exists,
  prefill from the platform `sr_instance` read (`payload`) and don't re-read the
  master entity. The master read is only for brand-new SRs (no `srInstanceId`).
  No merge.
- **Don't invent `sr_instance` fields.** Use `id`, `entity_reference_id`,
  `entity_type`, `payload`, `current_status`, `sr_definition`, `sr_number`,
  `workflow_id`. There is **no** `data`, `bo_instance_id`, `client_id`,
  `account_id`, `sr_instance_id`, or `draft` field — client/account context
  lives **inside `payload`**.
- **Creation is the `create_saved_query` tool, not a script.**
- **Sync the workflow model after creating/changing `sr_<workflow_name>`**
  (§7b) with `update_workflow_model({ workflowName, savedQueryName })` — it builds
  `service_request_model` as `[rootEntity, body, bodyStructure]`, where
  `bodyStructure.attributes` = the read query's attributes (with their entity
  `component_reference`s). Every SR field must live on the saved query. The PATCH
  replaces the whole model — to change a field, change the query and re-sync.
- **Draft patch uses `useSavedQueryMutation`** even if the catalog shows a read
  hook (body `{ id: srInstanceId, payload }` — writes `sr_instance.payload`).
- **Submit on click only**, never on mount. Always ship a colocated test for
  the pure helpers.
- **Validate client-side before submit (§8).** Gate `useSrSubmit` on a zod
  schema via `react-hook-form`/`zodResolver` — never call the trigger with a
  locally-invalid form. Save-as-draft stays **unvalidated** (drafts are partial).
- **Client-side rules come from the §5 field set** (workflow inputs → master
  entity types / enums), never invented. Optional entity fields → `.optional()`;
  a link field validates its **id leaf** (e.g. `country.id`), not the object.
- **Server errors win over client errors per field.** Show zod errors first;
  on submit merge `mapWorkflowErrors` (§9) via `setError`; clear on edit.
- **Ship a test for the zod schema** (valid / invalid-required / edge cases)
  alongside the `mapWorkflowErrors` test.
- **Link the screen to its SR workflow.** When calling `register_screen` for an
  SR page, pass `root_component` = the SR workflow name (the `useSrCreate(...)`
  name) inside `componentTree`. Normal (non-SR) pages omit it.
