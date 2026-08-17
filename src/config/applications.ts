/**
 * Tenant application catalogue — the source of cross-app metadata.
 *
 * PHX-5792: this replaces `related_applications` from the auth config response
 * (`/public/auth/config`), which is deprecated. Same fields, same
 * environment-scoping, different endpoint:
 *
 *     GET /api/applications?include_app_url=true&exclude_branches=true&type=application
 *
 * | was (related_applications) | now (Application)   |
 * |----------------------------|---------------------|
 * | application_name           | name                |
 * | application_label          | label               |
 * | app_definition             | app_definition      |
 * | app_definition_key         | app_definition_key  |
 * | application_url            | application_url     |
 *
 * TWO THINGS THAT WILL BITE IF CHANGED:
 *
 * 1. It goes through the `tenant` apiManager service, NOT a bare fetch. That
 *    service carries `X-Jiffy-Env`. Without the header app-manager falls back to
 *    `develop` (PrepareExecutionContext) AND `filter.Environment` defaults to
 *    the same value, so the response would be develop's apps carrying develop
 *    URLs — a prod user clicking a cross-app link would land in development.
 *    That is PHX-5724 relocated from data reads to navigation.
 *
 * 2. `include_app_url=true` is REQUIRED. Without it the backend never populates
 *    `application_url` (GetApplicationsWithUrl) and every cross-app link
 *    resolves to `no-application-url`.
 *
 * Loaded once at boot and cached, because `resolveAppUrl` is synchronous — it
 * runs inside an onClick handler, exactly as it did when the data arrived free
 * with the auth config.
 */
import { apiManager } from '@/services/api-manager';
import { getAppConfig } from './api-config';
import { logger } from '@/utils/logger';

/** One application, as returned by `/api/applications`. */
export interface TenantApplication {
  name: string;
  label?: string;
  app_definition?: string;
  app_definition_key: string;
  /** Environment-specific base URL. Only present with `include_app_url=true`. */
  application_url?: string;
  environment?: string;
  status?: string;
}

const APPLICATIONS_ENDPOINT =
  '/applications?include_app_url=true&exclude_branches=true&type=application';

/**
 * sessionStorage cache, mirroring how the auth config is cached
 * (`authConfig__<host>` in services/auth-service.ts).
 *
 * Worth doing because cross-app navigation is a HARD navigation
 * (`window.location.assign`): the in-memory cache dies on every hop, so without
 * this the catalogue is refetched on each page load. It also means links are
 * live immediately on a revisit instead of disabled until the boot fetch lands.
 *
 * Keyed by tenant + env because `application_url` is environment-specific —
 * sharing one key across environments would serve prod a develop URL, which is
 * the failure PHX-5724 was about. Per-tab by nature, so it clears when the tab
 * closes; the TTL covers a publish landing mid-session.
 */
const CACHE_TTL_MS = 5 * 60 * 1000;

function cacheKeyFor(tenant: string, env: string): string {
  return `applications__${tenant}__${env}`;
}

function readSessionCache(tenant: string, env: string): TenantApplication[] | null {
  try {
    const raw = sessionStorage.getItem(cacheKeyFor(tenant, env));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      applications?: TenantApplication[];
      _cachedAt?: number;
    };
    if (!Array.isArray(parsed.applications) || typeof parsed._cachedAt !== 'number') {
      sessionStorage.removeItem(cacheKeyFor(tenant, env));
      return null;
    }
    if (Date.now() - parsed._cachedAt > CACHE_TTL_MS) {
      sessionStorage.removeItem(cacheKeyFor(tenant, env));
      return null;
    }
    return parsed.applications;
  } catch {
    try {
      sessionStorage.removeItem(cacheKeyFor(tenant, env));
    } catch {
      // ignore
    }
    return null;
  }
}

function writeSessionCache(
  tenant: string,
  env: string,
  applications: TenantApplication[],
): void {
  try {
    sessionStorage.setItem(
      cacheKeyFor(tenant, env),
      JSON.stringify({ applications, _cachedAt: Date.now() }),
    );
  } catch {
    // sessionStorage full or disabled — proceed without caching.
  }
}

let cache: TenantApplication[] = [];
let loaded = false;

/**
 * The cached catalogue. Empty until {@link loadApplications} resolves — callers
 * are synchronous and must treat empty as "cannot resolve" rather than "no
 * such app".
 */
export function getApplications(): TenantApplication[] {
  return cache;
}

/** True once a load has completed (successfully or not). */
export function areApplicationsLoaded(): boolean {
  return loaded;
}

/**
 * Fetch + cache the catalogue. Called once during boot, after
 * `initializeApi()` has configured the `tenant` service.
 *
 * Never throws: cross-app navigation is chrome, and a failure here must not
 * take down app start. A failed load leaves the cache empty, which downgrades
 * cross-app links to disabled rather than breaking the page.
 */
export async function loadApplications(): Promise<TenantApplication[]> {
  const { tenant, env } = getAppConfig();

  // Warm from sessionStorage first so links work on this render, then decide
  // whether the network is needed at all.
  const cached = readSessionCache(tenant, env);
  if (cached) {
    cache = cached;
    loaded = true;
    logger.info('applications:from-cache', { count: cache.length, tenant, env });
    return cache;
  }

  try {
    const response = await apiManager.get('tenant', APPLICATIONS_ENDPOINT);
    const body = response?.data;
    cache = Array.isArray(body) ? (body as TenantApplication[]) : [];
    writeSessionCache(tenant, env, cache);
    logger.info('applications:loaded', {
      count: cache.length,
      withUrl: cache.filter((a) => a.application_url).length,
      tenant,
      env,
    });
  } catch (error) {
    cache = [];
    logger.warn('applications:load-failed', {
      error: String(error),
      tenant,
      env,
      hint: 'cross-app navigation will render as disabled links',
    });
  } finally {
    loaded = true;
  }
  return cache;
}

/** Reset for tests. */
export function __resetApplicationsCache(): void {
  cache = [];
  loaded = false;
}

/** Exported for unit tests — the tenant+env keying is the correctness-critical bit. */
export const __testing = { cacheKeyFor, readSessionCache, writeSessionCache, CACHE_TTL_MS };
