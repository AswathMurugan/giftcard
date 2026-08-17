/**
 * `PrivateRoute` — typed declaration helper for a single route inside
 * `src/PrivateApp.tsx`.
 *
 * The agent calls this function inline when declaring routes:
 *
 *   PrivateRoute({ path: '/clients', label: 'Clients', icon: 'icon_-Tb_users', element: <ClientListPage /> })
 *
 * It returns a normalised `PrivateRouteDeclaration` that `PrivateApp`
 * maps over in two passes:
 *
 *   1. Filter `hideFromNav === true` out → publish the rest via
 *      `NavRoutesContext` for `DefaultLayout`'s sidebar.
 *   2. Render every entry (including hidden ones like detail pages)
 *      as a `<Route>` element inside the `<Routes>` tree.
 *
 * Not a React component — calling it inline avoids React Router's
 * "Routes can only have Route children" runtime check while still
 * giving the agent a typed, named API to declare entries.
 */
import type { ReactNode } from 'react';
import type { ContentPaddingKey, LayoutKey } from './types';
import type { ExternalNavTarget } from './nav-routes-context';
import { elementPreload, type PreloadRoute } from './lazy-preload';
import { registerPrivateRoute } from './private-route-registry';

export interface PrivateRouteOptions {
  /** URL path (e.g. `/clients` or `/clients/:id`). */
  path: string;
  /** Element to render at this path. */
  element: ReactNode;
  /** Sidebar label. Required when the entry is nav-eligible (default). */
  label?: string;
  /**
   * Sidebar icon — a Nucleo glyph class (e.g. `'icon_-Tb_home'`), NOT a lucide
   * component. Look up classes in `src/assets/fonts/nucleo/ICONS.md`. Required
   * when the entry is nav-eligible (default).
   */
  icon?: string;
  /** Tooltip / helper-menu description. */
  description?: string;
  /** Defaults to `'default'`. Set to `'blank'` to render without app chrome. */
  layout?: LayoutKey;
  /**
   * Content-box padding for `layout: 'default'` routes. Defaults to `'default'`
   * (the standard `<main>` gutter). Set to `'none'` for an in-shell takeover —
   * the rail + header stay, but the page owns the full content box (no gutter),
   * so it can bleed edge-to-edge and manage its own scroll. Ignored for
   * `layout: 'blank'` routes (they already have no chrome). See LAYOUT.md.
   */
  contentPadding?: ContentPaddingKey;
  /**
   * Hide from the sidebar + helper menu — typical for detail pages
   * (`/clients/:id`) and other deep links. Still registered with the
   * router so the deep link works.
   */
  hideFromNav?: boolean;
  /**
   * Hide from the helper menu only (still shown in the sidebar).
   * Useful for routes like `/` (Home) where the sidebar mention is
   * desired but the helper popover becomes noisy.
   */
  hideFromHelper?: boolean;
  /**
   * Optional screen-permission gate. Set to the screen name (the
   * `register_screen` / `buildSchema` page name, e.g. `'ClientListPage'`) to
   * hide the nav item AND block the route unless the user has read/write on
   * `<appDefinitionKey>.screen.<permission>`. Omit → never gated.
   */
  permission?: string;
}

export interface PrivateRouteDeclaration {
  path: string;
  element: ReactNode;
  label: string | undefined;
  icon: string | undefined;
  description: string | undefined;
  layout: LayoutKey;
  contentPadding: ContentPaddingKey;
  hideFromNav: boolean;
  hideFromHelper: boolean;
  permission: string | undefined;
  /** Background import attached by lazyWithPreload; absent for eager/legacy routes. */
  preload: PreloadRoute | undefined;
  /** Set when this entry is a cross-app link, not an in-app route. */
  external?: ExternalNavTarget;
}

/**
 * Normalise a route declaration. Throws (build-time, via tsx) when a
 * nav-eligible entry (i.e. `hideFromNav: false`, the default) doesn't
 * declare a label + icon — those are required for the sidebar render.
 */
export function PrivateRoute(
  options: PrivateRouteOptions,
): PrivateRouteDeclaration {
  const layout = options.layout ?? 'default';
  const contentPadding = options.contentPadding ?? 'default';
  const hideFromNav = options.hideFromNav === true;
  const hideFromHelper = options.hideFromHelper === true || hideFromNav;

  if (!hideFromNav) {
    if (!options.label || !options.icon) {
      throw new Error(
        `PrivateRoute("${options.path}"): label + icon are required for ` +
          `nav-eligible routes. Pass \`hideFromNav: true\` for detail pages / ` +
          `deep links that should NOT appear in the sidebar.`,
      );
    }
  }

  return registerPrivateRoute({
    path: options.path,
    element: options.element,
    label: options.label,
    icon: options.icon,
    description: options.description,
    layout,
    contentPadding,
    hideFromNav,
    hideFromHelper,
    permission: options.permission,
    preload: elementPreload(options.element),
  });
}

export interface ExternalNavItemOptions {
  /** Sidebar label. */
  label: string;
  /** Nucleo glyph class (e.g. `'icon_-Tb_briefcase'`). */
  icon: string;
  /** Target app's `app_definition_key` (from related-screens.catalog.md). */
  appKey: string;
  /** Target screen name (the deep-link page id). */
  screen: string;
  /**
   * Static nav variables → query params. ONLY for screens whose required nav
   * variables can be filled statically. A screen with required nav variables
   * that need per-row context must be wired to a BUTTON instead (it has no
   * record context in a static sidebar). See CROSS-APP-NAVIGATION-PLAN.md §5.4.
   */
  navVars?: Record<string, string>;
  /** Tooltip / helper-menu description. */
  description?: string;
  /** Hide from the helper menu (still in the sidebar). */
  hideFromHelper?: boolean;
}

/**
 * Declare a CROSS-APP sidebar item that navigates to a screen in another
 * related application. Unlike `PrivateRoute`, it registers NO in-app `<Route>`;
 * the sidebar resolves its URL from `related_applications` at click time and
 * hard-navigates.
 *
 * Use this ONLY for target screens with no required nav variables (or ones you
 * can fill statically). For a screen that needs per-row context (e.g. an
 * account detail keyed by `accountId`), wire a cross-app BUTTON in that row
 * instead — a static sidebar item has nowhere to get the id.
 *
 * @example
 *   ExternalNavItem({
 *     label: 'Servicing Accounts',
 *     icon: 'icon_-Tb_briefcase',
 *     appKey: 'advisorworkstation_69c6...',
 *     screen: 'accounts',
 *   })
 */
export function ExternalNavItem(
  options: ExternalNavItemOptions,
): PrivateRouteDeclaration {
  if (!options.label || !options.icon) {
    throw new Error(
      `ExternalNavItem("${options.screen}"): label + icon are required.`,
    );
  }
  if (!options.appKey || !options.screen) {
    throw new Error(
      `ExternalNavItem("${options.screen}"): appKey + screen are required ` +
        `(from related-screens.catalog.md).`,
    );
  }
  return registerPrivateRoute({
    // Synthetic path key — never routed; just a stable React key for the item.
    path: `__external__/${options.appKey}/${options.screen}`,
    element: null,
    label: options.label,
    icon: options.icon,
    description: options.description,
    layout: 'default',
    contentPadding: 'default',
    hideFromNav: false,
    hideFromHelper: options.hideFromHelper === true,
    permission: undefined,
    preload: undefined,
    external: {
      appKey: options.appKey,
      screen: options.screen,
      navVars: options.navVars,
    },
  });
}
