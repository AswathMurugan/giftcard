import { Fragment, Suspense, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link, NavLink, Outlet, matchPath, useLocation, useNavigate } from 'react-router-dom';
import { Spinner } from '@/components/ui/spinner';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { HelperMenu } from '@/components/shared/HelperMenu';
import { UserMenu } from '@/components/shared/UserMenu';
import { cn } from '@/lib/utils';
import {
  useNavRoutes,
  useAllRouteSlugs,
  useContentPaddingRoutes,
  type NavRouteEntry,
} from '@/routes/nav-routes-context';
import { mergeMenu, buildWindowFeatures } from '@/routes/merge-menu';
import { buildMenuTree } from '@/routes/build-menu-tree';
import { useMenuConfig, filterSidebarItems } from '@/queries/use-menu-config';
import {
  useSidebarFlyouts,
  SidebarFlyoutItem,
  SIDEBAR_FLYOUT_WIDTH,
  leadingFlyouts,
  flyoutsAfter,
  flyoutById,
  type SidebarFlyout,
} from '@/routes/sidebar-flyouts';
import { navigateCrossApp, resolveAppUrl } from '@/config/cross-app-nav';
import { getAppConfig } from '@/config/api-config';
import { isEmbedded } from '@/config/embedded';
import { APPLICATION } from '@/types/app.generated';
import { useBranding } from '@/components/branding-provider';
import { useLayoutConfig } from '@/config/use-layout-config';
import type { LayoutConfig } from '@/config/layout';
import { RAIL_SECTION_LABEL } from '@/config/layout';
import jiffyLogoDark from '@/assets/jiffyai-logo-dark.svg';
import {
  getStoredPermissionMap,
  hasReadOrWrite,
  usePermissions,
} from '@/queries/use-permissions';
import { getScreenResourceKey } from '@/constants/pages';
import {
  privateRoutesDeclarePreference,
  withDefaultPreferenceNav,
} from '@/routes/built-in-routes';
import { getRegisteredPrivateRoutes } from '@/routes/private-route-registry';

/** Built-in dark-rail colours; overridable via layout config. */
const RAIL_DEFAULT_BG = '#1C1B20';
const RAIL_DEFAULT_TEXT = '#C9CACD';
const RAIL_DEFAULT_ACTIVE = '#BCA04F';

/**
 * Brand-derived rail colours used when the tenant theme opts into "Invert
 * Sidebar Colors" (PHX-5283). Mirrors the platform renderer's `inverted`
 * sidebar preset (bg primary-500, text grayscale-100, active secondary-500),
 * driving the rail off the CSS ramp `applyTheme` writes from the brand theme —
 * so the menu inherits the tenant's brand colour instead of the built-in black.
 */
const RAIL_INVERTED_BG = 'var(--color-primary-500)';
const RAIL_INVERTED_TEXT = 'var(--color-grayscale-100)';
const RAIL_INVERTED_ACTIVE = 'var(--color-secondary-500)';

export interface RailColors {
  bg: string;
  text: string;
  active: string;
  /** Ink for the ACTIVE item's label. Falls back to `active`. */
  activeInk: string;
}

/**
 * Resolve the rail colour palette. An explicit `App.Layout.Sidebar*Color`
 * preference always wins (deliberate per-app override); otherwise the tenant
 * theme's `invertSidebarColors` opt-in selects the brand-derived palette, and
 * failing that the built-in dark palette applies. Pure → unit-testable.
 */
export function resolveRailColors(
  // `sidebarActiveInkColor` is OPTIONAL here (not part of the Pick) so existing
  // callers and fixtures that predate it keep compiling; omitted → the accent
  // doubles as the label ink, which is the previous behaviour exactly.
  layout: Pick<
    LayoutConfig,
    'sidebarColor' | 'sidebarTextColor' | 'sidebarActiveColor'
  > & { sidebarActiveInkColor?: string | null },
  invertSidebarColors: boolean,
): RailColors {
  const active =
    layout.sidebarActiveColor ??
    (invertSidebarColors ? RAIL_INVERTED_ACTIVE : RAIL_DEFAULT_ACTIVE);
  return {
    bg:
      layout.sidebarColor ??
      (invertSidebarColors ? RAIL_INVERTED_BG : RAIL_DEFAULT_BG),
    text:
      layout.sidebarTextColor ??
      (invertSidebarColors ? RAIL_INVERTED_TEXT : RAIL_DEFAULT_TEXT),
    active,
    // Unset → the accent doubles as the label ink, preserving the built-in
    // dark rail's all-gold active item.
    activeInk: layout.sidebarActiveInkColor ?? active,
  };
}

type DefaultLayoutProps = {
  /**
   * Override nav items. When omitted, reads from `NavRoutesContext`
   * (populated by `<PrivateApp />`). Pass an empty array `[]` to
   * suppress the sidebar entirely (the scaffolding-routes branch in
   * `routes/index.tsx` mounts a `<DefaultLayout brand="Scaffolding" />`
   * without auth + without a `NavRoutesContext` provider, so nav
   * collapses to empty there too).
   */
  navItems?: NavRouteEntry[];
  /**
   * Top-bar brand text. Defaults to the deployed app's `label` from
   * `APPLICATION.label` (auto-fetched per tenant on cold-boot). Falls
   * back to "Codegen Starter" when no application metadata is loaded
   * (cold local dev with no .env).
   */
  brand?: string;
};

const SIDEBAR_STATE_KEY = 'app:sidebar-collapsed';

/**
 * Initial rail state: the user's remembered choice wins; with no stored choice
 * we fall back to the app's `defaultCollapsed` config (so an app can open with
 * the rail collapsed but still expandable).
 */
function readInitialCollapsed(defaultCollapsed = false): boolean {
  if (typeof window === 'undefined') return defaultCollapsed;
  try {
    const stored = window.localStorage.getItem(SIDEBAR_STATE_KEY);
    if (stored === '1') return true;
    if (stored === '0') return false;
    return defaultCollapsed;
  } catch {
    return defaultCollapsed;
  }
}

function defaultBrand(): string {
  return APPLICATION?.label || APPLICATION?.name || 'Codegen Starter';
}

export function DefaultLayout({
  navItems,
  brand = defaultBrand(),
}: DefaultLayoutProps) {
  const location = useLocation();
  const contextNav = useNavRoutes();
  // Existing app branches preserve their old PrivateApp.tsx during starter
  // sync. Supply the new default-visible built-in item only when its registered
  // routes do not already declare `/preference`; new apps remain controlled by
  // hideFromNav and legacy user routes are not duplicated.
  const codeNav = useMemo(
    () =>
      withDefaultPreferenceNav(
        contextNav,
        privateRoutesDeclarePreference(getRegisteredPrivateRoutes()),
      ),
    [contextNav],
  );
  const layout = useLayoutConfig();
  // Rail palette: honours the tenant theme's "Invert Sidebar Colors" opt-in so
  // the menu inherits the brand colour (PHX-5283), unless an explicit
  // App.Layout.Sidebar*Color preference overrides it.
  const { invertSidebarColors } = useBranding();
  const railColors = useMemo(
    () => resolveRailColors(layout, invertSidebarColors),
    [layout, invertSidebarColors],
  );
  const [collapsed, setCollapsed] = useState<boolean>(() => readInitialCollapsed(layout.defaultCollapsed));
  // Explicit prop wins (scaffolding-routes branch passes nothing →
  // contextNav is the right default; PrivateApp passes nothing →
  // contextNav has the cloned app's routes; tests can pass [] to
  // suppress).
  //
  // The tenant's menu config (v3, config-authoritative) is built into a 2-level
  // tree then merged onto the app's OWN context-driven nav: the config block (in
  // sortOrder) plus code items it didn't consume (code order). Each row's app
  // key identifies its screen target: current-app items validate against ALL
  // route slugs (incl. hideFromNav), while other-app + link + flyout items
  // resolve per the merge rules. When an explicit `navItems` prop
  // is passed (the scaffolding branch passes `[]` to suppress the sidebar), it's
  // honoured verbatim — no merge — so a stored config can't resurrect it.
  const { data: menuConfig } = useMenuConfig();
  const allSlugs = useAllRouteSlugs();
  const flyouts = useSidebarFlyouts();
  const currentAppKey = getAppConfig().appDefinitionKey;
  const flyoutIds = useMemo(() => new Set(flyouts.map((f) => f.id)), [flyouts]);
  const resolvedNav = useMemo(() => {
    if (navItems !== undefined) return navItems;
    // Only sidebar-surface items reach the rail (header/footer/user-account/
    // mobile items are consumed elsewhere).
    const tree = buildMenuTree(filterSidebarItems(menuConfig ?? []));
    return mergeMenu(codeNav, tree, { currentAppKey, allSlugs, flyoutIds });
  }, [navItems, codeNav, menuConfig, currentAppKey, allSlugs, flyoutIds]);

  // Permission-gate nav items: hide any item whose `permission` screen the user
  // can't read/write. Fail-open while permissions load (avoids a flash).
  const { data: permMap, isLoading: permsLoading } = usePermissions();
  const visibleNav = useMemo(() => {
    const map = permMap ?? getStoredPermissionMap();
    const loadingNoCache = permsLoading && !map;
    const visible = (item: NavRouteEntry) =>
      isNavItemVisible(item.permission, map, loadingNoCache);
    // Gate top-level items; also gate a group's children and drop groups that
    // end up empty after gating.
    return resolvedNav.flatMap((item): NavRouteEntry[] => {
      if (!visible(item)) return [];
      if (item.children && item.children.length > 0) {
        const kids = item.children.filter(visible);
        return kids.length > 0 ? [{ ...item, children: kids }] : [];
      }
      return [item];
    });
  }, [resolvedNav, permMap, permsLoading]);

  // `compact` variant → always an icon-only rail (ignores the user toggle).
  const effectiveCollapsed = layout.variant === 'compact' ? true : collapsed;

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_STATE_KEY, collapsed ? '1' : '0');
    } catch {
      // ignore — storage may be unavailable (private mode, quota, etc.)
    }
  }, [collapsed]);

  // When the platform shell frames this app (cross-app nav), the shell owns the
  // chrome — suppress our own TopBar + SideBar so it isn't double-framed.
  const embedded = isEmbedded();
  const showHeader = !embedded && layout.header !== 'hidden';
  const showSidebar = !embedded && layout.sidebar !== 'hidden';

  // A PINNED flyout pushes the main content right (persistent column) instead of
  // covering it; a peeked (hover) flyout still overlays. Lifted here so `<main>`
  // can offset. Cleared automatically if the sidebar is hidden.
  const [pinnedFlyoutId, setPinnedFlyoutId] = useState<string | null>(null);
  const flyoutPinned = showSidebar && pinnedFlyoutId != null;

  // In-shell takeover: a route can opt out of `<main>`'s gutter so the page
  // owns the full content box (rail + header stay). Resolved by matching the
  // active pathname against the default-layout routes PrivateApp publishes.
  // Falls back to 'default' outside a PrivateApp subtree (e.g. scaffolding).
  const contentPaddingRoutes = useContentPaddingRoutes();
  const bareContent = useMemo(
    () =>
      contentPaddingRoutes.some(
        (r) =>
          r.contentPadding === 'none' &&
          matchPath({ path: r.path, end: true }, location.pathname) != null,
      ),
    [contentPaddingRoutes, location.pathname],
  );

  return (
    <div className="flex h-svh w-full flex-col overflow-hidden bg-background text-foreground">
      {showHeader && (
        <TopBar
          brand={brand}
          collapsed={effectiveCollapsed}
          showToggle={showSidebar && layout.variant !== 'compact'}
          sidebarColor={railColors.bg}
          sidebarTextColor={railColors.text}
          headerColor={layout.headerColor}
          headerTextColor={layout.headerTextColor}
          headerTagline={layout.headerTagline}
          onToggleSidebar={() => setCollapsed((v) => !v)}
          brandOffset={flyoutPinned ? SIDEBAR_FLYOUT_WIDTH + 24 : 0}
        />
      )}
      <div className="flex flex-1 min-h-0">
        {showSidebar && (
          <SideBar
            items={visibleNav}
            collapsed={effectiveCollapsed}
            railColors={railColors}
            pinnedFlyoutId={pinnedFlyoutId}
            onPinnedChange={setPinnedFlyoutId}
          />
        )}
        <main
          className={cn(
            'flex-1 min-w-0 overflow-y-auto transition-[padding] duration-200 ease-out',
            // `contentPadding: 'none'` → no gutter (page owns the box). The
            // transition is kept intentionally so navigating to/from a takeover
            // page eases the padding rather than snapping.
            !bareContent && 'p-6 pt-3',
          )}
          style={flyoutPinned ? { paddingLeft: SIDEBAR_FLYOUT_WIDTH + 24 } : undefined}
        >
          <ErrorBoundary key={location.pathname} context={location.pathname}>
            {/* Suspense boundary for lazily-imported pages (feature pages are
                authored `lazy(() => import(...))`, see CLAUDE.md). Living in the
                layout — NOT the agent-owned PrivateApp.tsx — means every app,
                including already-generated ones, inherits it on starter sync.
                PHX-4455. */}
            <Suspense
              fallback={
                <div className="flex min-h-[40vh] w-full items-center justify-center py-12">
                  <Spinner className="size-6 text-muted-foreground" />
                </div>
              }
            >
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
      <HelperMenu />
    </div>
  );
}

/**
 * Whether a permission-gated nav item should be shown. Ungated → always;
 * gated + loading (no cached map) → fail-open; gated + loaded → read/write on
 * `<appDefinitionKey>.screen.<permission>`. Exported for testing.
 */
export function isNavItemVisible(
  permission: string | undefined,
  map: ReturnType<typeof getStoredPermissionMap>,
  isLoadingNoCache: boolean,
): boolean {
  if (!permission) return true;
  if (isLoadingNoCache) return true;
  return hasReadOrWrite(map, getScreenResourceKey(permission));
}

/**
 * Sensible default for the top-bar logo when the tenant didn't set
 * `App.LogoHeight`. The topbar is `h-14` (3.5rem / 56px); a 2rem
 * (32px) logo sits comfortably with vertical breathing room and
 * matches the visual weight of the brand text it replaces. Most
 * tenants don't ship a `LogoHeight` preference, so without a default
 * the `<img>` renders at the SVG's intrinsic dimensions — often
 * hundreds of pixels tall, blowing past the header.
 */
const DEFAULT_LOGO_HEIGHT = '2rem';
/**
 * Hard upper bound on logo width so a wide / panoramic logo can't push
 * the sidebar-toggle button or right-side slot off-screen.
 */
const MAX_LOGO_WIDTH = '12rem';

function TopBar({
  brand,
  collapsed,
  onToggleSidebar,
  showToggle = true,
  sidebarColor = RAIL_DEFAULT_BG,
  sidebarTextColor = RAIL_DEFAULT_TEXT,
  headerColor = null,
  headerTextColor = null,
  headerTagline = null,
  brandOffset = 0,
}: {
  brand: string;
  collapsed: boolean;
  onToggleSidebar: () => void;
  /** Render the dark toggle block. False when sidebar is hidden or compact. */
  showToggle?: boolean;
  sidebarColor?: string;
  sidebarTextColor?: string;
  /** Header background. Null → the stock page surface. */
  headerColor?: string | null;
  /** Header foreground. Null → normal page ink. */
  headerTextColor?: string | null;
  /** Uppercase chip beside the brand. Null/empty → not rendered. */
  headerTagline?: string | null;
  /** Left padding (px) applied to the brand when a full-height flyout is pinned,
   *  so the brand shifts right of the panel and stays visible. 0 otherwise. */
  brandOffset?: number;
}) {
  // Per-tenant logo (from `App.LogoUrl` ?? `Tenant.Logo`), resolved at
  // runtime by BrandingProvider. When set, render it in place of the
  // brand text; the brand text still populates the link's accessible
  // name + tab tooltip.
  const branding = useBranding();
  const logoUrl = branding.logoUrl;
  // Honour `App.LogoHeight` when the tenant set it; otherwise fall back
  // to DEFAULT_LOGO_HEIGHT so the image fits inside the `h-14` topbar.
  const logoHeight = branding.logoHeight ?? DEFAULT_LOGO_HEIGHT;

  // A themed header is one flat coloured band (the demo's 56px chrome bar), so
  // the toggle block goes transparent and auto-width instead of mirroring the
  // sidebar's colour + width — otherwise a white rail would punch a light notch
  // into the dark bar. Unthemed, everything below is byte-for-byte the stock look.
  const themedHeader = Boolean(headerColor);

  return (
    <header
      className={cn(
        'flex shrink-0 items-center pr-4',
        themedHeader ? 'h-14' : 'h-[3.75rem] bg-background',
      )}
      style={
        themedHeader
          ? ({
              backgroundColor: headerColor as string,
              // Re-point the semantic ink tokens for everything INSIDE the bar
              // (notably UserMenu, which we don't fork). Without this the
              // username renders near-black ink on the near-black header and
              // disappears. Radix portals its dropdown to <body>, so the open
              // menu keeps the normal light palette.
              '--foreground': headerTextColor ?? '#FFFFFF',
              '--muted-foreground': `color-mix(in srgb, ${headerTextColor ?? '#FFFFFF'} 65%, transparent)`,
            } as CSSProperties)
          : undefined
      }
    >
      {/* Sidebar toggle lives in the toolbar (NOT inside the sidebar) but shares
          the menu's dark treatment and MATCHES the sidebar width so the dark
          block + brand shift together when toggled. Hidden when there's no
          sidebar (header-only) or in the compact icon-rail variant. */}
      {showToggle && (
        <div
          className={cn(
            'flex h-full shrink-0 items-center transition-[width] duration-200 ease-out',
            themedHeader
              ? 'w-auto pl-3 pr-1'
              : collapsed
                ? 'w-14 justify-center'
                : 'w-[17.5rem] px-2',
          )}
          style={
            themedHeader ? undefined : { backgroundColor: sidebarColor }
          }
        >
          <button
            type="button"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={onToggleSidebar}
            style={{ color: themedHeader ? (headerTextColor ?? undefined) : sidebarTextColor }}
            className={cn(
              // Rail-aware hover (see navItemClasses) so the toggle stays
              // legible on a light rail as well as the default dark one.
              'inline-flex h-9 items-center gap-3 rounded-md transition-colors',
              'hover:bg-[color-mix(in_srgb,currentColor_10%,transparent)]',
              'focus-visible:outline-none focus-visible:bg-[color-mix(in_srgb,currentColor_10%,transparent)]',
              collapsed ? 'size-9 justify-center' : 'w-full px-2',
            )}
          >
            <i
              className={cn('icon block shrink-0 text-[1.375rem] leading-none', toggleGlyph(collapsed))}
              aria-hidden="true"
            />
            {!collapsed && !themedHeader && (
              <span className="truncate text-[0.9375rem]">Menu</span>
            )}
          </button>
        </div>
      )}
      {themedHeader ? (
        /* Demo lockup: JiffyAI wordmark · hairline divider · gold flame + product
           name · uppercase tagline chip. A tenant `App.LogoUrl` still wins over
           the bundled wordmark. */
        <Link
          to="/"
          className="flex items-center gap-3.5 pl-2"
          style={brandOffset ? { paddingLeft: brandOffset } : undefined}
          title={brand}
          aria-label={brand}
        >
          <img
            src={logoUrl ?? jiffyLogoDark}
            alt="JiffyAI"
            className="block w-auto object-contain"
            style={{ height: logoUrl ? logoHeight : 20, maxWidth: MAX_LOGO_WIDTH }}
          />
          <span className="h-[22px] w-px shrink-0 bg-white/20" aria-hidden="true" />
          <span
            className="inline-flex items-center gap-[7px] text-[15px] font-bold tracking-[0.01em]"
            style={{ color: headerTextColor ?? undefined }}
          >
            {/* Tabler's `flame`, inlined: the Nucleo build vendored with the
                starter has no flame glyph, and the DS forbids emoji stand-ins. */}
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--color-primary-300)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="shrink-0"
            >
              <path d="M12 12c2 -2.96 0 -7 -1 -8c0 3.038 -1.773 4.741 -3 6c-1.226 1.26 -2 3.24 -2 5a6 6 0 1 0 12 0c0 -1.532 -1.056 -3.94 -2 -5c-1.786 3 -2.791 3 -4 2z" />
            </svg>
            {brand}
          </span>
          {headerTagline ? (
            <span className="rounded-full border border-white/15 bg-white/10 px-2 py-0.5 text-[11px] font-semibold tracking-[0.03em] text-white/70">
              {headerTagline}
            </span>
          ) : null}
        </Link>
      ) : (
        <Link
          to="/"
          className={cn(
            'flex items-center text-[1.625rem] font-semibold tracking-tight transition-[padding] duration-200 ease-out',
            !brandOffset && (showToggle ? 'pl-6' : 'pl-4'),
          )}
          style={brandOffset ? { paddingLeft: brandOffset } : undefined}
          title={brand}
          aria-label={brand}
        >
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={brand}
              className="block w-auto object-contain"
              style={{ height: logoHeight, maxWidth: MAX_LOGO_WIDTH }}
            />
          ) : (
            brand
          )}
        </Link>
      )}
      <div className="ml-auto flex items-center gap-2">
        <UserMenu />
      </div>
    </header>
  );
}

/**
 * Classes for a sidebar nav item on the dark rail. Colours come from CSS
 * variables (`--rail-text` inactive, `--rail-active` active) set by `SideBar`
 * from the layout config, so they're tenant/app-overridable. Active items are
 * semibold on a gold-tinted fill (DS selected = primary-50 gold tint), 8px
 * radius. Pure → unit-testable.
 */
export function navItemClasses(isActive: boolean, collapsed: boolean): string {
  return cn(
    'flex h-9 items-center gap-3 rounded-lg px-2 text-[0.9375rem] transition-colors',
    // Hover/focus derive from the rail's OWN colours rather than assuming a
    // dark rail. The previous `hover:bg-white/5 hover:text-white` only worked
    // on a dark background — on a light rail it turned the hovered label white
    // on white (invisible). A translucent wash of the active colour plus the
    // active ink reads correctly on both.
    'text-[var(--rail-text)]',
    'hover:bg-[color-mix(in_srgb,var(--rail-active)_10%,transparent)] hover:text-[var(--rail-active)]',
    'focus-visible:outline-none focus-visible:bg-[color-mix(in_srgb,var(--rail-active)_10%,transparent)] focus-visible:text-[var(--rail-active)]',
    // Selected: gold-tinted fill (DS active = primary-50 gold tint) rendered as
    // a translucent wash of the rail's active gold so it reads gold on the dark
    // rail, plus gold text + semibold weight.
    // The active LABEL uses `--rail-active-ink` rather than the accent itself:
    // the demo's rail puts a gold ICON next to an ink label on the gold-50
    // pill. On the default dark rail that var resolves back to `--rail-active`,
    // so the gold-on-dark look is unchanged.
    isActive &&
      'bg-[color-mix(in_srgb,var(--rail-active)_15%,transparent)] text-[var(--rail-active-ink)] font-semibold',
    collapsed && 'justify-center px-0',
  );
}

/**
 * Classes for a sidebar nav item's Nucleo icon glyph: 1.25rem (20px); `--rail-text` when
 * inactive, `--rail-active` when active. `block` + `leading-none` strip the
 * font line-height so the glyph centres cleanly. Combine with the glyph class.
 */
export function navIconClasses(isActive: boolean): string {
  return cn(
    'block shrink-0 text-[1.25rem] leading-none',
    isActive ? 'text-[var(--rail-active)]' : 'text-[var(--rail-text)]',
  );
}

/** Nucleo glyph for the toolbar's sidebar collapse/expand toggle. */
export function toggleGlyph(collapsed: boolean): string {
  return collapsed
    ? 'icon_-Tb_layout_sidebar_left_expand'
    : 'icon_-Tb_layout_sidebar_left_collapse';
}

function SideBar({
  items,
  collapsed,
  railColors,
  pinnedFlyoutId,
  onPinnedChange,
}: {
  items: NavRouteEntry[];
  collapsed: boolean;
  railColors: RailColors;
  pinnedFlyoutId: string | null;
  onPinnedChange: (id: string | null) => void;
}) {
  const navigate = useNavigate();
  // App-registered flyouts (icon → pinnable hover panel). Empty by default.
  const flyouts = useSidebarFlyouts();

  function handleLogout() {
    // Route to /logout, which signs out, clears local state, and handles
    // federated-SSO logout before landing on /login. logout() itself does NOT
    // navigate, so the rail must.
    navigate('/logout');
  }

  // Rail colours resolved by the parent (explicit App.Layout override → tenant
  // brand "invert sidebar" palette → built-in dark palette), exposed as CSS
  // vars so navItemClasses/navIconClasses pick them up.
  const railStyle = {
    backgroundColor: railColors.bg,
    '--rail-text': railColors.text,
    '--rail-active': railColors.active,
    // Active-label ink. Defaults to the accent (dark-rail behaviour); a light
    // rail sets it to ink so only the icon carries the gold.
    '--rail-active-ink': railColors.activeInk,
  } as CSSProperties;

  // One flyout rail item — shared by the leading, `afterPath`, and config-placed
  // positions.
  const renderFlyout = (f: SidebarFlyout) => (
    <SidebarFlyoutItem
      key={f.id}
      flyout={f}
      collapsed={collapsed}
      itemClass={navItemClasses}
      iconClass={navIconClasses}
      pinned={pinnedFlyoutId === f.id}
      onTogglePin={() => onPinnedChange(pinnedFlyoutId === f.id ? null : f.id)}
    />
  );

  // Flyout ids the config placed into the nav: their code-declared leading /
  // afterPath positions are suppressed (rendered only at the config placement).
  const consumedFlyoutIds = useMemo(() => {
    const ids = new Set<string>();
    const scan = (list: NavRouteEntry[]) => {
      for (const it of list) {
        if (it.flyoutRef) ids.add(it.flyoutRef);
        if (it.children) scan(it.children);
      }
    };
    scan(items);
    return ids;
  }, [items]);

  // Render one top-level nav entry: a config flyout entry (via the registry, with
  // config label/icon winning), a collapsible group, or a leaf (+ any afterPath
  // flyouts anchored to a code route's real path).
  const renderItem = (item: NavRouteEntry) => {
    if (item.flyoutRef) {
      const reg = flyoutById(flyouts, item.flyoutRef);
      if (!reg) return null;
      const merged: SidebarFlyout = {
        ...reg,
        label: item.label || reg.label,
        icon: item.icon || reg.icon,
      };
      return renderFlyout(merged);
    }
    if (item.children && item.children.length > 0) {
      return <NavGroup key={item.path} item={item} collapsed={collapsed} />;
    }
    return (
      <Fragment key={item.path}>
        <NavLeaf item={item} collapsed={collapsed} />
        {flyoutsAfter(flyouts, item.path, consumedFlyoutIds).map((f) => renderFlyout(f))}
      </Fragment>
    );
  };

  return (
    <aside
      style={railStyle}
      className={cn(
        'flex shrink-0 flex-col border-r border-border transition-[width] duration-200 ease-out',
        collapsed ? 'w-14' : 'w-[17.5rem]',
      )}
    >
      <nav className="flex flex-1 flex-col gap-0.5 p-2">
        {/* Section eyebrow above the nav items, per the Forge rail. Hidden when
            collapsed (an icon-only strip has no room for a label). */}
        {!collapsed && RAIL_SECTION_LABEL && (
          <div className="px-2.5 pb-2 pt-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground/70">
            {RAIL_SECTION_LABEL}
          </div>
        )}
        {/* Code-declared leading flyouts (excluding config-placed / configOnly).
            A flyout with `afterPath` instead renders right after that nav item.
            Each opens a pinnable hover panel; only one can be pinned at a time. */}
        {leadingFlyouts(flyouts, consumedFlyoutIds).map((f) => renderFlyout(f))}
        {items.map((item) => renderItem(item))}

        {/* Logout pinned to the bottom of the rail. */}
        <button
          type="button"
          onClick={handleLogout}
          title={collapsed ? 'Log out' : undefined}
          aria-label="Log out"
          className={cn('mt-auto', navItemClasses(false, collapsed))}
        >
          <i
            className={cn('icon icon_-Tb_logout', navIconClasses(false))}
            aria-hidden="true"
          />
          {!collapsed && <span className="truncate">Log out</span>}
        </button>
      </nav>
    </aside>
  );
}

/** Inner icon + label shared by every leaf rail control. */
function RailItemInner({
  icon,
  label,
  active,
  collapsed,
}: {
  icon: string;
  label: string;
  active: boolean;
  collapsed: boolean;
}) {
  return (
    <>
      <i className={cn('icon', icon, navIconClasses(active))} aria-hidden="true" />
      {!collapsed && <span className="truncate">{label}</span>}
    </>
  );
}

/**
 * A single leaf rail control. The interactive element is chosen from the entry's
 * kind (local route / cross-app / plain link) and `openIn`:
 *  - `current_tab` → in-app `NavLink` (local) / `navigateCrossApp` (cross-app) /
 *    whole-page `<a href>` (link);
 *  - `new_tab` → `<a target="_blank" rel="noopener noreferrer">`;
 *  - `new_window` → `window.open(url, key, buildWindowFeatures(w, h))`.
 */
function NavLeaf({ item, collapsed }: { item: NavRouteEntry; collapsed: boolean }) {
  const { path, label, icon, external, href, openIn = 'current_tab' } = item;
  const title = collapsed ? label : undefined;
  const itemClass = navItemClasses(false, collapsed);

  // The concrete URL for anchor / new-window behaviour (null when a cross-app
  // target can't yet be resolved from related_applications).
  const resolveHref = (): string | null => {
    if (href) return href;
    if (external) return resolveAppUrl(external.appKey, external.screen, external.navVars);
    return path;
  };

  if (openIn === 'new_window') {
    return (
      <button
        type="button"
        title={title}
        onClick={() => {
          const url = resolveHref();
          if (url) window.open(url, item.path, buildWindowFeatures(item.windowWidth, item.windowHeight));
        }}
        className={itemClass}
      >
        <RailItemInner icon={icon} label={label} active={false} collapsed={collapsed} />
      </button>
    );
  }

  if (openIn === 'new_tab') {
    const url = resolveHref();
    return (
      <a
        href={url ?? undefined}
        target="_blank"
        rel="noopener noreferrer"
        title={title}
        className={itemClass}
      >
        <RailItemInner icon={icon} label={label} active={false} collapsed={collapsed} />
      </a>
    );
  }

  // current_tab (default)
  if (href) {
    return (
      <a href={href} title={title} className={itemClass}>
        <RailItemInner icon={icon} label={label} active={false} collapsed={collapsed} />
      </a>
    );
  }
  if (external) {
    return (
      <button
        type="button"
        title={title}
        onClick={() => navigateCrossApp(external.appKey, external.screen, external.navVars)}
        className={itemClass}
      >
        <RailItemInner icon={icon} label={label} active={false} collapsed={collapsed} />
      </button>
    );
  }
  return (
    <NavLink
      to={path}
      end={path === '/'}
      title={title}
      className={({ isActive }) => navItemClasses(isActive, collapsed)}
    >
      {({ isActive }) => (
        <RailItemInner icon={icon} label={label} active={isActive} collapsed={collapsed} />
      )}
    </NavLink>
  );
}

/**
 * A collapsible depth-1 group (a menu node with children). Renders a header that
 * toggles the depth-2 children; auto-expands while a child route is active.
 */
function NavGroup({ item, collapsed }: { item: NavRouteEntry; collapsed: boolean }) {
  const { pathname } = useLocation();
  const children = item.children ?? [];
  const childActive = children.some(
    (c) => !c.external && !c.href && (pathname === c.path || pathname.startsWith(`${c.path}/`)),
  );
  const [open, setOpen] = useState(true);
  const expanded = open || childActive;
  return (
    <div>
      <button
        type="button"
        title={collapsed ? item.label : undefined}
        aria-expanded={expanded}
        onClick={() => setOpen((v) => !v)}
        className={navItemClasses(childActive, collapsed)}
      >
        <i className={cn('icon', item.icon, navIconClasses(childActive))} aria-hidden="true" />
        {!collapsed && <span className="flex-1 truncate text-left">{item.label}</span>}
        {!collapsed && (
          <i
            className={cn(
              'icon shrink-0 text-[1rem]',
              expanded ? 'icon_-Tb_chevron_down' : 'icon_-Tb_chevron_right',
              navIconClasses(false),
            )}
            aria-hidden="true"
          />
        )}
      </button>
      {expanded && (
        <div className={cn('flex flex-col gap-0.5', !collapsed && 'ml-4 border-l border-white/10 pl-2')}>
          {children.map((child) => (
            <NavLeaf key={child.path} item={child} collapsed={collapsed} />
          ))}
        </div>
      )}
    </div>
  );
}

export default DefaultLayout;
