import type { SsoProvider } from '@/services/auth-service';

/**
 * Decision returned by resolveAutoSsoTarget describing what /login should do
 * for a given URL search string and provider list.
 */
export type AutoSsoResolution =
  | { kind: 'callback' }
  | { kind: 'form' }
  | { kind: 'redirect'; provider: SsoProvider }
  | { kind: 'unknown'; idp: string };

/**
 * Decide what /login should do given the current URL and configured providers.
 *
 * Resolution order:
 *   1. ?code= or ?error= → callback (let getSession() complete the OAuth exchange)
 *   2. ?idp=none (case-insensitive) → form (escape hatch from default-provider auto-redirect)
 *   3. ?idp=<name> matching a configured provider → redirect to that provider
 *   4. ?idp=<name> with no match → unknown-idp error state
 *   5. configured provider with is_default=true → redirect to that provider
 *   6. otherwise → form (existing behavior)
 *
 * Provider matching is case-insensitive on `provider_name`.
 */
export function resolveAutoSsoTarget(
  search: string,
  providers: readonly SsoProvider[],
): AutoSsoResolution {
  const params = new URLSearchParams(search);
  if (params.has('code') || params.has('error')) {
    return { kind: 'callback' };
  }
  const idpParam = params.get('idp');
  if (idpParam) {
    if (idpParam.toLowerCase() === 'none') {
      return { kind: 'form' };
    }
    const target = idpParam.toLowerCase();
    const match = providers.find(
      (p) => p.provider_name?.toLowerCase() === target,
    );
    if (match) {
      return { kind: 'redirect', provider: match };
    }
    return { kind: 'unknown', idp: idpParam };
  }
  const defaultProvider = providers.find((p) => p.is_default === true);

  if (defaultProvider) {
    return { kind: 'redirect', provider: defaultProvider };
  }
  return { kind: 'form' };
}
