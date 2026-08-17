/**
 * Fetch the tenant's **global menu configuration**.
 *
 * Executes the platform saved query with a flat JSON parameter body and follows
 * the session-immutable caching contract of
 * `usePreferences` (fetch ONCE per session, persist to localStorage, seed a
 * placeholder so the first paint doesn't flash).
 *
 * Wire shape: `menu-config-merged` returns one ROW PER ITEM with typed
 * `menu_config` columns (snake_case, no `config` blob) — precedence-resolved
 * server-side per user (current tenant > jiffy base; deepest ancestor org
 * wins). `app_definition_key` identifies the target/owning app for a screen; it
 * does not scope the returned menu. We map each row to a camelCase
 * `MenuConfigItem`, validate it, and hand the list to `buildMenuTree` +
 * `mergeMenu`. A malformed / absent payload yields `undefined`, so the layout
 * falls back to the code-declared nav unchanged.
 */
import { useQuery } from '@tanstack/react-query';
import { apiManager } from '@/services/api-manager';
import { getDataHeaders } from '@/config/api-config';
import { ALLOW_SHARED_MENU_ITEMS } from '@/config/layout';
import { getAuthService } from '@/config/auth-service-manager';
import { logger } from '@/utils/logger';
import {
  MENU_TYPE_VALUES,
  type MenuConfigItem,
  type MenuType,
  type OpenIn,
} from '@/routes/nav-routes-context';

/** The saved query that returns this user's precedence-resolved menu entries. */
const MENU_CONFIG_QUERY = 'menu-config-merged';
// Do not hydrate the old app-scoped payload: its app key had different semantics.
const MENU_CONFIG_STORAGE_KEY = 'jiffy_menu_config_global';
const MENU_CONFIG_QUERY_KEY = ['menu-config'] as const;
const PLATFORM = 'platform';

/** Decode a JWT's `exp` (seconds). Returns null if unparseable. */
function jwtExp(token: string): number | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    const exp = (JSON.parse(json) as { exp?: number }).exp;
    return typeof exp === 'number' ? exp : null;
  } catch {
    return null;
  }
}

/**
 * True only when there's a NON-EXPIRED access token. `DefaultLayout` (which
 * calls this hook) can mount before a fresh token lands, so without this gate
 * the fetch 401s and retries. Mirrors `usePreferences`.
 */
function isAuthenticated(): boolean {
  try {
    const token = getAuthService().getAccessToken();
    if (!token) return false;
    const exp = jwtExp(token);
    if (exp === null) return false;
    return Date.now() < exp * 1000;
  } catch {
    return false;
  }
}

/** Don't retry an auth failure — only a token (not a retry) fixes a 401/403. */
function isAuthError(error: unknown): boolean {
  const status = (error as { response?: { status?: number } } | undefined)?.response?.status;
  return status === 401 || status === 403;
}

/** A non-empty trimmed string, else undefined. */
function optStr(v: unknown): string | undefined {
  if (typeof v === 'string') {
    const t = v.trim();
    return t.length > 0 ? t : undefined;
  }
  return undefined;
}

/** A finite number (coercing numeric strings), else undefined. */
function optNum(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/** Coerce a boolean flag that may arrive as a boolean or a string. */
function optBool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    if (t === 'true') return true;
    if (t === 'false') return false;
  }
  return undefined;
}

/** A plain object (the `meta` bag), else undefined. */
function optObj(v: unknown): Record<string, unknown> | undefined {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

function asOpenIn(v: unknown): OpenIn | undefined {
  return v === 'current_tab' || v === 'new_tab' || v === 'new_window' ? v : undefined;
}

function asMenuType(v: unknown): MenuType | undefined {
  return typeof v === 'string' && (MENU_TYPE_VALUES as readonly string[]).includes(v)
    ? (v as MenuType)
    : undefined;
}

/**
 * Items that render on the left-rail sidebar: `menu_type === 'sidebar'` or unset
 * (unset defaults to sidebar for back-compat with rows that predate menu_type).
 * Pure + exported for testing; the layout filters with this before building the
 * tree so header/footer/user-account/mobile items don't leak onto the rail.
 */
export function filterSidebarItems(items: MenuConfigItem[]): MenuConfigItem[] {
  return items.filter((i) => !i.menuType || i.menuType === 'sidebar');
}

/**
 * Map ONE `menu_config` row (snake_case columns) to a camelCase `MenuConfigItem`.
 * Returns null when the row can't yield its required `itemKey` and target app.
 */
export function mapMenuRow(row: unknown): MenuConfigItem | null {
  if (typeof row !== 'object' || row === null) return null;
  const r = row as Record<string, unknown>;
  const itemKey = optStr(r.item_key);
  const appDefinitionKey = optStr(r.app_definition_key);
  const name = optStr(r.name);
  if (!itemKey || !appDefinitionKey) return null;
  return {
    itemKey,
    appDefinitionKey,
    name: name ?? itemKey,
    menuType: asMenuType(r.menu_type),
    description: optStr(r.description),
    icon: optStr(r.icon),
    screen: optStr(r.screen),
    url: optStr(r.url),
    flyoutRef: optStr(r.flyout_ref),
    linkType: optStr(r.link_type),
    openIn: asOpenIn(r.open_in),
    windowWidth: optNum(r.window_width),
    windowHeight: optNum(r.window_height),
    parentKey: optStr(r.parent_key),
    sortOrder: optNum(r.sort_order),
    hidden: optBool(r.hidden),
    meta: optObj(r.meta),
  };
}

/**
 * Whether a mapped item is usable: `itemKey && appDefinitionKey && (screen ||
 * url || flyoutRef)`, with `screen`/`url` mutually exclusive. Validation is
 * FIELD-based only — `link_type` is not enforced, because the seeded data shows
 * it isn't a reliable kind flag (a flyout row carries `link_type: "screen"`);
 * `mergeMenu` infers the kind from the populated fields. Unusable items are
 * warn-dropped. Exported for testing.
 */
export function isUsableMenuItem(item: MenuConfigItem): boolean {
  if (
    !item.itemKey ||
    typeof item.appDefinitionKey !== 'string' ||
    !item.appDefinitionKey.trim()
  ) {
    return false;
  }
  const hasScreen = !!item.screen;
  const hasUrl = !!item.url;
  const hasFlyout = !!item.flyoutRef;
  if (!hasScreen && !hasUrl && !hasFlyout) return false;
  // screen and url are mutually exclusive primary targets.
  if (hasScreen && hasUrl) return false;
  return true;
}

/** Coerce a raw response into the array of item rows (defensive shapes). */
function toRows(raw: unknown): unknown[] | undefined {
  let value: unknown = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  if (Array.isArray(value)) return value;
  if (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { items?: unknown }).items)
  ) {
    return (value as { items: unknown[] }).items;
  }
  return undefined;
}

/**
 * Parse a raw `menu-config-merged` response into validated `MenuConfigItem[]`.
 * Pure and exported for unit testing. Returns `undefined` only when the
 * STRUCTURE is unparseable (→ fall back to code nav); a parseable payload with
 * no usable rows yields `[]` (a code-nav no-op). Unusable rows are dropped with
 * a `menu-config:invalid-row` warn.
 */
export function parseMenuConfig(raw: unknown): MenuConfigItem[] | undefined {
  if (raw === null || raw === undefined) return undefined;
  const rows = toRows(raw);
  if (!rows) return undefined;

  const items: MenuConfigItem[] = [];
  for (const row of rows) {
    const item = mapMenuRow(row);
    if (!item) continue;
    if (!isUsableMenuItem(item)) {
      logger.warn('menu-config:invalid-row', {
        itemKey: item.itemKey,
        linkType: item.linkType,
        hasScreen: !!item.screen,
        hasUrl: !!item.url,
        hasFlyout: !!item.flyoutRef,
      });
      continue;
    }
    items.push(item);
  }
  return items;
}

function persistToStorage(data: MenuConfigItem[] | undefined): void {
  try {
    if (data === undefined) return;
    localStorage.setItem(MENU_CONFIG_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Storage full or unavailable — non-fatal.
  }
}

export function getStoredMenuConfig(): MenuConfigItem[] | undefined {
  try {
    const rawStr = localStorage.getItem(MENU_CONFIG_STORAGE_KEY);
    if (!rawStr) return undefined;
    // Stored value is already the camelCase MenuConfigItem[]; re-validate.
    const parsed = JSON.parse(rawStr);
    if (!Array.isArray(parsed)) return undefined;
    return parsed.filter(
      (i): i is MenuConfigItem =>
        typeof i === 'object' && i !== null && isUsableMenuItem(i as MenuConfigItem),
    );
  } catch {
    return undefined;
  }
}

/** Build the tenant-global menu request; `user` is its only query input. */
export function buildMenuConfigExecuteRequest(userId: string): {
  url: string;
  body: { user: string };
} {
  return {
    url: `/saved-queries/${MENU_CONFIG_QUERY}/execute`,
    body: { user: userId },
  };
}

async function fetchMenuConfig(): Promise<MenuConfigItem[] | undefined> {
  // The merged menu is tenant-global and precedence-resolved for the user.
  // app_definition_key belongs to each returned target row and must not scope
  // this read.
  const userId = getAuthService().getJiffyUserId();
  if (!userId) return undefined;

  const { url, body } = buildMenuConfigExecuteRequest(userId);
  try {
    const res = await apiManager.post('data', url, body, getDataHeaders(PLATFORM));
    return parseMenuConfig(res.data);
  } catch (e) {
    // Best-effort: a missing/unpublished menu config must NOT break the app —
    // the layout falls back to code nav. Log for diagnosability.
    if (!isAuthError(e)) {
      logger.warn('menu-config:fetch-error', { error: String(e) });
    }
    return undefined;
  }
}

/**
 * Session-immutable tenant-global menu config. Fetches once, serves the cached
 * value thereafter, and seeds from localStorage so the sidebar doesn't flash
 * before the first fetch resolves. `undefined` → the layout uses the
 * code-declared nav unchanged.
 */
export function useMenuConfig() {
  return useQuery<MenuConfigItem[] | undefined>({
    queryKey: MENU_CONFIG_QUERY_KEY,
    queryFn: async () => {
      // App opted out of the tenant-wide rail — skip the request entirely and
      // hand the layout an empty menu, so no cross-app item can be merged in.
      // See ALLOW_SHARED_MENU_ITEMS in src/config/layout.ts.
      if (!ALLOW_SHARED_MENU_ITEMS) return [];
      const data = await fetchMenuConfig();
      persistToStorage(data);
      return data;
    },
    // Only once authenticated — DefaultLayout can mount above a fresh token.
    enabled: isAuthenticated(),
    // A 401/403 won't be fixed by retrying; only retry transient errors once.
    retry: (count, error) => !isAuthError(error) && count < 1,
    // Immutable per session: fetch once, don't refetch on remount/focus.
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    // Seed from localStorage so the merged sidebar is stable on first paint.
    // When opted out, seed empty instead — a previously-cached tenant menu
    // would otherwise flash cross-app items onto the rail before the query
    // resolves.
    placeholderData: () => (ALLOW_SHARED_MENU_ITEMS ? getStoredMenuConfig() : []),
  });
}
