import type { PrivateRouteDeclaration } from './PrivateRoute';
import type {
  ContentPaddingRoute,
  NavRouteEntry,
} from './nav-routes-context';

export interface PrivateRouteContextValues {
  navItems: NavRouteEntry[];
  allRouteSlugs: ReadonlySet<string>;
  contentPaddingRoutes: ContentPaddingRoute[];
}

/** Build the three route contexts normally supplied by PrivateApp. */
export function buildPrivateRouteContext(
  routes: PrivateRouteDeclaration[],
  extraLocalSlugs: string[] = [],
): PrivateRouteContextValues {
  const defaultRoutes = routes.filter((route) => route.layout === 'default');
  const navItems = defaultRoutes
    .filter((route) => !route.hideFromNav)
    .map((route) => ({
      path: route.path,
      label: route.label!,
      icon: route.icon!,
      description: route.description,
      hideFromHelper: route.hideFromHelper,
      permission: route.permission,
      external: route.external,
    }));
  const allRouteSlugs = new Set(extraLocalSlugs);
  for (const route of defaultRoutes) {
    if (!route.external) allRouteSlugs.add(route.path.replace(/^\/+/, ''));
  }
  const contentPaddingRoutes = defaultRoutes
    .filter((route) => !route.external)
    .map((route) => ({
      path: route.path,
      contentPadding: route.contentPadding,
    }));

  return { navItems, allRouteSlugs, contentPaddingRoutes };
}
