/**
 * Minimal axios-based API manager.
 *
 * Replaces the vendored `@ui-core/api_manager` package. Only the surface
 * actually used by codegen-starter is preserved:
 *   - apiManager.configure / get / post / getService
 *   - createJiffyAuthProvider({ authService, cookieUtils })
 *   - 401 → refresh → retry interceptor
 *
 * Anything not on that list (RequestBuilder, AbortController tracking,
 * setToken/setHeaders/setAuthProvider mutators, React Query hooks,
 * put/delete/patch) was dropped — there were zero call sites.
 */

import axios, {
  type AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { v4 as uuid } from 'uuid';

import type { AmplifyAuthService } from './auth-service';
import { cookieUtils } from './auth-service';

export type AuthProvider = () =>
  | Promise<Record<string, string>>
  | Record<string, string>;

interface ServiceEntry {
  baseUrl: string;
  headers: Record<string, string>;
  instance: AxiosInstance;
  authProvider?: AuthProvider;
}

interface RetryableConfig extends InternalAxiosRequestConfig {
  _retryCount?: number;
}

const MAX_REFRESH_RETRY = 1;

function isTokenRevoked(error: AxiosError): boolean {
  const data = error.response?.data;
  if (!data) return false;
  const str = typeof data === 'string' ? data : JSON.stringify(data);
  return str.toLowerCase().includes('revoked');
}

/** Extract the raw JWT from an `Authorization: Bearer <token>` header value. */
function extractBearerToken(authHeader: unknown): string | null {
  if (typeof authHeader !== 'string') return null;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return m ? m[1] : null;
}

/** Set `Authorization: Bearer <token>` on a request config. */
function applyBearerToken(config: RetryableConfig, token: string): void {
  if (config.headers) config.headers.Authorization = `Bearer ${token}`;
}

/**
 * True when the auth-failure redirect must be SKIPPED because the user is
 * already on the login screen. Redirecting there again is a HARD reload of
 * /login — if any call 401s while unauthenticated (a stale cookie access
 * token passing the RequireAuth fast path, a component firing an
 * authenticated request pre-login), that reload re-fires the call and loops
 * the login page forever, `localStorage.clear()`ing in-progress sign-in
 * state on every pass. Observed in local dev, where no shared platform
 * cookie session exists. Exported for unit tests.
 */
export function isLoginPath(pathname: string): boolean {
  return pathname === '/login' || pathname.startsWith('/login/');
}

/**
 * Clear auth-tainted localStorage (preserving "remember me" fields),
 * broadcast logout to other tabs, and bounce to /login with a reason
 * so the login screen can show the right message.
 *
 * Preserved exactly from the vendored ApiManager._handleAuthFailure —
 * the existing 403 interceptor in src/config/api-config.ts depends on
 * this behavior for refresh-failure recovery. ONE deviation: when the user
 * is ALREADY on /login there is no session to tear down and the redirect
 * would reload-loop the login screen (see {@link isLoginPath}) — stay put.
 */
function handleAuthFailure(
  authService: AmplifyAuthService,
  overrideReason?: string,
): void {
  if (isLoginPath(window.location.pathname)) return;

  const rememberMeKey = 'jiffy_remember_me';
  const savedUsernameKey = 'jiffy_saved_username';

  const rememberMe = localStorage.getItem(rememberMeKey);
  const savedUsername = localStorage.getItem(savedUsernameKey);

  localStorage.clear();

  if (rememberMe) localStorage.setItem(rememberMeKey, rememberMe);
  if (savedUsername) localStorage.setItem(savedUsernameKey, savedUsername);

  authService.broadcastLogout();

  const reason =
    overrideReason || authService.getLastRefreshError() || 'session_expired';
  window.location.href = `/login?reason=${reason}`;
}

function install401Interceptor(
  instance: AxiosInstance,
  authService: AmplifyAuthService,
): void {
  instance.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const config = error.config as RetryableConfig | undefined;
      const status = error.response?.status;

      // Surface non-401 failures (4xx other than 401, 5xx, network errors)
      // via console.error so the Jiffy preview's runtime-error interceptor
      // shows a toast in the iframe and the backend queues the error for
      // the next chat turn. 401s are handled below by the token-refresh
      // flow — don't double-log them.
      if (!config || status !== 401) {
        const data = error.response?.data;
        const detail =
          typeof data === 'string'
            ? data
            : data
              ? JSON.stringify(data).slice(0, 500)
              : error.message;
        console.error(
          `[apiManager] ${config?.method?.toUpperCase() ?? 'REQ'} ${config?.url ?? '<unknown>'} ` +
            `${status ?? 'no-status'}: ${detail}`,
        );
        return Promise.reject(error);
      }

      const revoked = isTokenRevoked(error);

      // Bounded retry: one recovery attempt per request (PHX-4320).
      config._retryCount = (config._retryCount || 0) + 1;
      if (config._retryCount > MAX_REFRESH_RETRY) {
        handleAuthFailure(authService, revoked ? 'TOKEN_REVOKED' : undefined);
        return Promise.reject(error);
      }

      const sentToken = extractBearerToken(config.headers?.Authorization);

      // Recovery A — cross-origin / cross-tab (PHX-4320). This app runs as the
      // renderer preview iframe, a separate origin from the platform that
      // shares one refresh-token cookie on `.jiffy.ai`. When the platform
      // refreshes, it writes a NEW access token to that cookie.
      // getAccessToken() reads the cookie live, so if it already holds a token
      // newer than the one we sent, just retry with it — no Cognito call, no
      // risk of hitting a stale/revoked refresh token. This is the main cure
      // for the iframe being bounced to /login while the user works in chat.
      const cookieToken = authService.getAccessToken();
      if (cookieToken && cookieToken !== sentToken) {
        applyBearerToken(config, cookieToken);
        return instance(config);
      }

      // Recovery B — refresh ourselves (deduped via refreshWithQueue).
      try {
        await authService.refreshWithQueue();
        const newToken = authService.getAccessToken();
        if (newToken) applyBearerToken(config, newToken);
        return instance(config);
      } catch (refreshErr) {
        // Recovery C — a concurrent refresh in another origin/tab may have
        // written a fresh token to the shared cookie even though OUR refresh
        // failed. Retry once with it before giving up.
        const recovered = authService.getAccessToken();
        if (recovered && recovered !== sentToken) {
          applyBearerToken(config, recovered);
          return instance(config);
        }
        console.error(
          '[apiManager] Token refresh failed:',
          authService.getLastRefreshError(),
          refreshErr,
        );
        handleAuthFailure(authService, revoked ? 'TOKEN_REVOKED' : undefined);
        return Promise.reject(error);
      }
    },
  );
}

class ApiManager {
  private services: Record<string, ServiceEntry> = {};

  configure(
    serviceKey: string,
    baseUrl: string,
    headers: Record<string, string> = {},
    authProvider?: AuthProvider,
    authService?: AmplifyAuthService,
  ): AxiosInstance {
    const instance = axios.create({ baseURL: baseUrl });
    if (Object.keys(headers).length > 0) {
      instance.defaults.headers.common = {
        ...instance.defaults.headers.common,
        ...headers,
      };
    }

    if (authService) {
      install401Interceptor(instance, authService);
    }

    this.services[serviceKey] = {
      baseUrl,
      headers: { ...headers },
      instance,
      authProvider,
    };

    return instance;
  }

  getService(serviceKey: string): ServiceEntry | undefined {
    return this.services[serviceKey];
  }

  async get(
    serviceKey: string,
    endpoint: string,
    headers: Record<string, string> = {},
    options: AxiosRequestConfig = {},
  ): Promise<AxiosResponse> {
    return this.execute(serviceKey, 'GET', endpoint, undefined, headers, options);
  }

  async post(
    serviceKey: string,
    endpoint: string,
    body: unknown = {},
    headers: Record<string, string> = {},
    options: AxiosRequestConfig = {},
  ): Promise<AxiosResponse> {
    return this.execute(serviceKey, 'POST', endpoint, body, headers, options);
  }

  async put(
    serviceKey: string,
    endpoint: string,
    body: unknown = {},
    headers: Record<string, string> = {},
    options: AxiosRequestConfig = {},
  ): Promise<AxiosResponse> {
    return this.execute(serviceKey, 'PUT', endpoint, body, headers, options);
  }

  async patch(
    serviceKey: string,
    endpoint: string,
    body: unknown = {},
    headers: Record<string, string> = {},
    options: AxiosRequestConfig = {},
  ): Promise<AxiosResponse> {
    return this.execute(serviceKey, 'PATCH', endpoint, body, headers, options);
  }

  async delete(
    serviceKey: string,
    endpoint: string,
    headers: Record<string, string> = {},
    options: AxiosRequestConfig = {},
  ): Promise<AxiosResponse> {
    return this.execute(serviceKey, 'DELETE', endpoint, undefined, headers, options);
  }

  private async execute(
    serviceKey: string,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    endpoint: string,
    body: unknown,
    requestHeaders: Record<string, string>,
    options: AxiosRequestConfig,
  ): Promise<AxiosResponse> {
    const service = this.services[serviceKey];
    if (!service) {
      throw new Error(
        `Service "${serviceKey}" not found. Call apiManager.configure() first.`,
      );
    }

    let authHeaders: Record<string, string> = {};
    if (service.authProvider) {
      try {
        authHeaders = (await service.authProvider()) || {};
      } catch (err) {
        console.warn('[apiManager] Auth provider error', err);
      }
    }

    const optionsHeaders =
      (options.headers as Record<string, string> | undefined) || {};

    const mergedHeaders: Record<string, string> = {
      ...service.headers,
      ...authHeaders,
      ...requestHeaders,
      ...optionsHeaders,
      'X-B3-TraceId': uuid(),
    };

    const { headers: _ignored, ...rest } = options;
    return service.instance.request({
      url: endpoint,
      method,
      headers: mergedHeaders,
      data: body,
      ...rest,
    });
  }
}

export const apiManager = new ApiManager();
export default apiManager;

export interface JiffyAuthProviderOptions {
  authService?: AmplifyAuthService;
  cookieUtils?: typeof cookieUtils;
}

/**
 * Build an AuthProvider that reads the current bearer token off the
 * Amplify-managed cookie storage and the tenant id off the
 * cross-subdomain `tenant_id` cookie. Returns the headers the Phoenix
 * data plane expects on every request.
 */
export function createJiffyAuthProvider(
  options: JiffyAuthProviderOptions = {},
): AuthProvider {
  const { authService, cookieUtils: cookies = cookieUtils } = options;
  return async () => {
    const headers: Record<string, string> = {};
    const accessToken = authService?.getAccessToken();
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }
    const tenantId =
      cookies?.getCookie('tenant_id') ?? localStorage.getItem('tenant_id');
    if (tenantId) {
      headers['x-jiffy-tenant'] = tenantId;
    }
    return headers;
  };
}
