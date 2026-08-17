# Layout & navigation

Customize the **app shell** (sidebar + header) and **gate nav items / routes**
by permission. **Read this whole file before touching anything layout-related.**

**The chrome is starter-owned. NEVER fork it.** Do not edit
`src/layouts/DefaultLayout.tsx`, never create a new `*Layout.tsx`, and never
patch `src/routes/types.ts` / `src/PrivateApp.tsx` to hide the sidebar, hide the
header, recolour the rail, or change the layout type. Everything here is done
via preferences, the app-owned `src/config/layout.ts`, or a route flag.

---

## 1. Layout chrome — two channels

The shell reads a resolved `LayoutConfig`. Precedence (highest last):

1. **Built-in defaults** — the stock look (`DEFAULT_LAYOUT_CONFIG`).
2. **App-owned static override** — `LAYOUT_OVERRIDE` in `src/config/layout.ts`.
3. **`App.Layout.*` preferences** — runtime, per org→app→tenant.

### Fields

| Concern | `LayoutConfig` field | `App.Layout.*` preference | Values |
|---|---|---|---|
| Show/hide sidebar | `sidebar` | `App.Layout.Sidebar` | `visible` \| `hidden` |
| Show/hide header | `header` | `App.Layout.Header` | `visible` \| `hidden` |
| Rail background | `sidebarColor` | `App.Layout.SidebarColor` | `#hex` (default `#1C1B20`) |
| Inactive icon/label | `sidebarTextColor` | `App.Layout.SidebarTextColor` | `#hex` (default `#C9CACD`) |
| Active icon/label | `sidebarActiveColor` | `App.Layout.SidebarActiveColor` | `#hex` (default `#BCA04F`) |
| Layout type | `variant` | `App.Layout.Variant` | `default` \| `compact` |
| Start rail collapsed | `defaultCollapsed` | `App.Layout.DefaultCollapsed` | `true` \| `false` |

`hidden` sidebar → header-only app. `compact` variant → always an icon-only
narrow rail (ignores the user's collapse toggle). `defaultCollapsed: true` opens
the `default` rail collapsed (icon-only) on first load but STILL expandable via
the Menu toggle — it's only the initial default; once the user toggles, their
choice is remembered and wins. Invalid values are ignored (fall back to the
lower layer).

### A. Static per-app default — `src/config/layout.ts`

Edit `LAYOUT_OVERRIDE` for a default that ships with the app (no preference, no
tool call). This is the **only** layout file you may edit.

```ts
// src/config/layout.ts
export const LAYOUT_OVERRIDE: Partial<LayoutConfig> = {
  sidebar: 'hidden',     // header-only app
  // header: 'hidden',
  // sidebarColor: '#0B0B0E',
  // variant: 'compact',
};
```

### B. Runtime, per tenant/org — `App.Layout.*` preferences

Set an `App.Layout.*` preference (tenant-wide or org-scoped) so the same app
looks different per tenant/org **without** a rebuild. These are **app-level**
preferences with a fixed `name` (not a `<page>.<component>.<property>` slot).
Use the `create_preference` tool with the literal `name` and
`preferenceTarget: "app"`; org-scope by passing the org's `id` (list `ORGS`
from `src/types/catalogs/org.catalog.md` — never guess an id). Preferences win over
`LAYOUT_OVERRIDE`.

> If the `create_preference` tool can only compose slot-style names, set the
> `App.Layout.*` preference from the platform preferences screen instead, or use
> `LAYOUT_OVERRIDE` for a static default. The runtime resolver
> (`src/config/use-layout-config.ts`) reads whichever exists.

### Example — "header only, remove the side menu"

- Static: `LAYOUT_OVERRIDE = { sidebar: 'hidden' }`, **or**
- Runtime: set preference `App.Layout.Sidebar = hidden`.

---

## 1b. Takeover pages — full-bleed vs. in-shell

Two per-route flags on `PrivateRoute` let a single page control its chrome
WITHOUT forking a layout. Use them **only for takeover flows** (wizards, review
ceremonies, e-sign, document viewers) — not as a general escape hatch.

| Need | Flag | Result |
|---|---|---|
| No rail, no header — page owns the whole viewport (auth-gated) | `layout: 'blank'` | Renders under `BlankLayout` — full-bleed, still behind `RequireAuth`. |
| Rail + header stay, but page owns the content box (no gutter) | `contentPadding: 'none'` | `DefaultLayout` drops `<main>`'s `p-6 pt-3` for this route only. |

```ts
// Full takeover (no chrome):
PrivateRoute({
  path: '/account-onboarding/open', label: 'Open Accounts',
  icon: 'icon_-Tb_wallet', element: <OpenAccountsPage />,
  hideFromNav: true, layout: 'blank',
});

// In-shell takeover (chrome stays, page bleeds to the frame):
PrivateRoute({
  path: '/onboarding/summary', label: 'Summary',
  icon: 'icon_-Tb_list', element: <OnboardingSummaryPage />,
  hideFromNav: true, contentPadding: 'none',
});
```

**Page contract for `contentPadding: 'none'`:** the page root should be
`h-full flex flex-col`. `<main>` is a flex child with a definite height, so the
page gets full height and owns its own inner scroll regions (`<main>`'s
`overflow-y-auto` simply never engages). This replaces the old
`-m-6 h-[calc(100%+3rem)]` bleed hack — which is also **subtly wrong**: `<main>`
is `p-6 pt-3` (24px sides/bottom, **12px** top), so `-m-6` over-pulls the top by
12px. Use the flag, not negative margins.

Both flags are opt-in per route and default to normal chrome. Keep colours /
variant in the preference channels above; don't reach for `blank` just to
restyle the rail.

---

## 2. Gate a nav item / route by permission

To restrict a page to authorized users, pass `permission: '<screen-slug>'` to
`PrivateRoute` in `src/PrivateApp.tsx`. `<screen-slug>` is the screen name — the
page's URL slug (the route `path` without `/`), the SAME name used for
`register_screen` / `buildSchema` (e.g. `clients`, NOT `ClientListPage`).

```ts
PrivateRoute({
  path: '/clients', label: 'Clients', icon: 'icon_-Tb_users',
  element: <ClientListPage />, permission: 'clients',
});
```

Behaviour:

- **Opt-in.** Omit `permission` → never gated (default; the item always shows).
- **Hidden from the sidebar** when the user lacks access (`isNavItemVisible`).
- **Route blocked** too — the element is wrapped in `<PermissionGuard>`, so
  deep-linking the path is denied, not just hidden from nav.
- Allowed iff the user has `read`/`write` on
  `<appDefinitionKey>.screen.<ScreenName>`. Fails open while permissions load
  (avoids a flash), then re-checks.

**Granting access** uses the existing tooling — a user needs read/write on that
screen (or a `screen_component` grant). See `COMPONENT-PERMISSION.md` and
`create_component_permission`. This file only wires the gate; it does not grant.

---

## 3. Guardrails

- Never fork `src/layouts/` or create a `*Layout.tsx` for chrome changes — use
  preferences, `src/config/layout.ts`, or the route `permission` flag.
- `value` for an `App.Layout.*` preference is always a string; colours must be
  `#hex`; enums must match the allowed values exactly (else ignored).
- Nav `permission` is the screen name, not a path or a label.
- Org-scoped layout/permission needs a real org `id` from `ORGS` — never guess.
