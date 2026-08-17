# Component permissions

Grant a **screen_component** permission to a **role** or a **permission-group**,
so a customizable component is shown/usable only for the allowed audience. Use
the **`create_component_permission`** tool — the agent has no HTTP/bash; the
tool makes the Phoenix call.

**Read this whole file before granting a permission.** Follow the order and
don't guess ids or component names.

A `screen_component` permission gates a schema slot flagged `permission: true`
(see "Customizable components" in `CLAUDE.md` / the `config` prop + per-page
schema). An unflagged slot is never gated. At runtime the page reads the user's
allowed set via `/api/permissions` (`src/queries/use-permissions.ts`) and hides
components that aren't allowed.

---

## 1. When to use this

The user wants to control **who can see/use a specific component** on a page
(e.g. "only Admins can use the Delete button", "hide the export action for the
read-only group"). That's a per-component grant to a role or group.

For whole-page access use `<PermissionGuard>` instead — this tool is for a
single component slot.

---

## 2. The flow (ask → list → confirm → create)

1. **Ask the component details.** Which **page** (the `register_screen` /
   `buildSchema` page name, e.g. `ClientListPage`) and which **component slot**
   (a key in that page's schema, e.g. `deleteBtn`). Don't guess these — the
   component must exist as a slot in the page's `<Page>.schema.ts`.
   - **Only registered customizable components can be permissioned.** A raw HTML
     element (`<div>`, `<span>`, `<section>`, a plain `<button>`, …) has no
     schema slot, so it **cannot** be a permission target. If the user wants to
     gate a raw-HTML region, **ask them to wrap it in a `<Card config={SCHEMA.slot}>`**
     with a `permission: true` slot, then grant against that Card slot. Never
     invent a slot name for raw HTML.
2. **Ask the target type:** apply to a **role** or a **permission-group**?
3. **List the candidates** and let the user pick:
   - roles → `ROLES` (`src/types/catalogs/roles.catalog.md`)
   - groups → `PERMISSION_GROUPS` (`src/types/catalogs/permission-groups.catalog.md`)
   Show each by `name` + `id`; the chosen `id` is the target. Never guess an id.
4. **Resolve the app key** from `APPLICATION.app_definition_key`
   (`src/types/app.generated.ts`, or `app_definition_key` in `src/types/catalogs/app.md`).
5. **Confirm** the component, the target (role/group name), and the action with
   the user, then call `create_component_permission`.

---

## 3. The tool

`create_component_permission` parameters:

| Param | Meaning |
|---|---|
| `appKey` | app `app_definition_key` (the `<appKey>` resource segment) |
| `pageName` | the `register_screen` / `buildSchema` page name → `parent_resource_id` |
| `componentName` | the schema slot key → `resource` |
| `targetType` | `"role"` or `"group"` |
| `targetId` | the role / permission-group `id` from the catalogs |
| `action` | optional, defaults to `"write"` (the screen_component gate) |
| `isActive` | optional, defaults to `true` |

The tool builds the resource strings and POSTs to the right endpoint:

- **role** → `POST /api/internal/roles/permissions` (body has `role.id` +
  `permission: "allow"`)
- **group** → `POST /api/internal/permission-groups/{id}/permissions` (body has
  `permission_group.id`, no `permission` field)

### Revoke a component permission

Use **`delete_component_permission`** to remove a grant. It deletes by the
permission **ROW id**, not the resource — and `create_component_permission`
does **not** return that id, so you get it from the platform's **permissions
screen** (never guess it). Only delete **after the user confirms** which grant
is being removed.

`delete_component_permission` parameters:

| Param | Meaning |
|---|---|
| `appKey` | app `app_definition_key` (for the `x-jiffy-app-definition-key` header) |
| `targetType` | `"role"` or `"group"` (picks the endpoint) |
| `targetId` | for `"group"`: the group id (the `{groupId}` path segment). Ignored for `"role"` |
| `permissionId` | the permission ROW id (from the permissions screen) |

Endpoints (delete by row id; 404 is treated as already-gone / success):

- **group** → `DELETE /api/internal/permission-groups/{groupId}/permissions/{permissionId}`
- **role** → `DELETE /api/internal/roles/permissions/{permissionId}` (flat,
  mirroring the flat role create; the group path nests under its id)

---

## 4. Resource model

```
resource:             <appKey>.screen.<componentName>
resource_type:        screen_component
parent_resource_id:   <appKey>.screen.<pageName>
parent_resource_type: screen
action:               write   (default)
```

- `<appKey>` = `app_definition_key`.
- `<pageName>` = the `register_screen` page name (`buildSchema` arg 1).
- `<componentName>` = a slot key from the page's `buildSchema` / the
  `componentTree` passed to `register_screen`.

You pass `pageName` + `componentName` (+ `appKey`); the tool composes the
`resource` / `parent_resource_id` strings — don't hand-build them.

---

## 5. Guardrails

- **Component must be a real schema slot** flagged `permission: true` for the
  gate to apply at runtime. Don't grant against a name that isn't in the page's
  schema.
- **Raw HTML can't be permissioned.** Only registered customizable components
  (with a `config` slot) are valid targets. To gate a raw-HTML region, wrap it
  in a `<Card config={SCHEMA.slot}>` (slot flagged `permission: true`) and
  grant against the Card slot.
- **Never guess** the role/group `id` or the component name — list from the
  catalogs / read the page schema and confirm with the user.
- **Role vs group bodies differ** (role carries `permission: "allow"`; group
  omits it) — that's handled by `targetType`; just pass the right one.
- This grants one component to one target. Repeat the tool for more
  components/targets.
- **Deleting needs the permission row id** (from the permissions screen) — and
  the group id too for a group grant. `create_component_permission` doesn't
  return the row id; never guess it. Confirm with the user before deleting.
