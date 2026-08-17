/**
 * `PrivateApp` — agent-owned app shell for the cloned per-tenant app.
 *
 * This is the file you edit to add pages. The starter's `App.tsx` and
 * `src/routes/index.tsx` are starter-owned read-only scaffolding;
 * they import + mount `<PrivateApp />` inside the `RequireAuth` gate
 * and never need to change as you add features.
 *
 * Declare each route by calling `PrivateRoute({ ... })` inline in the
 * `ROUTES` array below. The same array drives BOTH the router (every
 * entry registered as a `<Route>`) AND the sidebar (entries with
 * `hideFromNav: false` published via `NavRoutesContext` for
 * `DefaultLayout`).
 *
 * Landing behaviour:
 *   - No user pages yet  → the empty cloned app renders `GettingStartedPage`
 *     full-bleed (OUTSIDE `DefaultLayout`, no sidebar/topbar).
 *   - User pages exist   → normal `DefaultLayout` + sidebar; there is NO
 *     "Home" nav item. `/` redirects to the first user page.
 *
 * @example Adding a new page
 *   1. Create `src/pages/clients/ClientListPage.tsx` (and `ClientDetailPage.tsx`).
 *   2. Lazy-import each page at the top of this file with `lazyWithPreload`
 *      (code-splitting keeps the initial preview load fast; PrivateApp warms
 *      every page chunk during browser idle time after authentication). See
 *      CLAUDE.md's "Routing" section for the exact snippet (named exports need a
 *      `.then((m) => ({ default: m.X }))` adapter).
 *   3. Add to ROUTES below (usage is unchanged — still `element: <Page />`):
 *      PrivateRoute({ path: '/clients', label: 'Clients', icon: 'icon_-Tb_users', element: <ClientListPage /> }),
 *      PrivateRoute({ path: '/clients/:id', element: <ClientDetailPage />, hideFromNav: true }),
 *
 * The deep link `/clients/:id` is registered with the router (so the
 * detail page works) but hidden from the sidebar via `hideFromNav: true`.
 * The <Suspense> boundary that shows a spinner while a lazy page's chunk loads
 * lives in DefaultLayout/BlankLayout (around <Outlet>), so you don't add one.
 */
import { useEffect } from 'react';
import { Navigate, Route, Routes, matchPath, useLocation } from 'react-router-dom';
import { BlankLayout, DefaultLayout } from '@/layouts';
import { PrivateRoute } from '@/routes/PrivateRoute';
import type { PrivateRouteDeclaration } from '@/routes/PrivateRoute';
import { APPLICATION } from '@/types/app.generated';

// Re-exported so the agent can `PrivateRoute({ ... })` in the ROUTES array
// below; also keeps the import referenced while ROUTES is empty.
export { PrivateRoute };
import {
  NavRoutesContext,
  AllRouteSlugsContext,
  ContentPaddingContext,
  type NavRouteEntry,
  type ContentPaddingRoute,
} from '@/routes/nav-routes-context';
import { PermissionGuard } from '@/components/PermissionGuard';
import { GettingStartedPage } from '@/pages/getting-started/GettingStartedPage';
import { APP_BRAND } from '@/pages/_shared/brand';
import { HelperMenu } from '@/components/shared/HelperMenu';
import { lazyWithPreload, scheduleIdleRoutePreload } from '@/routes/lazy-preload';
import { logger } from '@/utils/logger';

const PreferencePage = lazyWithPreload(() =>
  import('@/pages/preference-viewer/PreferencePage').then((module) => ({
    default: module.PreferencePage,
  })),
);

const TodayPage = lazyWithPreload(() =>
  import('@/pages/today/TodayPage').then((module) => ({
    default: module.TodayPage,
  })),
);

const OrderWorkspacePage = lazyWithPreload(() =>
  import('@/pages/orders/OrderWorkspacePage').then((module) => ({
    default: module.OrderWorkspacePage,
  })),
);

const OrdersListPage = lazyWithPreload(() =>
  import('@/pages/orders-list/OrdersListPage').then((module) => ({
    default: module.OrdersListPage,
  })),
);
const SuppliersPage = lazyWithPreload(() =>
  import('@/pages/suppliers/SuppliersPage').then((module) => ({
    default: module.SuppliersPage,
  })),
);

const SupplierRfePage = lazyWithPreload(() =>
  import('@/pages/supplier-rfe/SupplierRfePage').then((module) => ({
    default: module.SupplierRfePage,
  })),
);

const StartOrderPage = lazyWithPreload(() =>
  import('@/pages/start-order/StartOrderPage').then((module) => ({
    default: module.StartOrderPage,
  })),
);

const ClientsPage = lazyWithPreload(() =>
  import('@/pages/clients/ClientsPage').then((module) => ({
    default: module.ClientsPage,
  })),
);

const ReportsPage = lazyWithPreload(() =>
  import('@/pages/reports/ReportsPage').then((module) => ({
    default: module.ReportsPage,
  })),
);

const CardTemplatesPage = lazyWithPreload(() =>
  import('@/pages/card-templates/CardTemplatesPage').then((module) => ({
    default: module.CardTemplatesPage,
  })),
);

/**
 * Product name shown in the top bar. Shared with everything else that carries
 * the brand (including the supplier spec sheet) — see `@/pages/_shared/brand`
 * for why it isn't `APPLICATION.label`.
 */
export { APP_BRAND };

/** Starter-owned page names that generated pages must not reuse. */
export const RESERVED_PAGE_PATHS = new Set(['/preference']);

function normalizePagePath(path: string): string {
  return (path.replace(/\/+$/, '') || '/').toLowerCase();
}

export function excludeReservedPageRoutes(
  routes: PrivateRouteDeclaration[],
): PrivateRouteDeclaration[] {
  return routes.filter((route) => !RESERVED_PAGE_PATHS.has(normalizePagePath(route.path)));
}

export function isBuiltInPagePath(pathname: string): boolean {
  return RESERVED_PAGE_PATHS.has(normalizePagePath(pathname));
}

/**
 * "User pages" are the generated routes declared in `ROUTES`, except `/`.
 * Starter-owned routes live separately in `BUILT_IN_ROUTES`, so a non-empty
 * result means the agent has generated at least one feature page.
 */
export function userRoutes(
  routes: PrivateRouteDeclaration[],
): PrivateRouteDeclaration[] {
  // External (cross-app) items are sidebar links, not real in-app pages, so
  // they don't count toward "the app has user pages" / index redirect target.
  return routes.filter((r) => r.path !== '/' && !r.external);
}

/** True once at least one feature page has been generated. */
export function hasUserPages(routes: PrivateRouteDeclaration[]): boolean {
  return userRoutes(routes).length > 0;
}

/**
 * Where `/` should redirect once pages exist: the first nav-eligible feature
 * page (avoids param'd deep links like `/clients/:id`), falling back to the
 * first user route when every page is hidden from nav.
 */
export function firstUserPath(
  routes: PrivateRouteDeclaration[],
): string | null {
  const pages = userRoutes(routes);
  if (pages.length === 0) return null;
  const navEligible = pages.find((r) => !r.hideFromNav && !r.path.includes(':'));
  return (navEligible ?? pages[0]).path;
}

/** The deployed app's name, for the tab title fallback. */
// Browser tab title. Uses the same app-owned brand as the top bar so the tab
// and the header agree; falls back to the platform label only if unset.
const APP_TITLE = APP_BRAND || APPLICATION?.label || APPLICATION?.name || '';

/**
 * Resolve the browser tab title for a path: the matching route's `label`
 * (a page is open), else the app name (no page / unlabelled route). Pure +
 * exported for testing. Skips external (cross-app) entries — they don't render
 * a page here. Prefers a static path match over a param'd one.
 */
export function resolveDocumentTitle(
  pathname: string,
  routes: PrivateRouteDeclaration[],
  appTitle: string,
): string {
  const candidates = routes.filter((r) => !r.external && r.path !== '/');
  const exact = candidates.find((r) => r.path === pathname);
  const match =
    exact ?? candidates.find((r) => matchPath({ path: r.path, end: true }, pathname));
  return match?.label?.trim() || appTitle;
}

/** Keeps `document.title` in sync with the active route's label. */
function DocumentTitle({ routes }: { routes: PrivateRouteDeclaration[] }) {
  const { pathname } = useLocation();
  useEffect(() => {
    const title = resolveDocumentTitle(pathname, routes, APP_TITLE);
    if (title && typeof document !== 'undefined') {
      document.title = title;
    }
  }, [pathname, routes]);
  return null;
}

const BUILT_IN_ROUTES: PrivateRouteDeclaration[] = [
  PrivateRoute({
    path: '/preference',
    label: 'Preferences',
    icon: 'icon_-Tb_adjustments_horizontal',
    element: <PreferencePage />,
    // Hidden from the rail so the sidebar shows only Today. The ROUTE stays
    // registered, so /preference is still reachable by direct URL for admins.
    hideFromNav: true,
  }),
];

/**
 * ① ADD PAGES HERE. One `PrivateRoute({ ... })` entry per route.
 *
 *    Routes with `hideFromNav: true` are registered with the router
 *    but DO NOT appear in the sidebar — use for detail pages, edit
 *    forms, modal-as-routes, deep links.
 *
 *    Routes without an explicit `layout` default to `'default'`
 *    (DefaultLayout chrome). Pass `layout: 'blank'` for full-bleed
 *    pages that should render without the sidebar / topbar.
 */
const ROUTES: PrivateRouteDeclaration[] = [
  // `/today` is first, so `/` redirects here after login (there is no "Home"
  // route by design — the first user page is the landing page).
  PrivateRoute({
    path: '/today',
    label: 'Today',
    icon: 'icon_-Tb_dashboard',
    element: <TodayPage />,
  }),
  PrivateRoute({
    path: '/start-order',
    label: 'Start an order',
    icon: 'icon_-Tb_sparkles',
    element: <StartOrderPage />,
  }),
  PrivateRoute({
    path: '/orders',
    label: 'Orders',
    icon: 'icon_-Tb_clipboard_list',
    element: <OrdersListPage />,
  }),
  PrivateRoute({
    path: '/suppliers',
    label: 'Suppliers',
    icon: 'icon_-Tb_building_factory_2',
    element: <SuppliersPage />,
  }),
  // Ops, not order work: Clients sits next to Suppliers because the two of them
  // are the reference data every order depends on. There is no separate Pricing
  // entry — a rate card belongs to one client and is edited on that client.
  PrivateRoute({
    path: '/clients',
    label: 'Clients',
    icon: 'icon_-Tb_users',
    element: <ClientsPage />,
  }),
  // Reference data too: a template is a design held for reuse, not order work.
  PrivateRoute({
    path: '/card-templates',
    label: 'Card templates',
    icon: 'icon_-Tb_credit_card',
    element: <CardTemplatesPage />,
  }),
  // Last in the rail: Reports reads across everything above it, so it belongs
  // after the surfaces it reports on rather than competing with them.
  PrivateRoute({
    path: '/reports',
    label: 'Reports',
    icon: 'icon_-Tb_chart_bar',
    element: <ReportsPage />,
  }),
  // The SUPPLIER's own surface for one RFE. Hidden from the rail: in
  // production this is the link emailed to the supplier. It shows the spec,
  // the spec sheet PDF and their quote form — never order stages or margins.
  PrivateRoute({
    path: '/rfe/:rfeId',
    label: 'Quote request',
    icon: 'icon_-Tb_file_dollar',
    element: <SupplierRfePage />,
    hideFromNav: true,
  }),
  // Deep link only — reached from a Today row or the Orders list, not the rail.
  PrivateRoute({
    path: '/orders/:orderId',
    label: 'Order',
    icon: 'icon_-Tb_clipboard_list',
    element: <OrderWorkspacePage />,
    hideFromNav: true,
  }),
];

const USER_ROUTES = excludeReservedPageRoutes(ROUTES);
if (USER_ROUTES.length !== ROUTES.length) {
  logger.warn('private-route:reserved-path', {
    paths: ROUTES.filter((route) => !USER_ROUTES.includes(route)).map((route) => route.path),
  });
}
const ALL_ROUTES = [...BUILT_IN_ROUTES, ...USER_ROUTES];

export function PrivateApp() {
  const { pathname } = useLocation();

  useEffect(
    () =>
      scheduleIdleRoutePreload(
        ALL_ROUTES.flatMap((route) => (route.preload ? [route.preload] : [])),
      ),
    [],
  );

  // Dev-only seeding hook for the seasonal card templates. Exposed rather than
  // run automatically: seeding writes tenant-wide rows that every order can
  // see, so it is a deliberate one-off (`await __seedTemplates()` in the
  // console), not something a page load should do. Stripped from any build
  // where import.meta.env.DEV is false.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as Record<string, unknown>).__seedTemplates = async () => {
      const [{ seedSeasonalTemplates }, { runSavedQueryWithParams }] = await Promise.all([
        import('@/pages/_shared/seed-templates'),
        import('@/pages/orders/order-api'),
      ]);
      // Skip names already present — card_template has no unique constraint on
      // name, so a second run would otherwise duplicate all four.
      const rows = (await runSavedQueryWithParams<{ name?: string }[]>(
        'card_templates',
        {},
      )) as { name?: string }[];
      const existing = new Set(
        (Array.isArray(rows) ? rows : []).map((r) => r.name ?? '').filter(Boolean),
      );
      return seedSeasonalTemplates(existing);
    };
  }, []);

  // Empty cloned app (no user pages yet): render Getting Started full-bleed,
  // OUTSIDE DefaultLayout — no sidebar/topbar to frame an app with nothing in
  // it. Once the agent adds the first page, the normal chrome takes over.
  if (!hasUserPages(USER_ROUTES) && !isBuiltInPagePath(pathname)) {
    return (
      <div className="min-h-svh w-full bg-background text-foreground">
        {/* HelperMenu renders no UI — it IS the parent-frame command listener
            (jiffy:navigate / jiffy:refetch). DefaultLayout normally mounts it,
            but this empty-app branch renders OUTSIDE DefaultLayout, and
            without it the editor's "open /review page" (and any helper-page
            navigation) is silently dropped on the welcome screen. */}
        <HelperMenu />
        <GettingStartedPage />
      </div>
    );
  }

  // Group routes by layout so each group can mount under the right
  // outlet element. `default` routes share one DefaultLayout instance
  // (single chrome + outlet); `blank` routes mount without chrome.
  const defaultRoutes = ALL_ROUTES.filter((r) => r.layout === 'default');
  const blankRoutes = ALL_ROUTES.filter((r) => r.layout === 'blank');

  // Sidebar feeds off the nav-eligible subset (everything except
  // `hideFromNav`). DefaultLayout reads this via useNavRoutes().
  const navItems: NavRouteEntry[] = defaultRoutes
    .filter((r) => !r.hideFromNav)
    .map((r) => ({
      path: r.path,
      label: r.label!,
      icon: r.icon!,
      description: r.description,
      hideFromHelper: r.hideFromHelper,
      permission: r.permission,
      external: r.external,
    }));

  // ALL local route slugs (incl. hideFromNav) — so a tenant menu-config self-app
  // `screen` item can be validated against a route that exists but isn't in the
  // visible nav (e.g. a flyout-only screen). See AllRouteSlugsContext / mergeMenu.
  const allRouteSlugs = new Set(
    defaultRoutes.filter((r) => !r.external).map((r) => r.path.replace(/^\/+/, '')),
  );

  // Every default-layout route's content padding (incl. hideFromNav takeover
  // pages) → published so DefaultLayout can drop `<main>`'s gutter for a
  // `contentPadding: 'none'` route. Separate from navItems, which excludes
  // hideFromNav pages (takeover pages are typically hidden from nav).
  const contentPaddingRoutes: ContentPaddingRoute[] = defaultRoutes
    .filter((r) => !r.external)
    .map((r) => ({ path: r.path, contentPadding: r.contentPadding }));

  // There is no "Home" route; `/` redirects to the first user page so the app
  // opens on real content.
  const indexTarget = firstUserPath(USER_ROUTES);

  // Wrap an element in a screen-permission gate when the route declares one, so
  // deep-linking a path the user lacks access to is blocked (not just hidden
  // from the sidebar). Ungated routes render as-is.
  //
  // Pages authored with lazyWithPreload are warmed by the idle effect above;
  // legacy lazy() routes still load on first navigation. The <Suspense>
  // boundary that catches either load lives in DefaultLayout/BlankLayout
  // (around <Outlet>) — NOT here. PHX-4455.
  const renderRouteElement = (r: PrivateRouteDeclaration) =>
    r.permission ? (
      <PermissionGuard page={r.permission}>{r.element}</PermissionGuard>
    ) : (
      r.element
    );

  return (
    <AllRouteSlugsContext.Provider value={allRouteSlugs}>
      <NavRoutesContext.Provider value={navItems}>
      <ContentPaddingContext.Provider value={contentPaddingRoutes}>
      <DocumentTitle routes={ALL_ROUTES} />
      <Routes>
        {defaultRoutes.length > 0 && (
          <Route element={<DefaultLayout brand={APP_BRAND} />}>
            {indexTarget && (
              <Route path="/" element={<Navigate to={indexTarget} replace />} />
            )}
            {defaultRoutes
              .filter((r) => !r.external)
              .map((r) => (
                <Route key={r.path} path={r.path} element={renderRouteElement(r)} />
              ))}
          </Route>
        )}
        {/* Blank (full-bleed, no chrome) routes mount under BlankLayout — same
            as public blank routes in routes/index.tsx — so lazy pages get its
            Suspense boundary and each gets an ErrorBoundary. Without this
            wrapper a cold chunk on a deep-linked blank route suspends with no
            boundary → hard error (PHX-4455 pattern). */}
        {blankRoutes.length > 0 && (
          <Route element={<BlankLayout />}>
            {blankRoutes
              .filter((r) => !r.external)
              .map((r) => (
                <Route key={r.path} path={r.path} element={renderRouteElement(r)} />
              ))}
          </Route>
        )}
      </Routes>
      </ContentPaddingContext.Provider>
      </NavRoutesContext.Provider>
    </AllRouteSlugsContext.Provider>
  );
}

export default PrivateApp;
