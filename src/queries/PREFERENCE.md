# Component preferences

Set a **preference** — the default label / visibility / style / variant for a
customizable component — **tenant-wide** or scoped to a single **org**. Use the
**`create_preference`** tool; the agent has no HTTP/bash, the tool makes the
Phoenix call.

**Read this whole file before setting a preference.** Follow the order; don't
guess component names or org ids.

A preference resolves onto a schema slot rendered with a `config` prop (see
"Customizable components" in `CLAUDE.md`). At runtime the page reads merged
preferences and applies them; an org-scoped preference overrides the
tenant-wide one for users in that org.

---

## 1. When to use this

The user wants to set the **default appearance/behavior of a specific
component** for everyone (tenant) or for an org — e.g. "make the overview card
compact", "hide the export button by default for the East branch", "default the
status badge variant to warning".

This is a default value, not access control. To control *who can see* a
component, use `create_component_permission` (`COMPONENT-PERMISSION.md`) instead.
Saved DataTable views use a different four-segment `table_preference` contract;
use `upsert_shared_table_views` as documented in `TABLE.md`, not this tool.

---

## 2. The flow (ask → scope → list orgs → confirm → create)

1. **Ask the component details:**
   - **page** — the `register_screen` / `buildSchema` page name (e.g. `account-overview`)
   - **component** — a slot key in that page's `<Page>.schema.ts` (e.g. `card_18`)
   - **property** — the leaf being set (e.g. `boxType`, `variant`, `visible`, `label`, `backgroundColor`)
   - **value** — a string (booleans as `'true'`/`'false'`; enums as the option value, e.g. `compact`)
   Don't guess — the slot must exist in the page's schema, flagged with a `config` prop.
   - **Raw HTML supports text only.** A raw-HTML element (a `text` slot / plain
     `<div>`/`<span>`/heading) can only take a **text** preference (its label /
     content). It does **not** support style or other component props
     (`variant`, `visible`, `backgroundColor`, `fontSize`, …). If the user wants
     to set a style or non-text property on a raw-HTML region, **ask them to
     wrap it in a `<Card config={SCHEMA.slot}>`** and set the preference on the
     Card slot instead.
2. **Ask the scope:** tenant-wide or a specific org?
3. **If org:** list the orgs from `ORGS` (`src/types/catalogs/org.catalog.md`) **nested by
   level** — use `ORG_LEVELS` (`org-levels.catalog.md`, `level_order`) for the
   level order and each org's `level` + `unique_path` (a dotted ancestry path
   like `00000.0003`) / parent to show the hierarchy. The user picks → that
   org's `id` is `orgId`. Never guess an org id.
4. **Confirm** the component, property, value, and scope (tenant or which org).
5. Call `create_preference`.

---

## 3. The tool

`create_preference` parameters:

| Param | Meaning |
|---|---|
| `pageName` | the page/screen name (name `<page>` segment + `component_id`) |
| `componentName` | the schema slot key (name `<component>` segment) |
| `property` | the leaf property (name `<property>` segment) |
| `value` | the value as a **string** |
| `scope` | `"tenant"` or `"org"` |
| `orgId` | required when `scope === "org"` (the org's `id`) |
| `category` | optional, defaults to `"Style"` |
| `preferenceTarget` | optional, defaults to `"screen"` |
| `displayType` | optional, defaults to `"select"` |
| `disabled` | optional, defaults to `false` |

The tool resolves the app itself from `src/types/app.generated.ts` — you pass
no app key. It reads `APPLICATION.name` for the **`X-Jiffy-App-Name`** header
(how the endpoint resolves the app — same as the read path) and
`APPLICATION.id` for the body's `app_id` (an ObjectId, **distinct from**
`app_definition_key`). It POSTs to `POST /api/internal/preferences` (tenant) or
`POST /api/internal/preferences?org_id=<orgId>` (org) — internal path, header
auth, no bearer. **`create_preference` returns the new preference `id`** — keep
it to update or delete the preference later.

### Update / delete an existing preference

Both take the preference **`id`** (from a prior `create_preference` result, or
from the platform's preferences screen — never guessed):

- **`update_preference`** — change an existing preference. Takes `preferenceId`
  plus the same component parts as create (`pageName`, `componentName`,
  `property`, `value`, optional `category`/`preferenceTarget`/`displayType`);
  the tool recomposes the name + body and `PUT`s to `/api/preferences/<id>`
  (the body carries the `id`).
- **`delete_preference`** — remove a preference. Takes only `preferenceId`;
  `DELETE`s `/api/internal/preferences/<id>`.

Both resolve the app from `app.generated.ts` and use the same
`X-Jiffy-App-Name` header auth as create.

---

## 4. Preference name model

The tool composes the name:

```
App.<Target>.<page>.<component>.<property>
e.g.  App.Screen.account-overview.card_18.boxType
```

- `<Target>` = `preferenceTarget` capitalized (`screen` → `Screen`).
- `<page>` = `pageName` (also sent as `component_id`).
- `<component>` = `componentName` (the schema slot).
- `<property>` = the leaf prop.

Body example (tenant-wide):

```json
{
  "name": "App.Screen.account-overview.card_18.boxType",
  "value": "compact",
  "category": "Style",
  "preference_target": "screen",
  "display_type": "select",
  "disabled": false,
  "app_id": "<APPLICATION.id>",
  "component_id": "account-overview"
}
```

For an org-scoped preference, the same body is POSTed with `?org_id=<orgId>`.

> **App layout / chrome** (hide the sidebar/header, recolour the rail, switch
> the layout variant) uses a separate set of **app-level** `App.Layout.*`
> preferences — see **`src/config/LAYOUT.md`**. This file covers per-component
> preferences only.

---

## 5. Guardrails

- **Component must be a real schema slot** with a `config` prop on the page; the
  property must be a customizable one (a `ComponentConfig` field like
  `label`/`visible`/`variant`, an allowed style prop, or the component's own
  prop). Don't set a preference for a name that isn't in the schema.
- **Raw HTML / `text` slots support a TEXT preference only** — not style or
  other props. To set a style/variant/visibility preference on a raw-HTML
  region, wrap it in a `<Card config={SCHEMA.slot}>` and set the preference on
  the Card slot.
- **`value` is always a string** — booleans as `'true'`/`'false'`.
- **Org scope needs a real `orgId`** from `ORGS`; omit `org_id` entirely for
  tenant-wide. Never guess an org id — list and let the user pick.
- The tool sources `app_id` from `APPLICATION.id`; the app header uses
  `APPLICATION.name`. `app_id` and `app_definition_key` are different ids.
- **Do not use this tool for saved table views.** Use
  `upsert_shared_table_views`; it owns the `App.Screen.<page>.<componentId>`
  name, `table_preference` type, list serialization, and safe create/update.
- One preference per call (one component property + scope). Repeat for more.
