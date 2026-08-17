import type { PrivateRouteDeclaration } from './PrivateRoute';

// PrivateApp is imported before the top-level router renders, so its module-level
// PrivateRoute/ExternalNavItem calls populate this registry. The compatibility
// preference route uses the snapshot to recreate the old app's nav contexts.
const registeredRoutes = new Map<string, PrivateRouteDeclaration>();

export function registerPrivateRoute(
  route: PrivateRouteDeclaration,
): PrivateRouteDeclaration {
  registeredRoutes.set(route.path, route);
  return route;
}

export function getRegisteredPrivateRoutes(): PrivateRouteDeclaration[] {
  return Array.from(registeredRoutes.values());
}
