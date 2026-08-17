import { useMemo, type ReactNode } from 'react';
import {
  getStoredPermissionMap,
  hasReadOrWrite,
  usePermissions,
} from '@/queries/use-permissions';
import { Pages, getScreenResourceKey } from '@/constants/pages';

interface PermissionGuardProps {
  /**
   * Screen to check. A known `Pages` slug, or any raw screen name (e.g. a
   * route's `permission` = the `register_screen`/`buildSchema` page name).
   */
  page: Pages | (string & {});
  /** Rendered when the user lacks read/write on the page. Defaults to `null`. */
  fallback?: ReactNode;
  children: ReactNode;
}

/**
 * Gate children behind the current user's screen permissions.
 *
 * Looks up `<appDefinition>.screen.<page>` in the permission map cached
 * by `usePermissions()`. Renders `children` when the user has either
 * `read` or `write` for that resource, otherwise renders `fallback`.
 *
 * Uses the localStorage-cached map for synchronous first paint and
 * subscribes to `usePermissions()` for live updates (the hook itself
 * refetches on every authenticated route load).
 */
export function PermissionGuard({
  page,
  fallback = null,
  children,
}: PermissionGuardProps) {
  const { data } = usePermissions();
  const resourceKey = useMemo(() => getScreenResourceKey(page), [page]);

  const map = data ?? getStoredPermissionMap();
  const allowed = hasReadOrWrite(map, resourceKey);

  return <>{allowed ? children : fallback}</>;
}

export default PermissionGuard;
