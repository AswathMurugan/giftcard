import type { ComponentType, ReactNode } from 'react';

export type LayoutKey = 'default' | 'blank';

/**
 * Controls the padding of `DefaultLayout`'s `<main>` content box for a route.
 * `'default'` keeps the standard `p-6 pt-3` gutter; `'none'` removes it so the
 * page owns the full content box edge-to-edge (an "in-shell takeover": the rail
 * + header stay, but the page controls its own padding/scroll). Only meaningful
 * for `layout: 'default'` routes — `blank` routes have no chrome or gutter.
 */
export type ContentPaddingKey = 'default' | 'none';

/**
 * A route that should appear in primary navigation (sidebar / topbar).
 * Driven by a data array so the same source feeds both the router and the chrome.
 */
export type NavRouteConfig = {
  path: string;
  element: ReactNode;
  label: string;
  /**
   * Nucleo glyph class for the nav icon, e.g. `'icon_-Tb_home'`. Rendered as
   * `<i className="icon …" />` (NOT a lucide component). Look up the class in
   * `src/assets/fonts/nucleo/ICONS.md`.
   */
  icon: string;
  /** Defaults to 'default'. Set to 'blank' to render without app chrome. */
  layout?: LayoutKey;
  /** Optional short text shown in tooltips / helper menus. */
  description?: string;
  /** Hide from the helper menu even though it is in the sidebar. */
  hideFromHelper?: boolean;
  /**
   * Optional screen-permission gate. When set to a screen name (the
   * `register_screen` / `buildSchema` page name, e.g. `'ClientListPage'`), the
   * nav item is hidden AND the route is blocked unless the user has read/write
   * on `<appDefinitionKey>.screen.<permission>`. Omit → never gated.
   */
  permission?: string;
};

/**
 * A route that should be registered with the router but NOT appear in nav.
 * Used for deep links such as detail pages, edit forms, or hidden tools.
 */
export type HiddenRouteConfig = {
  path: string;
  element: ReactNode;
  layout?: LayoutKey;
};

export type AnyRouteConfig = NavRouteConfig | HiddenRouteConfig;

export type LayoutComponent = ComponentType;
