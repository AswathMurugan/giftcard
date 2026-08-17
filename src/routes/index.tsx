/**
 * Top-level router for the starter app.
 *
 * STARTER-OWNED, READ-ONLY. The agent does NOT edit this file; it edits
 * `src/PrivateApp.tsx` to add per-tenant routes. This file's job is
 * to:
 *
 *   1. Mount the public (auth-free) routes under their layouts.
 *   2. Drop everything else behind a `RequireAuth` gate that renders
 *      `<PrivateApp />` (agent-owned).
 *   3. Mount the scaffolding routes (`/showcase`, `/test-results`,
 *      `/error-boundary-demo`) under a separate `DefaultLayout` so
 *      they're always reachable for debugging the cloned app's design
 *      choices without polluting the cloned app's sidebar.
 *
 * The scaffolding routes are intentionally OUTSIDE PrivateApp — they
 * exist to verify the starter chrome itself and shouldn't appear in
 * the cloned app's nav. The HelperMenu (`src/components/shared/HelperMenu.tsx`)
 * reads these via `scaffoldingRoutes()` and surfaces them as
 * always-on debug links.
 */
import { lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import { BlankLayout, DefaultLayout } from '@/layouts';
import { RequireAuth } from '@/auth/RequireAuth';
import { publicRoutes } from './public-routes';
import { PrivateApp } from '@/PrivateApp';
import { getRegisteredPrivateRoutes } from './private-route-registry';
import type { AnyRouteConfig, LayoutKey, NavRouteConfig } from './types';
import { GettingStartedPage } from '@/pages/getting-started/GettingStartedPage';
import { privateRoutesDeclarePreference } from './built-in-routes';
import { buildPrivateRouteContext } from './private-route-context';
import {
  AllRouteSlugsContext,
  ContentPaddingContext,
  NavRoutesContext,
} from './nav-routes-context';

// Scaffolding/debug pages are lazy-loaded: they're reachable only via the
// HelperMenu, so their (heavy) module graphs — ShowcasePage alone pulls every
// `@/components/ui/*` primitive + ag-grid — must NOT sit in the initial preview
// bundle. `lazy()` keeps them out until actually navigated to. They mount under
// DefaultLayout, whose <Outlet> Suspense boundary covers the chunk load, so no
// per-route wrapper is needed here. GettingStarted stays eager: it's the
// empty-app landing and must render immediately.
const ShowcasePage = lazy(() =>
  import('@/pages/showcase/ShowcasePage').then((m) => ({ default: m.ShowcasePage })));
const TestResultsPage = lazy(() =>
  import('@/pages/test-results/TestResultsPage').then((m) => ({ default: m.TestResultsPage })));
const ErrorBoundaryDemoPage = lazy(() =>
  import('@/pages/error-boundary-demo/ErrorBoundaryDemoPage').then((m) => ({ default: m.ErrorBoundaryDemoPage })));
const LogViewerPage = lazy(() =>
  import('@/pages/log-viewer/LogViewerPage').then((m) => ({ default: m.LogViewerPage })));
const ReviewPage = lazy(() =>
  import('@/pages/review/ReviewPage').then((m) => ({ default: m.ReviewPage })));
const PreferencePage = lazy(() =>
  import('@/pages/preference-viewer/PreferencePage').then((m) => ({ default: m.PreferencePage })));

// Existing app branches preserve their agent-owned PrivateApp.tsx through a
// starter sync. Mount a compatibility route only when its normalized route
// declarations do not already own `/preference`; this avoids intercepting a
// legacy user page that used the now-reserved slug before the viewer shipped.
const REGISTERED_PRIVATE_ROUTES = getRegisteredPrivateRoutes();
const NEEDS_PREFERENCE_COMPAT_ROUTE =
  !privateRoutesDeclarePreference(REGISTERED_PRIVATE_ROUTES);
const PREFERENCE_COMPAT_CONTEXT = buildPrivateRouteContext(
  REGISTERED_PRIVATE_ROUTES,
  ['preference'],
);

function PreferenceCompatLayout() {
  return (
    <AllRouteSlugsContext.Provider value={PREFERENCE_COMPAT_CONTEXT.allRouteSlugs}>
      <NavRoutesContext.Provider value={PREFERENCE_COMPAT_CONTEXT.navItems}>
        <ContentPaddingContext.Provider value={PREFERENCE_COMPAT_CONTEXT.contentPaddingRoutes}>
          <RequireAuth>
            <DefaultLayout />
          </RequireAuth>
        </ContentPaddingContext.Provider>
      </NavRoutesContext.Provider>
    </AllRouteSlugsContext.Provider>
  );
}

function groupByLayout<T extends AnyRouteConfig>(routes: T[]): Record<LayoutKey, T[]> {
  const groups: Record<LayoutKey, T[]> = { default: [], blank: [] };
  for (const route of routes) {
    const key = route.layout ?? 'default';
    groups[key].push(route);
  }
  return groups;
}

function toRouteElements(routes: AnyRouteConfig[]) {
  return routes.map((r) => <Route key={r.path} path={r.path} element={r.element} />);
}

/**
 * Always-on debug pages. Mounted under their own `DefaultLayout`
 * instance with an empty `navItems` so the cloned app's sidebar isn't
 * polluted. Surfaced via `HelperMenu`. The agent does NOT touch these.
 */
// Route metadata is intentionally exported for HelperMenu and route tests.
// eslint-disable-next-line react-refresh/only-export-components
export function scaffoldingRoutes() {
  const routes: NavRouteConfig[] = [
    {
      path: '/getting-started',
      label: 'Getting Started',
      icon: 'icon_-Tb_compass',
      element: <GettingStartedPage />,
      description: 'Learn what the starter is and how to prompt for pages.',
    },
    {
      path: '/showcase',
      label: 'Showcase',
      icon: 'icon_-Tb_sparkles',
      element: <ShowcasePage />,
      description: 'Browse every UI component in one place.',
    },
    {
      path: '/test-results',
      label: 'Test Results',
      icon: 'icon_-Tb_flask',
      element: <TestResultsPage />,
      description: 'Inspect the latest automated test run.',
    },
    {
      path: '/error-boundary-demo',
      label: 'Error Boundary',
      icon: 'icon_-Tb_shield',
      element: <ErrorBoundaryDemoPage />,
      description: 'See how runtime errors are gracefully handled.',
    },
    {
      path: '/logs',
      label: 'Logs',
      icon: 'icon_-Tb_article',
      element: <LogViewerPage />,
      description: 'View, filter, and triage in-app log events.',
    },
    {
      path: '/review',
      label: 'Review',
      icon: 'icon_-Tb_clipboard_check',
      element: <ReviewPage />,
      description: 'Latest AI code review with one-click fixes.',
    },
  ];
  return routes;
}

export function AppRoutes() {
  const publicGroups = groupByLayout(publicRoutes);
  const scaffolding = scaffoldingRoutes();

  return (
    <Routes>
      {/* ── Public ─────────────────────────────────────────── */}
      {publicGroups.blank.length > 0 && (
        <Route element={<BlankLayout />}>{toRouteElements(publicGroups.blank)}</Route>
      )}
      {publicGroups.default.length > 0 && (
        <Route element={<DefaultLayout />}>
          {toRouteElements(publicGroups.default)}
        </Route>
      )}

      {/* ── Scaffolding (always-on debug pages) ────────────── */}
      {scaffolding.length > 0 && (
        <Route element={<DefaultLayout brand="Scaffolding" navItems={[]} />}>
          {toRouteElements(scaffolding)}
        </Route>
      )}

      {/* ── Private (auth-gated) ───────────────────────────── */}
      {NEEDS_PREFERENCE_COMPAT_ROUTE && (
        <Route element={<PreferenceCompatLayout />}>
          <Route path="/preference" element={<PreferencePage />} />
        </Route>
      )}
      {/* PrivateApp owns its own <Routes> + DefaultLayout chrome; we
          just gate the whole subtree behind RequireAuth and mount it
          on the wildcard so PrivateApp can declare paths freely. */}
      <Route
        path="/*"
        element={
          <RequireAuth>
            <PrivateApp />
          </RequireAuth>
        }
      />
    </Routes>
  );
}

export default AppRoutes;
