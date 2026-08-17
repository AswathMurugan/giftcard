import type { NavRouteEntry } from './nav-routes-context';

/** Built-in local routes supplied by the starter rather than generated pages. */
export const BUILT_IN_LOCAL_ROUTE_SLUGS: ReadonlySet<string> = new Set(['preference']);

export const PREFERENCE_NAV_ROUTE: NavRouteEntry = {
  path: '/preference',
  label: 'Preferences',
  icon: 'icon_-Tb_adjustments_horizontal',
};

export function withDefaultPreferenceNav(
  routes: NavRouteEntry[],
  privateAppDeclaresRoute: boolean,
): NavRouteEntry[] {
  if (
    privateAppDeclaresRoute ||
    routes.some((route) => route.path === PREFERENCE_NAV_ROUTE.path)
  ) {
    return routes;
  }
  return [...routes, PREFERENCE_NAV_ROUTE];
}

/** True when normalized PrivateApp declarations already own the reserved route. */
export function privateRoutesDeclarePreference(
  routes: ReadonlyArray<{ path: string }>,
): boolean {
  return routes.some(
    (route) => (route.path.replace(/\/+$/, '') || '/').toLowerCase() === '/preference',
  );
}
