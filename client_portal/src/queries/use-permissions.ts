import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiManager } from '@/services/api-manager';
import { getAppConfig } from '@/config/api-config';
import { getAuthService } from '@/config/auth-service-manager';

const PERMISSIONS_STORAGE_KEY = 'jiffy_permissions';
const PERMISSIONS_QUERY_KEY = ['permissions'] as const;
const COMPONENT_PERMISSIONS_STORAGE_PREFIX = 'jiffy_component_permissions:';

export interface Permission {
  resource: string;
  resource_type: string;
  action: string;
  permission: string;
}

/**
 * Normalised permission map:
 *   key   = full resource string (e.g. "wealthdomain__V0_0_1.screen.home")
 *   value = list of allowed actions (e.g. ["read", "write"])
 *
 * Only entries with `permission === 'allow'` are kept; denies become
 * absences. Synchronous reads from localStorage rely on this shape.
 */
export type PermissionMap = Record<string, string[]>;

/** Actions that count as "may access" a screen. */
export const SCREEN_ALLOWED_ACTIONS = ['read', 'write'] as const;

/** True when the map grants read or write for the given screen resource key. */
export function hasReadOrWrite(
  map: PermissionMap | null | undefined,
  key: string,
): boolean {
  if (!map) return false;
  const actions = map[key];
  if (!actions || actions.length === 0) return false;
  return SCREEN_ALLOWED_ACTIONS.some((a) => actions.includes(a));
}

export function normalisePermissions(list: Permission[]): PermissionMap {
  const map: Record<string, Set<string>> = {};
  for (const item of list) {
    if (!item || item.permission !== 'allow') continue;
    const resource = item.resource;
    const action = item.action;
    if (!resource || !action) continue;
    if (!map[resource]) map[resource] = new Set();
    map[resource].add(action);
  }
  const out: PermissionMap = {};
  for (const [resource, actions] of Object.entries(map)) {
    out[resource] = Array.from(actions);
  }
  return out;
}

function persistToStorage(data: PermissionMap): void {
  try {
    localStorage.setItem(PERMISSIONS_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Storage full or unavailable — non-fatal
  }
}

export function getStoredPermissionMap(): PermissionMap | null {
  try {
    const raw = localStorage.getItem(PERMISSIONS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PermissionMap) : null;
  } catch {
    return null;
  }
}

async function fetchPermissions(): Promise<PermissionMap> {
  const config = getAppConfig();
  const userId = getAuthService().getJiffyUserId();
  if (!userId) {
    // Without a user id the API would 4xx; treat as no permissions.
    return {};
  }
  const response = await apiManager.get(
    'proxy',
    `/api/permissions?user_id=${encodeURIComponent(userId)}&resource_type=screen`,
    {
      // Read under the CURRENT app (matches the write lens: component grants are
      // written under this app_definition_key). 'platform' is a different lens.
      'X-Jiffy-App-Name': config.appName,
      'X-Jiffy-Tenant': config.tenant,
    },
  );
  const list = (response.data ?? []) as Permission[];
  return normalisePermissions(list);
}

/**
 * Fetches the current user's screen permissions from the platform API.
 *
 * Permissions are immutable for the session, so this fetches ONCE and serves
 * the cached value thereafter — no refetch on every component mount or window
 * focus. A genuine page reload refetches.
 *
 * - Persists the normalised map to localStorage as a synchronous cache
 *   for `PermissionGuard` first-paint reads.
 * - `placeholderData` seeds from localStorage so the UI doesn't flash
 *   while the first fetch is in flight.
 */
export function usePermissions() {
  return useQuery<PermissionMap>({
    queryKey: PERMISSIONS_QUERY_KEY,
    queryFn: async () => {
      const data = await fetchPermissions();
      persistToStorage(data);
      return data;
    },
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    placeholderData: () => getStoredPermissionMap() ?? undefined,
  });
}

// ── Component-level (screen_component) permissions ─────────────────────────
//
// Per-component access control for customizable primitives marked
// `permission: true` in their schema slot. A flagged component renders only
// if its name is in the user's allowed set for the page; an unflagged
// component is never gated (see useComponentConfig).
//
// Resource model (matches the renderer / platform):
//   resource:             <appDefKey>.screen.<componentName>
//   resource_type:        screen_component
//   parent_resource_id:   <appDefKey>.screen.<pageName>
//   parent_resource_type: screen

/** Set of component names the user is allowed to see on a given page. */
export type AllowedComponentSet = Set<string>;

function componentPermStorageKey(page: string): string {
  return `${COMPONENT_PERMISSIONS_STORAGE_PREFIX}${page}`;
}

function persistComponentPerms(page: string, names: string[]): void {
  try {
    localStorage.setItem(componentPermStorageKey(page), JSON.stringify(names));
  } catch {
    // non-fatal
  }
}

export function getStoredComponentPerms(page: string): AllowedComponentSet | null {
  try {
    const raw = localStorage.getItem(componentPermStorageKey(page));
    return raw ? new Set(JSON.parse(raw) as string[]) : null;
  } catch {
    return null;
  }
}

/**
 * Extract the bare component name from a screen_component resource string.
 * `<appDefKey>.screen.<componentName>` → `<componentName>`. Falls back to the
 * last dot segment so we tolerate format drift.
 */
export function componentNameFromResource(resource: string): string {
  const marker = '.screen.';
  const idx = resource.lastIndexOf(marker);
  if (idx !== -1) return resource.slice(idx + marker.length);
  const dot = resource.lastIndexOf('.');
  return dot === -1 ? resource : resource.slice(dot + 1);
}

/** Normalise raw screen_component permission entries → allowed name set. */
export function normaliseComponentPermissions(list: Permission[]): string[] {
  const out = new Set<string>();
  for (const item of list) {
    if (!item || item.permission !== 'allow') continue;
    if (!item.resource) continue;
    out.add(componentNameFromResource(item.resource));
  }
  return Array.from(out);
}

async function fetchComponentPermissions(page: string): Promise<string[]> {
  const config = getAppConfig();
  const userId = getAuthService().getJiffyUserId();
  if (!userId) return [];

  const appDefKey = config.appDefinitionKey;
  const parentResourceId = `${appDefKey}.screen.${page}`;
  const params = new URLSearchParams({
    user_id: userId,
    resource_type: 'screen_component',
    action: 'write',
    parent_resource_type: 'screen',
    parent_resource_id: parentResourceId,
  });

  const response = await apiManager.get(
    'proxy',
    `/api/permissions?${params.toString()}`,
    {
      // Read under the CURRENT app (matches the write lens: create_component_permission
      // writes grants under this app_definition_key). 'platform' is a different lens.
      'X-Jiffy-App-Name': config.appName,
      'X-Jiffy-Tenant': config.tenant,
    },
  );
  const list = (response.data ?? []) as Permission[];
  return normaliseComponentPermissions(list);
}

/**
 * Fetch the current user's allowed component set for a page (one network
 * call per page). Used to gate components flagged `permission: true` in the
 * schema. Components NOT returned here are hidden; unflagged components never
 * consult this.
 *
 * Returns `undefined` while loading (callers should fail-open during load to
 * avoid a flash), then the resolved allowed set.
 */
export function useComponentPermissions(page: string) {
  return useQuery<AllowedComponentSet>({
    queryKey: ['component-permissions', page],
    queryFn: async () => {
      const names = await fetchComponentPermissions(page);
      persistComponentPerms(page, names);
      return new Set(names);
    },
    // Immutable per session: fetch once per page, no remount/focus refetch.
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    placeholderData: () => getStoredComponentPerms(page) ?? undefined,
    enabled: Boolean(page),
  });
}

/**
 * Returns a function that imperatively refetches permissions.
 * Call after login success or session renewal.
 */
export function usePrefetchPermissions() {
  const queryClient = useQueryClient();

  return async () => {
    const data = await queryClient.fetchQuery<PermissionMap>({
      queryKey: PERMISSIONS_QUERY_KEY,
      queryFn: async () => {
        const result = await fetchPermissions();
        persistToStorage(result);
        return result;
      },
      staleTime: 0,
    });
    return data;
  };
}
