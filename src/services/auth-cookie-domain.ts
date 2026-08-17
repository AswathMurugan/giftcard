/**
 * Pure cookie-domain resolution for the auth service.
 *
 * PHX-3328 parity with the platform (`ui` repo,
 * libs/core/auth_service/src/lib/amplify-config.ts): the platform scopes the
 * shared Cognito token cookies to the server-provided `cookie_host` from
 * `/public/auth/config` (e.g. `us.prod.phoenix.jiffy.ai`) instead of the
 * legacy root `.jiffy.ai`. This app must write AND delete on the same
 * domain(s) — browsers key cookies by (name, domain, path), so expiring only
 * the `.jiffy.ai` variant leaves the platform-written variant alive and the
 * user gets silently re-admitted after logout (PHXSR-228).
 *
 * Deliberately browser-free (no window/document) so node vitest can cover it —
 * same pattern as chat-channel.ts.
 */

/** Normalize a server-provided cookie host: trim, lowercase, strip leading dot. */
export function normalizeCookieHost(host: unknown): string | null {
  if (typeof host !== 'string') return null;
  const bare = host.trim().toLowerCase().replace(/^\./, '');
  return bare || null;
}

/**
 * Whether a cookie `domain` attribute is settable on `hostname`.
 *
 * Browsers reject a cookie whose `domain` is not the current host or a parent
 * of it. If the server-provided `cookie_host` doesn't match the host we're
 * running on, using it would silently drop every auth cookie (tokens never
 * persist -> login appears to fail), so callers must fall back to the
 * hostname-derived domain instead.
 */
export function isCookieDomainSettable(
  hostname: string,
  domain: string,
): boolean {
  const bare = domain.replace(/^\./, '');
  if (!bare) return false;
  return hostname === bare || hostname.endsWith('.' + bare);
}

/**
 * Legacy hostname-derived common domain (pre-PHX-3328 behavior):
 * `*.local.jiffy.ai` -> `.local.jiffy.ai`; localhost variants -> '' (host-only);
 * `*.jiffy.ai` -> `.jiffy.ai`; anything else -> '' (no cross-subdomain).
 */
export function deriveCookieDomainFromHostname(hostname: string): string {
  if (hostname.endsWith('.local.jiffy.ai')) return '.local.jiffy.ai';
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.endsWith('.localhost')
  ) {
    return '';
  }
  if (hostname.endsWith('.jiffy.ai')) return '.jiffy.ai';
  return '';
}

/**
 * Domain used to WRITE auth cookies: the server-provided `cookie_host` when it
 * is valid for this hostname (PHX-3328), else the legacy derived domain (also
 * covers older backends that don't send `cookie_host`, and local dev).
 */
export function resolveCookieDomain(
  hostname: string,
  cookieHost: string | null,
): string {
  if (cookieHost && isCookieDomainSettable(hostname, cookieHost)) {
    return cookieHost;
  }
  return deriveCookieDomainFromHostname(hostname);
}

/**
 * Domains to target when DELETING a cookie: the active write domain PLUS the
 * legacy derived domain, deduped. A cookie may exist on either (the platform
 * writes on `cookie_host`; older sessions / this app's past versions wrote on
 * `.jiffy.ai`), and a delete only takes effect on an exact (domain, path)
 * match. Callers must ALSO expire the host-only variant (no domain attribute)
 * separately.
 */
export function resolveCookieRemovalDomains(
  hostname: string,
  cookieHost: string | null,
): string[] {
  const domains = new Set<string>();
  const active = resolveCookieDomain(hostname, cookieHost);
  if (active) domains.add(active);
  const legacy = deriveCookieDomainFromHostname(hostname);
  if (legacy) domains.add(legacy);
  return Array.from(domains);
}
