import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiManager } from '@/services/api-manager';
import { getAppConfig } from '@/config/api-config';
import { getAuthService } from '@/config/auth-service-manager';
import { PREFERENCES as BAKED_PREFERENCES } from '@/types/preferences.generated';

const PREFERENCES_STORAGE_KEY = 'jiffy_preferences';
const PREFERENCES_QUERY_KEY = ['preferences'] as const;

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
 * True only when there's a NON-EXPIRED access token. The preference providers
 * (BrandingProvider / ConfigProvider) mount ABOVE the auth gate, so without
 * this check the merged-preferences fetch fires on the login screen → a 401
 * (which React Query then retries, the loop you'd see in the network panel).
 *
 * Presence alone is NOT enough: a stale/expired token cookie lingers after a
 * session ends, so `getAccessToken()` returns a non-empty (but rejected)
 * string. We must verify the token hasn't expired. Login calls
 * usePrefetchPreferences() once a fresh token lands.
 */
function isAuthenticated(): boolean {
  try {
    const token = getAuthService().getAccessToken();
    if (!token) return false;
    const exp = jwtExp(token);
    // No decodable expiry → treat as not authenticated (fail safe).
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

export interface Preference {
  id: string;
  app_definition_key: string;
  app_definition: string;
  name: string;
  value: string;
  description?: string;
  category: string;
  org: string | { id: string } | null;
  user: string | { id: string } | null;
  component_id?: string;
  display_type?: string;
  disabled: boolean;
  preference_target?: string;
  draft: boolean;
  is_secret: boolean;
  type?: string;
}

const PREFERENCE_PAGE_SIZE = 100;
const MAX_PREFERENCE_RECORDS = 10_000;

/** Fetch every preference page; fail if an endpoint ignores offset pagination. */
export async function fetchAllPreferencePages(
  fetchPage: (offset: number, limit: number) => Promise<Preference[]>,
  pageSize = PREFERENCE_PAGE_SIZE,
): Promise<Preference[]> {
  const all: Preference[] = [];
  let previousFullPage = '';
  for (let offset = 0; offset < MAX_PREFERENCE_RECORDS; offset += pageSize) {
    const page = await fetchPage(offset, pageSize);
    all.push(...page);
    if (page.length < pageSize) return all;
    const signature = page.map((preference) => preference.id).join('|');
    if (offset > 0 && signature === previousFullPage) {
      throw new Error('Preferences endpoint ignored offset pagination');
    }
    previousFullPage = signature;
  }
  throw new Error(`Preferences response exceeded ${MAX_PREFERENCE_RECORDS} records`);
}

function persistToStorage(data: Preference[]): void {
  try {
    localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Storage full or unavailable — non-fatal
  }
}

export function getStoredPreferences(): Preference[] | null {
  try {
    const raw = localStorage.getItem(PREFERENCES_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * The app lens the per-org branding preferences live under. Tenant.Theme (and
 * Tenant.Logo/Favicon) are written with `app_definition_key: 'platform'`, one
 * Tenant.Theme record PER ORG; the backend resolves the one that applies to the
 * caller's org when `is_merged=true`. They are NOT returned under the current
 * app's lens, so they need their own fetch. (PHX-5283)
 */
export const PLATFORM_APP_LENS = 'Platform';

/**
 * Fetch the platform-lens `Tenant.*` branding preferences (the per-org brand
 * theme). Mirrors the renderer's companion fetch
 * (`GET /preferences?name_prefix=Tenant.&is_merged=true`, app name `Platform`):
 * `is_merged=true` makes Phoenix resolve the record for the caller's org, so no
 * org param is needed. The caller keeps this best-effort for global branding,
 * while exposing a partial-fetch status to views that require Tenant.* data.
 */
async function fetchTenantBrandingPreferences(
  tenant: string,
): Promise<Preference[]> {
  return fetchAllPreferencePages(async (offset, limit) => {
    const params = new URLSearchParams({
      name_prefix: 'Tenant.',
      is_merged: 'true',
      offset: String(offset),
      limit: String(limit),
    });
    const response = await apiManager.get(
      'proxy',
      `/api/preferences?${params.toString()}`,
      {
        'X-Jiffy-App-Name': PLATFORM_APP_LENS,
        'X-Jiffy-Tenant': tenant,
      },
    );
    return Array.isArray(response.data) ? response.data : [];
  });
}

/**
 * Merge the app-lens preferences with the platform-lens `Tenant.*` branding
 * ones. Tenant records go LAST so `extractBranding`'s last-match-wins resolution
 * picks the platform (org-resolved) `Tenant.Theme` over any stale copy that the
 * app-lens merge might also carry.
 */
export function mergePreferences(
  appPrefs: Preference[],
  tenantPrefs: Preference[],
): Preference[] {
  return tenantPrefs.length > 0 ? [...appPrefs, ...tenantPrefs] : appPrefs;
}

export interface PreferenceQueryData {
  preferences: Preference[];
  tenantPreferencesError: boolean;
}

async function fetchPreferences(): Promise<PreferenceQueryData> {
  const config = getAppConfig();
  // Two lenses, fetched concurrently:
  //  - the CURRENT app (App.* + this app's own prefs; matches the write lens
  //    used by create_preference), and
  //  - the `platform` lens for the per-org Tenant.* branding (the brand theme),
  //    which never surfaces under the app lens.
  const [appPrefs, tenantResult] = await Promise.all([
    fetchAllPreferencePages(async (offset, limit) => {
      const params = new URLSearchParams({
        is_merged: 'true',
        offset: String(offset),
        limit: String(limit),
      });
      const response = await apiManager.get('proxy', `/api/preferences?${params.toString()}`, {
        'X-Jiffy-App-Name': config.appName,
        'X-Jiffy-Tenant': config.tenant,
      });
      return Array.isArray(response.data) ? response.data : [];
    }),
    fetchTenantBrandingPreferences(config.tenant).then(
      (preferences) => ({ preferences, error: false }),
      () => ({ preferences: [], error: true }),
    ),
  ]);
  return {
    preferences: mergePreferences(appPrefs, tenantResult.preferences),
    tenantPreferencesError: tenantResult.error,
  };
}

/**
 * Fetches merged preferences from the app manager API.
 *
 * Preferences are immutable for the session, so this fetches ONCE and then
 * serves the cached value for the rest of the session — no refetch on every
 * component mount or window focus. A genuine page reload clears the in-memory
 * cache and refetches, so fresh prefs still take effect on reload.
 *
 * - Persists the response to localStorage as a cache for synchronous
 *   reads elsewhere in the app.
 * - `placeholderData` seeds from localStorage so the UI doesn't flash
 *   while the first fetch is in flight.
 */
export function usePreferences() {
  const query = useQuery<PreferenceQueryData>({
    queryKey: PREFERENCES_QUERY_KEY,
    queryFn: async () => {
      const data = await fetchPreferences();
      persistToStorage(data.preferences);
      return data;
    },
    // Only run once authenticated — the providers mount above the auth gate,
    // so without this the fetch 401s on the login screen and retries.
    enabled: isAuthenticated(),
    // A 401/403 won't be fixed by retrying (it needs a token); only retry
    // genuine transient errors, once.
    retry: (count, error) => !isAuthError(error) && count < 1,
    // Immutable per session: fetch once, don't refetch on remount/focus.
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    // Placeholder while the first fetch is in flight (or before auth): prefer
    // localStorage, else the branding prefs baked at workspace bootstrap by
    // fetch-preferences.ts. This lets BrandingProvider apply the tenant/app
    // favicon + theme on first paint; the live merged fetch then overrides.
    placeholderData: () => {
      const preferences =
        getStoredPreferences() ??
        (BAKED_PREFERENCES.length > 0
          ? (BAKED_PREFERENCES as unknown as Preference[])
          : undefined);
      return preferences
        ? { preferences, tenantPreferencesError: false }
        : undefined;
    },
  });

  return {
    ...query,
    data: query.data?.preferences,
    tenantPreferencesError: query.data?.tenantPreferencesError ?? false,
  };
}

/**
 * Returns a function that imperatively refetches preferences.
 * Call after login success or session renewal.
 */
export function usePrefetchPreferences() {
  const queryClient = useQueryClient();

  return async () => {
    const data = await queryClient.fetchQuery<PreferenceQueryData>({
      queryKey: PREFERENCES_QUERY_KEY,
      queryFn: async () => {
        const result = await fetchPreferences();
        persistToStorage(result.preferences);
        return result;
      },
      staleTime: 0,
    });
    return data.preferences;
  };
}
