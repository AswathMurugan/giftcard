/**
 * App layout / chrome configuration.
 *
 * Customizes the app shell (sidebar + header) WITHOUT forking the starter's
 * `src/layouts/` chrome. There are two layers, resolved in `useLayoutConfig`:
 *
 *   1. DEFAULT_LAYOUT_CONFIG — built-in defaults (today's look).
 *   2. LAYOUT_OVERRIDE       — app-owned static override (edit this file).
 *   3. `App.Layout.*` merged preferences — runtime, per org→app→tenant.
 *
 * Precedence (highest last): defaults ← LAYOUT_OVERRIDE ← preferences.
 *
 * **This is the ONLY layout file the agent may edit.** Never modify
 * `src/layouts/DefaultLayout.tsx` (or create a new `*Layout.tsx`) to hide the
 * sidebar/header, recolor the rail, or change the layout type — set it here, or
 * (preferably, for per-tenant/org control) via an `App.Layout.*` preference
 * using the `create_preference` tool (see `src/queries/PREFERENCE.md`).
 */

export type LayoutVisibility = 'visible' | 'hidden';
export type LayoutVariant = 'default' | 'compact';

export interface LayoutConfig {
  /** Show or hide the left sidebar rail. `hidden` → header-only app. */
  sidebar: LayoutVisibility;
  /** Show or hide the top header bar. */
  header: LayoutVisibility;
  /**
   * Header background colour. Null → the page surface (`bg-background`), the
   * starter's stock look. Set a dark value for the demo's chrome bar, which
   * inverts the app: dark header over a white rail.
   */
  headerColor: string | null;
  /** Header foreground (brand + toggle) colour. Null → normal page ink. */
  headerTextColor: string | null;
  /**
   * Small uppercase chip beside the brand (the demo's "CARD PRODUCTION").
   * Null/empty → no chip.
   */
  headerTagline: string | null;
  /** Sidebar background colour (CSS color). Null → built-in dark `#1C1B20`. */
  sidebarColor: string | null;
  /** Sidebar inactive icon/label colour. Null → built-in `#C9CACD`. */
  sidebarTextColor: string | null;
  /** Sidebar active icon/label colour. Null → built-in gold `#BCA04F`. */
  sidebarActiveColor: string | null;
  /**
   * Ink for the ACTIVE item's LABEL, when it should differ from the accent.
   * Null → the label reuses `sidebarActiveColor` (the dark rail's all-gold
   * active item). A light rail sets this to near-black so only the icon
   * carries the gold, matching the DS "gold-50 pill + gold icon + ink label".
   */
  sidebarActiveInkColor: string | null;
  /**
   * Layout type. `default` = labelled rail (w-56 / w-14 when collapsed);
   * `compact` = always icon-only narrow rail.
   */
  variant: LayoutVariant;
  /**
   * Initial rail state on first load (`default` variant only): `true` opens the
   * rail collapsed (icon-only) but still expandable via the Menu toggle. Only
   * the default — once the user toggles, their choice is remembered and wins.
   *
   * Defaults to `true` so every generated app opens with a collapsed rail
   * (more content width on first load); an app can opt out with
   * `LAYOUT_OVERRIDE = { defaultCollapsed: false }` or the
   * `App.Layout.DefaultCollapsed` preference.
   */
  defaultCollapsed: boolean;
}

/** Built-in defaults — the starter's stock look (rail starts collapsed). */
export const DEFAULT_LAYOUT_CONFIG: LayoutConfig = {
  sidebar: 'visible',
  header: 'visible',
  headerColor: null,
  headerTextColor: null,
  headerTagline: null,
  sidebarColor: null,
  sidebarTextColor: null,
  sidebarActiveColor: null,
  sidebarActiveInkColor: null,
  variant: 'default',
  defaultCollapsed: true,
};

/**
 * App-owned static override. Empty by default (= stock look). Set fields here
 * for a per-app default that doesn't need a preference, e.g.:
 *
 *   export const LAYOUT_OVERRIDE: Partial<LayoutConfig> = { sidebar: 'hidden' };
 *
 * Preferences (`App.Layout.*`) still win over whatever is set here.
 */
/**
 * Forge's rail: a WHITE sidebar, not the starter's dark one.
 *
 * The demo puts the dark chrome in the top header and keeps the left rail flat
 * white with a hairline right border — inactive items in ink (`--fg1`), the
 * active item a gold-50 pill with a gold-500 icon and a bold ink label. That
 * active treatment is exactly what the JiffyAI DS prescribes ("Active nav:
 * gold-50/100 pill with gold-500 icon + ink label"); only the rail background
 * differed. `DefaultLayout` renders the active fill as a 15% wash of
 * `sidebarActiveColor`, which over white lands on the gold-50 tint.
 */
export const LAYOUT_OVERRIDE: Partial<LayoutConfig> = {
  // Chrome bar: near-black (`--ink` / gray-900) with white brand text, exactly
  // the demo's 56px header. The dark band lives HERE, not on the rail.
  headerColor: '#1C1C1C',
  headerTextColor: '#FFFFFF',
  headerTagline: 'CLIENT PORTAL',
  sidebarColor: '#FFFFFF',
  // `--fg1` in the demo (= gray-800) for inactive labels.
  sidebarTextColor: '#2B2F36',
  // `--gold` in the demo (= primary-500) for the active icon + label.
  sidebarActiveColor: '#9E7B19',
  // `--ink` in the demo (= gray-900): the active label stays near-black while
  // the icon carries the gold.
  sidebarActiveInkColor: '#1C1C1C',
  // The demo's rail is always labelled, never a bare icon strip.
  defaultCollapsed: false,
};

/**
 * Eyebrow label rendered above the rail's nav items (the demo's
 * "SPECIALIST WORKSPACE"). Set to an empty string to hide it.
 */
export const RAIL_SECTION_LABEL = 'SPECIALIST WORKSPACE';

/**
 * Whether tenant-level SHARED menu items are allowed onto this app's left rail.
 *
 * The platform merges a tenant-wide `menu_config` into every app's sidebar, so
 * this app inherited cross-app entries it doesn't own — e.g. "Task Admin" from
 * `taskqueueplatformv2`. Those are real screens in OTHER apps; they just don't
 * belong in the card-production rail.
 *
 * Set to `false` so the rail shows only what this app declares in
 * `src/PrivateApp.tsx`. This is a LOCAL suppression on purpose — deleting the
 * tenant menu rows would remove them from every other app in the tenant too.
 *
 * Flip to `true` to opt back into the shared rail.
 */
export const ALLOW_SHARED_MENU_ITEMS = false;
