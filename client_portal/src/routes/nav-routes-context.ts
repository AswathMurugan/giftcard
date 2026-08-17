/**
 * Context that carries the cloned app's nav-eligible routes from
 * `PrivateApp` (agent-owned) down to `DefaultLayout`'s sidebar
 * (starter-owned).
 *
 * The agent declares routes inside `src/PrivateApp.tsx` via the
 * `PrivateRoute(...)` helper; `PrivateApp` derives the nav-eligible
 * subset (everything that isn't `hideFromNav`) and provides it via this
 * context. `DefaultLayout` consumes it through `useContext`, so the
 * sidebar renders the right items without `DefaultLayout` needing to
 * know about the route shape directly.
 *
 * Default value is an empty array — scaffolding routes
 * (`/showcase`, `/test-results`, `/error-boundary-demo`) mount under a
 * separate `DefaultLayout` instance with their own `navItems` prop (see
 * `src/routes/index.tsx`'s `scaffoldingRoutes()` branch) and don't
 * touch this context.
 */
import { createContext, useContext } from 'react';
import type { ContentPaddingKey } from './types';

/**
 * A cross-app navigation target on a nav item. When present, the sidebar item
 * navigates (hard-nav) to another related app's screen instead of an in-app
 * route. Resolved at click time from `related_applications` (see
 * `src/config/cross-app-nav.ts`). Only screens with NO required nav variables
 * may be side-menu items — see docs/CROSS-APP-NAVIGATION-PLAN.md §5.4.
 */
export interface ExternalNavTarget {
  /** Target app's `app_definition_key` (from the related-screens catalog). */
  appKey: string;
  /** Target screen name (the deep-link page id). */
  screen: string;
  /** Optional static nav variables → query params. */
  navVars?: Record<string, string>;
}

/**
 * How a nav item opens its target. Mirrors the `menu_config.open_in` column.
 *  - `current_tab` — in-app `NavLink` (local) / `navigateCrossApp` (cross-app) /
 *    whole-page `<a href>` (link);
 *  - `new_tab` — `<a target="_blank" rel="noopener noreferrer">`;
 *  - `new_window` — `window.open(url, key, 'width=…,height=…,noopener')`.
 */
export type OpenIn = 'current_tab' | 'new_tab' | 'new_window';

export interface NavRouteEntry {
  path: string;
  label: string;
  /**
   * Nucleo glyph class for the nav icon, e.g. `'icon_-Tb_home'`. Rendered as
   * `<i className="icon …" />`. Look up classes in
   * `src/assets/fonts/nucleo/ICONS.md`.
   */
  icon: string;
  /** Optional short text shown in tooltips / helper menus. */
  description?: string;
  /** Hide from the helper menu even though it is in the sidebar. */
  hideFromHelper?: boolean;
  /**
   * Optional screen-permission gate (the screen name). When set, the sidebar
   * hides this item unless the user has read/write on
   * `<appDefinitionKey>.screen.<permission>`.
   */
  permission?: string;
  /**
   * When set, this nav item links to ANOTHER app's screen (cross-app). The
   * sidebar renders it as a hard-nav link resolved from `related_applications`.
   * `path` is still required (used as the item key) but not routed.
   */
  external?: ExternalNavTarget;
  /**
   * When set, this nav item opens a plain external URL. The sidebar renders it
   * as an `<a href>` (target per `openIn`). Mutually exclusive with `external`.
   * `path` is still the React key. Injected by `mergeMenu` from a `link` item.
   */
  href?: string;
  /**
   * When set, this nav item is a QUICK-PANEL (flyout) trigger. The sidebar looks
   * up the flyout content in the flyouts registry by this id and renders a
   * `SidebarFlyoutItem`. Injected by `mergeMenu` from a `flyout` menu item.
   */
  flyoutRef?: string;
  /** How the item opens its target. Defaults to `current_tab`. */
  openIn?: OpenIn;
  /** `new_window` popup width (px). */
  windowWidth?: number;
  /** `new_window` popup height (px). */
  windowHeight?: number;
  /**
   * Nested child items (depth-2). Present only on a top-level group node; the
   * sidebar renders a collapsible group. The menu tree is clamped to 2 levels
   * (see `src/routes/build-menu-tree.ts`), so children never nest further.
   */
  children?: NavRouteEntry[];
  /**
   * Optional sort weight. Code routes carry none (their array position is the
   * order); a tenant `menu-config` entry injects one to re-position an item
   * during `mergeMenu`. Lower sorts first. See `src/routes/merge-menu.ts`.
   */
  order?: number;
}

/**
 * Known `menu_config.link_type` values. Treated as INFORMATIONAL only — the
 * seeded data shows `link_type` is not a reliable kind discriminator (a flyout
 * row carries `link_type: "screen"` with the real kind in `meta.kind`), so
 * `mergeMenu` infers the kind from the populated fields (flyoutRef / url /
 * screen), never from `link_type`. Widened to `string` to accept any value.
 */
export type MenuConfigItemType = 'screen' | 'external' | 'link' | 'flyout' | (string & {});

/**
 * The menu SURFACE a config item belongs to (`menu_config.menu_type`). The
 * left-rail (`DefaultLayout`) renders only `sidebar` items (or items with no
 * `menu_type`, treated as sidebar for back-compat); the other surfaces are
 * consumed elsewhere (header, footer, user-account menu, mobile).
 */
export type MenuType = 'header' | 'footer' | 'sidebar' | 'user-account' | 'mobile';

/** All valid `menu_type` values, for validation + admin option lists. */
export const MENU_TYPE_VALUES: readonly MenuType[] = [
  'header',
  'footer',
  'sidebar',
  'user-account',
  'mobile',
];

/**
 * A single **menu-config item** — one row of the `menu-config-merged` saved
 * query, column-mapped to camelCase by `useMenuConfig`. Mirrors the
 * `platform.menu_config` table (see app-manager `core/platform_models/`).
 *
 * The tenant's menu config is now CONFIG-AUTHORITATIVE for the rail: `mergeMenu`
 * builds the rail from the config block (in `sortOrder`) plus any code routes
 * the config didn't consume (in code order). Items form a 2-level tree via
 * `parentKey`.
 *
 * This is one tenant-global menu shared by every app. A row's
 * `appDefinitionKey` is the target/owning app for its screen, never the app whose
 * rail owns the row.
 *
 * Kinds (`linkType`, inferred from shape when absent):
 *  - `screen` — a registered screen. `appDefinitionKey` ≠ the current app →
 *    cross-app (`navigateCrossApp`); equal → a LOCAL route (must match a known
 *    slug) that CONSUMES the matching code entry.
 *  - `link` — a plain external `url`.
 *  - `flyout` — a quick-panel; `flyoutRef` resolves against the flyouts registry.
 *
 * Usable iff `itemKey && (screen || url || flyoutRef)`, with screen/url/flyoutRef
 * consistent with `linkType` (see `useMenuConfig`'s validation).
 */
export interface MenuConfigItem {
  /** `item_key` — stable unique key (React key + parent/child linkage). */
  itemKey: string;
  /** `app_definition_key` — target/owning app, used to resolve screen items. */
  appDefinitionKey: string;
  /** `name` — the sidebar label. */
  name: string;
  /** `menu_type` — which menu SURFACE this item belongs to (rail renders `sidebar`). */
  menuType?: MenuType;
  /** `description` — free-text description shown to admins/editors. */
  description?: string;
  /** `icon` — Nucleo glyph class (e.g. `icon_-Tb_briefcase`). */
  icon?: string;
  /** `screen` — target screen slug (`screen`/`flyout` kinds). */
  screen?: string;
  /** `url` — external URL (`link` kind). */
  url?: string;
  /** `flyout_ref` — flyouts-registry id (`flyout` kind). */
  flyoutRef?: string;
  /** `link_type` — informational only (kind is inferred from fields, not this). */
  linkType?: MenuConfigItemType;
  /** `open_in` — how the item opens its target. */
  openIn?: OpenIn;
  /** `window_width` — `new_window` popup width (px). */
  windowWidth?: number;
  /** `window_height` — `new_window` popup height (px). */
  windowHeight?: number;
  /** `parent_key` — parent `itemKey` for nesting (empty/undefined = top-level). */
  parentKey?: string;
  /** `sort_order` — order among siblings. */
  sortOrder?: number;
  /** `hidden` — hide the item (consumes a matching code entry, renders nothing). */
  hidden?: boolean;
  /**
   * `meta` — forward-compat bag for attributes not yet promoted to columns.
   * Passed through untouched;
   * nothing in the rail consumes it yet, but the menu admin UI writes e.g.
   * `meta.kind`, so future consumers won't need a parser/cache reshape.
   */
  meta?: Record<string, unknown>;
}

export const NavRoutesContext = createContext<NavRouteEntry[]>([]);

/**
 * Hook helper. Returns the nav-eligible routes the cloned app declared
 * (empty array when called outside a `PrivateApp` subtree, which is
 * what the scaffolding-route layout instances see).
 */
export function useNavRoutes(): NavRouteEntry[] {
  return useContext(NavRoutesContext);
}

/**
 * The `contentPadding` of a single default-layout route, carried from
 * `PrivateApp` down to `DefaultLayout`. Kept SEPARATE from
 * `NavRoutesContext` on purpose: that context is the nav-eligible subset
 * (`!hideFromNav`), but takeover pages are precisely the `hideFromNav: true`
 * ones, so they'd be excluded there. This context carries EVERY default-layout
 * route (hidden or not) so the layout can resolve the active route's padding.
 */
export interface ContentPaddingRoute {
  /** Route path (may contain params, e.g. `/accounts/:id`). */
  path: string;
  /** Resolved padding for this route's `<main>` content box. */
  contentPadding: ContentPaddingKey;
}

export const ContentPaddingContext = createContext<ContentPaddingRoute[]>([]);

/**
 * Hook helper. Returns every default-layout route's `{ path, contentPadding }`
 * (empty array outside a `PrivateApp` subtree). `DefaultLayout` matches the
 * active pathname against these to decide whether to drop the `<main>` gutter.
 */
export function useContentPaddingRoutes(): ContentPaddingRoute[] {
  return useContext(ContentPaddingContext);
}

/**
 * ALL of the cloned app's local route slugs — including `hideFromNav` routes —
 * exposed so `mergeMenu` can validate a self-app config `screen` item against a
 * route that exists but isn't in the visible nav (e.g. servicing's
 * `service-requests`, whose nav item is a flyout). Distinct from
 * `NavRoutesContext` (visible items only). Provided by `PrivateApp`; empty
 * outside a `PrivateApp` subtree.
 */
export const AllRouteSlugsContext = createContext<ReadonlySet<string>>(new Set());

/** Read the set of all local route slugs (see `AllRouteSlugsContext`). */
export function useAllRouteSlugs(): ReadonlySet<string> {
  return useContext(AllRouteSlugsContext);
}
