/**
 * Minimal AWS Amplify v6 wrapper.
 *
 * Replaces the vendored `@ui-core/auth_service` package. Only the surface
 * actually used by codegen-starter is preserved:
 *
 *   class AmplifyAuthService
 *     - fetchConfigFromAPI(apiUrl, host)
 *     - getFullConfigResponse()
 *     - login({username, password})
 *     - logout()
 *     - getSession()
 *     - getAccessToken() / getIdToken()
 *     - refreshWithQueue()
 *     - getLastRefreshError()
 *     - broadcastLogout()
 *     - handleSsoSignIn(provider) / getSsoProviders()       (SSO, PHX-4075)
 *     - hasDefaultSsoProvider() / getFederatedLogoutUrl()   (SSO, PHX-4075)
 *
 *   cookieUtils
 *     - getCookie / setCookie / removeCookie / clearAuthCookies
 *
 * SSO/OAuth (Cognito Hosted UI) was ported from `@ui-core/auth_service`
 * (PHX-4075): when the tenant's auth config carries `cognito_domain` +
 * `sso_providers`, Amplify is configured with `loginWith.oauth` and
 * `handleSsoSignIn` triggers `signInWithRedirect`. The OAuth callback lands
 * back on `/login?code=` and `getSession()` completes the code exchange.
 *
 * Dropped vs. the vendored copy: CognitoAuthService (alt provider),
 * CookieGuardian, definition-cache cookies, app-context cookies, AppSync
 * events config, validation utilities, the AuthError class hierarchy, and
 * multi-tenant token disambiguation.
 *
 * Cross-subdomain SSO is preserved: tokens + `.LastAuthUser` are stored
 * in cookies on the server-chosen `cookie_host` domain (PHX-3328; legacy
 * fallback `.jiffy.ai`) so the platform + renderer can share a session,
 * while all other Amplify keys go to localStorage to keep the cookie
 * header small. Deletes expire every domain variant a cookie may live on
 * (PHXSR-228 — see auth-cookie-domain.ts).
 */

import { Amplify, type ResourcesConfig } from 'aws-amplify';
import {
  fetchAuthSession,
  fetchUserAttributes,
  getCurrentUser,
  signIn,
  signInWithRedirect,
  signOut,
  type SignInOutput,
} from 'aws-amplify/auth';
import { cognitoUserPoolsTokenProvider } from 'aws-amplify/auth/cognito';
import type { KeyValueStorageInterface } from 'aws-amplify/utils';
import {
  normalizeCookieHost,
  resolveCookieDomain,
  resolveCookieRemovalDomains,
} from '@/services/auth-cookie-domain';

// =============================================================================
// Public types
// =============================================================================

export type RefreshFailReason =
  | 'TOKEN_EXPIRED'
  | 'TOKEN_REVOKED'
  | 'REFRESH_DENIED'
  | 'NETWORK_ERROR'
  | 'SERVER_ERROR'
  | 'INVALID_TOKEN'
  | 'THROTTLED'
  | 'TIMEOUT'
  | 'UNKNOWN';

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface AuthTokens {
  accessToken: string;
  idToken?: string;
  expiresAt: number;
}

export interface UserInfo {
  username: string;
  email?: string;
  jiffy_user_id?: string;
  attributes?: Record<string, string>;
}

export interface AuthSession {
  tokens: AuthTokens;
  user: UserInfo;
  isValid: boolean;
  expiresAt: number;
}

export interface AuthResult {
  success: boolean;
  session?: AuthSession;
  error?: Error;
  requiresPasswordChange?: boolean;
}

/**
 * SSO provider configuration from the auth config API. Each entry is an
 * external identity provider configured for the tenant (Cognito Hosted UI).
 */
export interface SsoProvider {
  /** Human-readable / custom IdP name (e.g. "Okta", "Company SSO"). */
  provider_name?: string;
  /** "Google" | "Facebook" | "Amazon" | "Apple" (built-in) or custom (e.g. "AzureAD", "SAML"). */
  provider_type?: string;
  /** Optional domain descriptor. */
  domain?: string;
  /** Optional provider-specific logout redirect URL for federated logout. */
  logout_redirect_url?: string;
  /**
   * When true, /login auto-redirects to this provider on first visit (no
   * session, no `?idp=` override). At most one provider should be default.
   */
  is_default?: boolean;
}

/** Cognito built-in social providers (lowercased) that `signInWithRedirect` accepts by name. */
export const BUILTIN_SSO_PROVIDERS = new Set([
  'google',
  'facebook',
  'amazon',
  'apple',
]);

/** Subset of the auth config API response that codegen-starter consumes. */
export interface CognitoConfigResponse {
  user_pool_id: string;
  client_id: string;
  region?: string;
  tenant_name?: string;
  env?: string;
  cognito_endpoint?: string;
  /** Cognito hosted UI domain for OAuth/SSO flows (e.g. tenant.auth.us-east-1.amazoncognito.com). */
  cognito_domain?: string;
  /**
   * Server-chosen cookie domain for the shared auth cookies (PHX-3328), e.g.
   * `us.prod.phoenix.jiffy.ai`. The platform writes token cookies on this
   * domain — we must write and delete on the same one or logout leaves the
   * platform-written variant alive (PHXSR-228).
   */
  cookie_host?: string;
  /** SSO identity providers configured for this tenant. */
  sso_providers?: SsoProvider[];
  app_name?: string;
  application?: {
    name?: string;
    app_definition?: string;
    app_definition_key?: string;
    description?: string;
  };
  // PHX-5792: `related_applications` is deliberately NOT declared here. The
  // backend still sends it, but it is deprecated — cross-app metadata comes
  // from the tenant application catalogue instead (src/config/applications.ts),
  // which is also the only source of the environment-specific
  // `application_url`. Leaving it undeclared keeps it from being picked up
  // again by accident; it remains reachable via the index signature below if
  // something genuinely needs it.
  //
  // Other fields (application_ui_component, websocket_url, …) are present on
  // the wire but unused here.
  [key: string]: unknown;
}

const NEW_PASSWORD_REQUIRED =
  'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED' as const;

// =============================================================================
// Cookie helpers — cross-subdomain SSO uses a root-domain cookie
// =============================================================================

const AUTH_TOKEN_EXPIRY_HOURS = 30 * 24; // 30 days, matches Cognito refresh token
const METADATA_COOKIE_EXPIRY_HOURS = 8;

/**
 * Server-chosen cookie host (PHX-3328 parity with the platform auth service).
 * Set from the auth-config response before Amplify is configured; mirrored to
 * sessionStorage so reloads that render before the config fetch resolves still
 * target the right domain. See auth-cookie-domain.ts for the resolution rules.
 */
const COOKIE_HOST_STORAGE_KEY = 'jiffy_cookie_host';
let configuredCookieHost: string | null = null;

function setConfiguredCookieHost(host: unknown): void {
  const bare = normalizeCookieHost(host);
  if (!bare) return;
  configuredCookieHost = bare;
  try {
    sessionStorage.setItem(COOKIE_HOST_STORAGE_KEY, bare);
  } catch {
    // sessionStorage disabled — module state alone still covers this page load
  }
}

function getConfiguredCookieHost(): string | null {
  if (configuredCookieHost) return configuredCookieHost;
  try {
    const cached = sessionStorage.getItem(COOKIE_HOST_STORAGE_KEY);
    if (cached) configuredCookieHost = cached;
  } catch {
    // ignore
  }
  return configuredCookieHost;
}

/** Domain to scope cookies to: server `cookie_host` when valid, else legacy root. */
function getCookieDomain(): string {
  return resolveCookieDomain(window.location.hostname, getConfiguredCookieHost());
}

/** All domains a cookie may live on — expire every one when deleting. */
function getCookieRemovalDomains(): string[] {
  return resolveCookieRemovalDomains(
    window.location.hostname,
    getConfiguredCookieHost(),
  );
}

function isSecureContext(): boolean {
  const hostname = window.location.hostname;
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local.jiffy.ai')
  ) {
    return false;
  }
  return window.location.protocol === 'https:';
}

function writeCookie(
  key: string,
  value: string,
  expiryHours: number,
  sameSite: 'lax' | 'strict' = 'strict',
): void {
  const domain = getCookieDomain();
  const secure = isSecureContext();

  let cookie = `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
  if (expiryHours > 0) {
    const expires = new Date(Date.now() + expiryHours * 60 * 60 * 1000);
    cookie += `; expires=${expires.toUTCString()}`;
  }
  cookie += '; path=/';
  if (domain) cookie += `; domain=${domain}`;
  if (secure) cookie += '; secure';
  cookie += `; samesite=${sameSite}`;
  document.cookie = cookie;
}

function readCookie(key: string): string | null {
  const name = encodeURIComponent(key) + '=';
  for (const raw of document.cookie.split(';')) {
    const trimmed = raw.trim();
    if (trimmed.startsWith(name)) {
      return decodeURIComponent(trimmed.substring(name.length));
    }
  }
  return null;
}

function deleteCookie(key: string): void {
  const base = `${encodeURIComponent(key)}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  // Browsers key cookies by (name, domain, path) — a delete only takes effect
  // on an exact match. Expire the host-only variant plus every domain the
  // cookie may have been written on (server cookie_host by the platform,
  // legacy .jiffy.ai by older sessions/this app), or logout leaves a live
  // token behind (PHXSR-228).
  document.cookie = base;
  for (const domain of getCookieRemovalDomains()) {
    document.cookie = `${base}; domain=${domain}`;
  }
}

export const cookieUtils = {
  setCookie: (
    key: string,
    value: string,
    expiryHours: number = METADATA_COOKIE_EXPIRY_HOURS,
  ): void => writeCookie(key, value, expiryHours),
  getCookie: (key: string): string | null => readCookie(key),
  removeCookie: (key: string): void => deleteCookie(key),
  clearAuthCookies: (): void => {
    ['cognito_username', 'tenant_id', 'jiffy_session'].forEach(deleteCookie);
    for (const raw of document.cookie.split(';')) {
      const key = raw.split('=')[0].trim();
      if (
        key.includes('CognitoIdentityServiceProvider') ||
        key.startsWith('authConfig__')
      ) {
        try {
          deleteCookie(decodeURIComponent(key));
        } catch {
          deleteCookie(key);
        }
      }
    }
    try {
      const stale: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith('authConfig__')) stale.push(k);
      }
      stale.forEach((k) => sessionStorage.removeItem(k));
    } catch {
      // ignore
    }
  },
};

// =============================================================================
// Hybrid Amplify storage: tokens to cookies (SSO), everything else to localStorage
// =============================================================================

const COOKIE_REQUIRED_PATTERNS = [
  '.accessToken',
  '.idToken',
  '.refreshToken',
  '.LastAuthUser',
];

function shouldUseCookie(key: string): boolean {
  return COOKIE_REQUIRED_PATTERNS.some((p) => key.includes(p));
}

function createHybridStorage(): KeyValueStorageInterface {
  return {
    setItem: async (key, value) => {
      if (shouldUseCookie(key)) {
        writeCookie(key, value, AUTH_TOKEN_EXPIRY_HOURS, 'lax');
        return;
      }
      try {
        localStorage.setItem(key, value);
      } catch {
        writeCookie(key, value, AUTH_TOKEN_EXPIRY_HOURS, 'lax');
      }
    },
    getItem: async (key) => {
      if (shouldUseCookie(key)) return readCookie(key);
      try {
        const v = localStorage.getItem(key);
        if (v !== null) return v;
      } catch {
        // ignore
      }
      return readCookie(key);
    },
    removeItem: async (key) => {
      if (shouldUseCookie(key)) {
        deleteCookie(key);
        return;
      }
      try {
        localStorage.removeItem(key);
      } catch {
        // ignore
      }
      deleteCookie(key);
    },
    clear: async () => {
      for (const raw of document.cookie.split(';')) {
        const key = raw.split('=')[0].trim();
        if (
          key.includes('CognitoIdentityServiceProvider') ||
          key.includes('amplify-')
        ) {
          try {
            deleteCookie(decodeURIComponent(key));
          } catch {
            deleteCookie(key);
          }
        }
      }
      try {
        const stale: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.includes('CognitoIdentityServiceProvider')) stale.push(k);
        }
        stale.forEach((k) => localStorage.removeItem(k));
      } catch {
        // ignore
      }
    },
  };
}

// =============================================================================
// Amplify configuration
// =============================================================================

/** OAuth (Cognito Hosted UI) options injected when the tenant has SSO. */
export interface AmplifyOAuthOptions {
  /** Cognito hosted UI domain. */
  domain: string;
  /** OAuth scopes (typically email/openid/profile). */
  scopes: string[];
  /** Allowed sign-in redirect (the app's /login). */
  redirectSignIn: string;
  /** Allowed sign-out redirect. */
  redirectSignOut: string;
  /** Authorization-code flow. */
  responseType: 'code';
}

interface AmplifyConfigureOptions {
  userPoolId: string;
  clientId: string;
  region?: string;
  userPoolEndpoint?: string;
  /** Present only when the tenant has SSO providers — enables the redirect flow. */
  oauth?: AmplifyOAuthOptions;
}

let amplifyConfigured = false;
let currentClientId: string | null = null;

/**
 * Remove Cognito token cookies that belong to OTHER tenants' app clients.
 *
 * Amplify stores a full token set (access/id/refresh JWTs + LastAuthUser)
 * under per-clientId cookie keys (`CognitoIdentityServiceProvider.<clientId>.*`)
 * on the shared `.jiffy.ai` domain. Logging into multiple tenants accumulates
 * several full JWT sets, all sent on every request — eventually overflowing
 * proxy/ALB request-header limits (~8KB) and causing intermittent 400/431
 * "request header too large" failures. A tab works in one tenant at a time, so
 * we keep only the active tenant's token cookies and evict the rest whenever
 * Amplify is (re)configured for a tenant. (PHX-4320)
 */
function purgeForeignTenantTokenCookies(activeClientId: string): void {
  if (typeof document === 'undefined' || !activeClientId) return;

  const removalDomains = getCookieRemovalDomains();
  const expire = (rawKey: string): void => {
    const base = `${rawKey}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    // Delete the host-only variant plus every domain variant so the browser
    // drops it regardless of how it was originally written.
    document.cookie = base;
    for (const domain of removalDomains) {
      document.cookie = `${base}; domain=${domain}`;
    }
  };

  let purged = 0;
  for (const raw of document.cookie.split(';')) {
    const rawKey = raw.split('=')[0].trim();
    if (!rawKey) continue;

    let key: string;
    try {
      key = decodeURIComponent(rawKey);
    } catch {
      key = rawKey;
    }

    if (!key.startsWith('CognitoIdentityServiceProvider.')) continue;
    // Key shape: CognitoIdentityServiceProvider.<clientId>.<rest>
    const clientIdSegment = key.split('.')[1];
    if (!clientIdSegment || clientIdSegment === activeClientId) continue;

    expire(rawKey);
    purged++;
  }

  if (purged > 0) {
    console.log('[auth] Purged stale tenant token cookies (PHX-4320)', {
      keptClientId: activeClientId,
      removed: purged,
    });
  }
}

function configureAmplify(opts: AmplifyConfigureOptions): void {
  if (amplifyConfigured && currentClientId === opts.clientId) return;

  // Keep the shared `.jiffy.ai` cookie jar at one tenant's footprint so the
  // Cookie header never overflows proxy limits when a user visits multiple
  // tenants (PHX-4320).
  purgeForeignTenantTokenCookies(opts.clientId);

  const cognitoConfig: ResourcesConfig['Auth'] = {
    Cognito: {
      userPoolId: opts.userPoolId,
      userPoolClientId: opts.clientId,
      ...(opts.userPoolEndpoint
        ? { userPoolEndpoint: opts.userPoolEndpoint }
        : {}),
    },
  };

  // Wire up the Hosted UI / SSO redirect flow when the tenant has OAuth.
  if (opts.oauth && cognitoConfig.Cognito) {
    (cognitoConfig.Cognito as unknown as Record<string, unknown>).loginWith = {
      oauth: {
        domain: opts.oauth.domain,
        redirectSignIn: [opts.oauth.redirectSignIn],
        redirectSignOut: [opts.oauth.redirectSignOut],
        responseType: opts.oauth.responseType,
        scopes: opts.oauth.scopes,
      },
    };
  }

  Amplify.configure({ Auth: cognitoConfig });
  cognitoUserPoolsTokenProvider.setKeyValueStorage(createHybridStorage());

  amplifyConfigured = true;
  currentClientId = opts.clientId;
}

/**
 * Cognito-local emulator runs inside Docker. Rewrite the Docker-internal
 * hostname to localhost so the browser can reach it during `npm run dev`.
 * No-op in production builds.
 */
function resolveCognitoEndpoint(raw: string | undefined): string | undefined {
  if (!import.meta.env.DEV || !raw) return undefined;
  return raw.replace('host.docker.internal', 'localhost');
}

// =============================================================================
// AmplifyAuthService
// =============================================================================

const REFRESH_THRESHOLD_MS = 5 * 60 * 1000;
const CLOCK_SKEW_MS = 2 * 60 * 1000;
const REFRESH_TIMEOUT_MS = 15 * 1000;

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    return JSON.parse(
      atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')),
    ) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function decodeJwtExpiry(token: string): number | null {
  const payload = decodeJwtPayload(token);
  if (!payload) return null;
  return typeof payload.exp === 'number' ? (payload.exp as number) : null;
}

export class AmplifyAuthService {
  private clientId: string | null = null;
  private configPromise: Promise<void> | null = null;
  private refreshPromise: Promise<AuthSession> | null = null;
  private lastRefreshError: RefreshFailReason | null = null;
  private fullConfigResponse: CognitoConfigResponse | null = null;
  /** Federated logout URL captured when an SSO sign-in is initiated. */
  private federatedLogoutUrl: string | null = null;

  /**
   * Fetch the per-tenant auth config from the public API, then configure
   * Amplify. Deduped: concurrent calls share the same in-flight promise,
   * and the resolved config is cached in sessionStorage so a page reload
   * doesn't re-hit the API.
   */
  async fetchConfigFromAPI(apiUrl: string, host: string): Promise<void> {
    if (this.configPromise) return this.configPromise;
    this.configPromise = this.doFetchConfig(apiUrl, host);
    try {
      await this.configPromise;
    } finally {
      this.configPromise = null;
    }
  }

  private async doFetchConfig(apiUrl: string, host: string): Promise<void> {
    const cacheKey = `authConfig__${host}`;

    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached) as {
          fullConfigResponse?: CognitoConfigResponse;
        };
        const data = parsed.fullConfigResponse;
        if (data?.user_pool_id && data.client_id) {
          this.fullConfigResponse = data;
          // Must land before applyConfig/Amplify so every cookie write/delete
          // targets the server-chosen domain (PHX-3328 / PHXSR-228).
          setConfiguredCookieHost(data.cookie_host);
          if (data.tenant_name) {
            cookieUtils.setCookie('tenant_id', data.tenant_name);
          }
          this.applyConfig(data);
          return;
        }
        sessionStorage.removeItem(cacheKey);
      }
    } catch {
      try {
        sessionStorage.removeItem(cacheKey);
      } catch {
        // ignore
      }
    }

    const response = await fetch(`${apiUrl}/public/auth/config?host=${host}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch auth config: ${response.statusText}`);
    }
    const data = (await response.json()) as CognitoConfigResponse;
    if (!data.user_pool_id || !data.client_id) {
      throw new Error('Invalid auth config response: missing pool/client id');
    }

    // Must land before applyConfig/Amplify so every cookie write/delete
    // targets the server-chosen domain (PHX-3328 / PHXSR-228).
    setConfiguredCookieHost(data.cookie_host);

    if (data.tenant_name) {
      cookieUtils.setCookie('tenant_id', data.tenant_name);
    }

    try {
      sessionStorage.setItem(
        cacheKey,
        JSON.stringify({ fullConfigResponse: data, _cachedAt: Date.now() }),
      );
    } catch {
      // sessionStorage full or disabled — proceed without caching
    }

    this.fullConfigResponse = data;
    this.applyConfig(data);
  }

  private applyConfig(data: CognitoConfigResponse): void {
    this.clientId = data.client_id;
    // Derive OAuth options only when the tenant actually has SSO configured
    // (a hosted-UI domain AND at least one provider). Otherwise Amplify stays
    // password-only and nothing about the existing flow changes.
    const hasOAuth = Boolean(data.cognito_domain && data.sso_providers?.length);
    const oauth: AmplifyOAuthOptions | undefined = hasOAuth
      ? {
          domain: data.cognito_domain as string,
          scopes: ['email', 'openid', 'profile'],
          redirectSignIn: `${window.location.origin}/login`,
          redirectSignOut: `${window.location.origin}/login`,
          responseType: 'code',
        }
      : undefined;

    configureAmplify({
      userPoolId: data.user_pool_id,
      clientId: data.client_id,
      region: data.region,
      userPoolEndpoint: resolveCognitoEndpoint(data.cognito_endpoint),
      ...(oauth ? { oauth } : {}),
    });
  }

  getFullConfigResponse(): CognitoConfigResponse | null {
    return this.fullConfigResponse;
  }

  async login(credentials: LoginCredentials): Promise<AuthResult> {
    if (!amplifyConfigured) {
      return {
        success: false,
        error: new Error(
          "Just a moment — we're getting things ready. Please try signing in again shortly.",
        ),
      };
    }
    try {
      const output: SignInOutput = await signIn({
        username: credentials.username,
        password: credentials.password,
        // cognito-local emulator only supports USER_PASSWORD_AUTH
        options: this.fullConfigResponse?.cognito_endpoint
          ? { authFlowType: 'USER_PASSWORD_AUTH' }
          : undefined,
      });

      if (output.isSignedIn) {
        const session = await this.getSession();
        if (session) {
          cookieUtils.setCookie('cognito_username', credentials.username);
          return { success: true, session };
        }
      }

      if (output.nextStep?.signInStep === NEW_PASSWORD_REQUIRED) {
        cookieUtils.setCookie('cognito_username', credentials.username);
        return { success: false, requiresPasswordChange: true };
      }

      return { success: false, error: new Error('Login failed') };
    } catch (error) {
      return {
        success: false,
        error: new Error(
          error instanceof Error ? error.message : 'Login failed',
        ),
      };
    }
  }

  /**
   * Log out the current user.
   *
   * Defaults to a LOCAL sign-out (this session only). A global sign-out is
   * avoided by default because Cognito GlobalSignOut revokes EVERY refresh
   * token for the user across all tabs/subdomains/devices — including this
   * app when it runs as the renderer preview iframe sharing the
   * `.jiffy.ai` refresh-token cookie. A single logout therefore used to
   * revoke the iframe's session mid-work, surfacing as "Refresh Token has
   * been revoked" and a forced redirect to /login (PHX-4320). Pass
   * `{ everywhere: true }` only for an explicit "sign out of all devices".
   */
  async logout(options?: { everywhere?: boolean }): Promise<void> {
    const global = options?.everywhere === true;
    try {
      await signOut({ global });
    } catch (err) {
      console.warn('[auth] sign out error', err);
    }
    cookieUtils.clearAuthCookies();
    this.broadcastLogout();
  }

  // ───────────────────────────── SSO / OAuth ─────────────────────────────────

  /** SSO providers configured for this tenant (empty when none). */
  getSsoProviders(): SsoProvider[] {
    return this.fullConfigResponse?.sso_providers ?? [];
  }

  /**
   * Whether a default SSO provider is configured. Callers use this to decide
   * whether logout MUST be federated (a local-only signOut would loop back
   * into auto-SSO on the next /login visit).
   */
  hasDefaultSsoProvider(): boolean {
    return this.getSsoProviders().some((p) => p.is_default === true);
  }

  /**
   * Initiate an SSO sign-in: redirect to the IdP via Cognito Hosted UI.
   * Built-in social providers are passed by capitalized name; custom SAML/OIDC
   * providers go through `{ custom: <name> }`. The IdP redirects back to
   * `/login?code=`, where `getSession()` completes the code exchange.
   */
  async handleSsoSignIn(provider: SsoProvider): Promise<void> {
    if (!amplifyConfigured) {
      throw new Error('Auth not configured. Cannot initiate SSO sign-in.');
    }

    this.federatedLogoutUrl = provider.logout_redirect_url ?? null;

    const providerType = (provider.provider_type ?? '').toLowerCase();
    if (BUILTIN_SSO_PROVIDERS.has(providerType)) {
      const capitalized =
        providerType.charAt(0).toUpperCase() + providerType.slice(1);
      await signInWithRedirect({
        provider: capitalized as 'Google' | 'Facebook' | 'Amazon' | 'Apple',
      });
    } else {
      const customName = provider.provider_name ?? provider.provider_type ?? '';
      await signInWithRedirect({ provider: { custom: customName } });
    }
  }

  /**
   * URL to use for federated logout, or null for local-only logout. Resolution:
   *   1. In-memory URL captured by `handleSsoSignIn`.
   *   2. ID-token `identities[]` matched against configured providers.
   *   3. The default provider's `logout_redirect_url` (last resort).
   * Never reads sessionStorage so the decision cannot be forged by XSS.
   */
  async getFederatedLogoutUrl(): Promise<string | null> {
    if (this.federatedLogoutUrl) return this.federatedLogoutUrl;
    const fromIdToken = await this.resolveLogoutUrlFromIdToken();
    if (fromIdToken) return fromIdToken;
    return this.getDefaultProviderLogoutUrl();
  }

  private async resolveLogoutUrlFromIdToken(): Promise<string | null> {
    try {
      const session = await fetchAuthSession({ forceRefresh: false });
      const payload = session.tokens?.idToken?.payload as
        | { identities?: Array<{ providerName?: string; providerType?: string }> }
        | undefined;
      const first = payload?.identities?.[0];
      if (!first?.providerType && !first?.providerName) return null;
      const providers = this.getSsoProviders();
      const tokenType = (first.providerType ?? '').toLowerCase();
      const tokenName = (first.providerName ?? '').toLowerCase();
      for (const p of providers) {
        if (!p.logout_redirect_url) continue;
        const pt = (p.provider_type ?? '').toLowerCase();
        const pn = (p.provider_name ?? '').toLowerCase();
        if (pt === tokenType || pt === tokenName || pn === tokenType || pn === tokenName) {
          return p.logout_redirect_url;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  private getDefaultProviderLogoutUrl(): string | null {
    const def = this.getSsoProviders().find((p) => p.is_default === true);
    return def?.logout_redirect_url ?? null;
  }

  async getSession(): Promise<AuthSession | null> {
    try {
      const session = await fetchAuthSession({ forceRefresh: false });
      if (!session.tokens) return null;

      const accessToken = session.tokens.accessToken.toString();
      const idToken = session.tokens.idToken?.toString();
      const expiresAt = session.tokens.accessToken.payload.exp
        ? (session.tokens.accessToken.payload.exp as number) * 1000
        : Date.now() + 3600_000;

      let user: UserInfo = { username: '' };
      const idPayload = session.tokens.idToken?.payload;
      if (idPayload) {
        const jiffyUserId = idPayload.jiffy_user_id as string | undefined;
        user = {
          username:
            (idPayload['cognito:username'] as string) ||
            (idPayload.sub as string) ||
            '',
          email: idPayload.email as string | undefined,
          jiffy_user_id: jiffyUserId,
          attributes: {
            ...(idPayload.email
              ? { email: idPayload.email as string }
              : {}),
            ...(idPayload.name
              ? { name: idPayload.name as string }
              : {}),
            ...(idPayload.sub ? { sub: idPayload.sub as string } : {}),
            ...(jiffyUserId ? { jiffy_user_id: jiffyUserId } : {}),
          },
        };
      } else {
        try {
          const u = await getCurrentUser();
          const attrs = await fetchUserAttributes();
          user = {
            username: u.username,
            email: attrs.email,
            attributes: attrs as Record<string, string>,
          };
        } catch {
          user = { username: cookieUtils.getCookie('cognito_username') || '' };
        }
      }

      return {
        tokens: { accessToken, idToken, expiresAt },
        user,
        isValid: true,
        expiresAt,
      };
    } catch (err) {
      console.error('[auth] get session failed', err);
      return null;
    }
  }

  private getTokenCookie(suffix: '.accessToken' | '.idToken'): string | null {
    for (const raw of document.cookie.split(';')) {
      const trimmed = raw.trim();
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.substring(0, eq);
      const value = trimmed.substring(eq + 1);
      if (!key.includes(suffix)) continue;
      if (this.clientId && !key.includes(this.clientId)) continue;
      return decodeURIComponent(value || '');
    }
    return null;
  }

  getAccessToken(): string | null {
    return this.getTokenCookie('.accessToken');
  }

  getIdToken(): string | null {
    return this.getTokenCookie('.idToken');
  }

  /**
   * Read the `jiffy_user_id` claim from the current ID token (falling
   * back to the access token). Returns null when no token is present
   * or the claim is missing. Used by the permissions API call.
   */
  getJiffyUserId(): string | null {
    const tokens = [this.getIdToken(), this.getAccessToken()];
    for (const token of tokens) {
      if (!token) continue;
      const payload = decodeJwtPayload(token);
      const claim = payload?.jiffy_user_id;
      if (typeof claim === 'string' && claim) return claim;
    }
    return null;
  }

  /** True when the access token is within ~7 min of expiry (refresh + clock-skew buffers). */
  isTokenExpiringSoon(): boolean {
    const token = this.getAccessToken();
    if (!token) return true;
    const exp = decodeJwtExpiry(token);
    if (exp === null) return true;
    return Date.now() >= exp * 1000 - (REFRESH_THRESHOLD_MS + CLOCK_SKEW_MS);
  }

  async refresh(): Promise<AuthSession> {
    const session = await fetchAuthSession({ forceRefresh: true });
    if (!session.tokens) throw new Error('No tokens after refresh');
    const auth = await this.getSession();
    if (!auth) throw new Error('Failed to get session after refresh');
    return auth;
  }

  /**
   * Refresh tokens with request deduplication. Concurrent callers (e.g. a
   * dozen entity queries that all 401 around the same expiry) share a
   * single in-flight refresh promise. A 15s hard timeout prevents the
   * promise from hanging forever.
   */
  async refreshWithQueue(): Promise<AuthSession> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.doRefresh();
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async doRefresh(): Promise<AuthSession> {
    try {
      const session = await Promise.race<AuthSession>([
        this.refresh(),
        new Promise<AuthSession>((_, reject) =>
          setTimeout(
            () => reject(new Error('Token refresh timed out')),
            REFRESH_TIMEOUT_MS,
          ),
        ),
      ]);
      this.lastRefreshError = null;
      this.broadcastTokenUpdate();
      return session;
    } catch (err) {
      this.lastRefreshError = categorizeRefreshError(err);
      throw err;
    }
  }

  getLastRefreshError(): RefreshFailReason | null {
    return this.lastRefreshError;
  }

  /** Notify other tabs that this tab has logged out (storage-event broadcast). */
  broadcastLogout(): void {
    localStorage.setItem(
      'auth_sync',
      JSON.stringify({
        type: 'logout',
        timestamp: Date.now(),
        nonce: crypto.randomUUID(),
      }),
    );
  }

  private broadcastTokenUpdate(): void {
    localStorage.setItem(
      'auth_sync',
      JSON.stringify({
        type: 'tokens_updated',
        timestamp: Date.now(),
        nonce: crypto.randomUUID(),
      }),
    );
    localStorage.removeItem('auth_sync');
  }
}

function categorizeRefreshError(error: unknown): RefreshFailReason {
  if (!(error instanceof Error)) return 'UNKNOWN';
  const msg = error.message.toLowerCase();
  if (msg.includes('revoked')) return 'TOKEN_REVOKED';
  if (msg.includes('expired') || msg.includes('invalid_grant')) {
    return 'TOKEN_EXPIRED';
  }
  if (msg.includes('not authorized') || msg.includes('access denied')) {
    return 'REFRESH_DENIED';
  }
  if (msg.includes('network') || msg.includes('fetch')) return 'NETWORK_ERROR';
  if (msg.includes('throttl') || msg.includes('rate limit')) return 'THROTTLED';
  if (msg.includes('timed out') || msg.includes('timeout')) return 'TIMEOUT';
  if (msg.includes('invalid') || msg.includes('malformed')) {
    return 'INVALID_TOKEN';
  }
  if (msg.includes('5') && msg.includes('00')) return 'SERVER_ERROR';
  return 'UNKNOWN';
}
