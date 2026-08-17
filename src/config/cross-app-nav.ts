/**
 * Cross-app navigation resolver.
 *
 * Turns a declarative cross-app target (`appKey` + `screen` + `navVars`) into a
 * concrete URL, using the `application_url` carried by each entry in the tenant
 * application catalogue (`/api/applications`, see src/config/applications.ts).
 * `application_url` is **environment-specific** — the catalogue request is
 * env-scoped by `X-Jiffy-Env` — so the SAME resolver works in dev / sandbox /
 * prod with no branching. See docs/CROSS-APP-NAVIGATION-PLAN.md §6.
 *
 * PHX-5792: the catalogue previously came from the auth config's
 * `related_applications`, now deprecated. Only the source changed; the
 * resolution logic below is untouched.
 *
 * Screens declare `nav.*` navigation variables (see
 * `src/types/related-screens.generated.ts`); a deep link supplies them as query
 * params (`?accountId=123`), which the target page reads via `useSearchParams`.
 *
 * The URL-building (`buildCrossAppUrl`) is pure + exported for unit testing; the
 * runtime wrappers read the cached application catalogue.
 */
import { getAppConfig } from './api-config';
import { getApplications, areApplicationsLoaded, type TenantApplication } from './applications';
import { logger } from '@/utils/logger';
import { LOCAL_DEV_CONFIG } from './local-dev';

/** One related application, as carried by the auth config response. */
export interface RelatedApplicationConfig {
  application_name: string;
  application_label?: string;
  app_definition?: string;
  app_definition_key: string;
  /** Environment-specific base URL of the app (added by backend, PHX). */
  application_url?: string;
}

/** A resolved cross-app destination + whether it is usable. */
export interface CrossAppResolution {
  /** Final URL, or null when it can't be resolved. */
  url: string | null;
  /** Why it couldn't resolve (for logging / disabled-link UX). */
  reason?: 'app-not-related' | 'no-application-url';
}

/**
 * Build a cross-app URL from an app base + screen + nav variables. Pure.
 *
 * - Joins `baseUrl` + `screen` without doubling slashes.
 * - Appends nav variables as query params, skipping null/undefined/empty.
 * - Array values are repeated (`?id=a&id=b`).
 */
export function buildCrossAppUrl(
  baseUrl: string,
  screen: string,
  navVars: Record<string, unknown> = {},
): string {
  const base = baseUrl.replace(/\/+$/, '');
  const path = screen.replace(/^\/+/, '');
  let url = path ? `${base}/${path}` : base;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(navVars)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) {
        if (v === null || v === undefined) continue;
        const s = String(v);
        if (s.length > 0) params.append(key, s);
      }
    } else {
      const s = String(value);
      if (s.length > 0) params.append(key, s);
    }
  }
  const qs = params.toString();
  if (qs) url += `?${qs}`;
  return url;
}

/** Find a related app by its `app_definition_key`. */
export function findRelatedApp(
  relatedApps: RelatedApplicationConfig[],
  appKey: string,
): RelatedApplicationConfig | undefined {
  return relatedApps.find((a) => a.app_definition_key === appKey);
}

/**
 * Derive a deployed app base URL from its `application_name` + the tenant/env,
 * matching the Phoenix host pattern `<app>-<tenant>.us.<env>.phoenix.jiffy.ai`.
 * Used as a FALLBACK only when the backend hasn't populated `application_url`
 * on the related app yet (the gating dependency). Returns null if it can't.
 */
export function deriveAppBaseUrl(
  app: RelatedApplicationConfig,
  tenant: string,
  env: string,
): string | null {
  const name = app.application_name?.trim();
  if (!name || !tenant || !env) return null;
  return `https://${name.toLowerCase()}-${tenant}.us.${env}.phoenix.jiffy.ai`;
}

/**
 * Resolve a cross-app target from a list of related apps. Pure (no globals) so
 * it can be unit-tested with fixtures.
 *
 * Prefers the backend-provided `application_url` (environment-specific). When
 * absent, falls back to a derived host from `application_name` + tenant/env so
 * the feature works before the backend ships `application_url`.
 */
export function resolveCrossAppTarget(
  relatedApps: RelatedApplicationConfig[],
  appKey: string,
  screen: string,
  navVars: Record<string, unknown> = {},
  fallback?: { tenant: string; env: string },
): CrossAppResolution {
  const app = findRelatedApp(relatedApps, appKey);
  if (!app) return { url: null, reason: 'app-not-related' };

  let base = app.application_url?.trim() || '';
  if (!base && fallback) {
    base = deriveAppBaseUrl(app, fallback.tenant, fallback.env) ?? '';
  }
  if (!base) return { url: null, reason: 'no-application-url' };
  return { url: buildCrossAppUrl(base, screen, navVars) };
}

/**
 * Adapt the `/api/applications` shape onto the resolver's shape.
 *
 * PHX-5792: the catalogue used to come from the auth config's
 * `related_applications`, which is deprecated. The fields are the same values
 * under different names — see src/config/applications.ts for the mapping table.
 */
function toRelatedApp(app: TenantApplication): RelatedApplicationConfig {
  return {
    application_name: app.name,
    application_label: app.label,
    app_definition: app.app_definition,
    app_definition_key: app.app_definition_key,
    application_url: app.application_url,
  };
}

/**
 * Runtime resolver: reads the tenant application catalogue
 * (`/api/applications`, cached at boot). Returns null (with a warning) when the
 * target can't be resolved, so the caller can render a disabled link rather
 * than navigate to a broken URL.
 */
export function resolveAppUrl(
  appKey: string,
  screen: string,
  navVars: Record<string, unknown> = {},
): string | null {
  const cfg = getAppConfig();
  const related = getApplications().map(toRelatedApp);
  const result = resolveCrossAppTarget(related, appKey, screen, navVars, {
    tenant: cfg.tenant || LOCAL_DEV_CONFIG.tenant,
    env: cfg.env || LOCAL_DEV_CONFIG.env,
  });
  if (!result.url) {
    // Surface WHY it failed + what was actually available, so a "nothing
    // happens" click is diagnosable. Logged to /logs (and bridged to the shell)
    // rather than only console.
    logger.warn('cross-app-nav:unresolved', {
      appKey,
      screen,
      reason: result.reason,
      // An empty catalogue before the boot fetch resolves looks identical to
      // "app not in this tenant" — distinguish them, or this is undebuggable.
      applicationsLoaded: areApplicationsLoaded(),
      relatedAppKeys: related.map((a) => a.app_definition_key),
      relatedWithUrl: related
        .filter((a) => a.application_url)
        .map((a) => a.app_definition_key),
    });
  }
  return result.url;
}

/** Navigate the whole browser to a cross-app destination (hard nav). */
export function navigateCrossApp(
  appKey: string,
  screen: string,
  navVars: Record<string, unknown> = {},
): boolean {
  const url = resolveAppUrl(appKey, screen, navVars);
  if (!url) {
    logger.warn('cross-app-nav:navigate-noop', { appKey, screen });
    return false;
  }
  logger.info('cross-app-nav:navigate', { appKey, screen, url });
  window.location.assign(url);
  return true;
}
