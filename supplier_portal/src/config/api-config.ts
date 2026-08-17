/**
 * API Configuration for Codegen Starter
 *
 * Gets app context from the auth config response (same as renderer).
 * The auth config API returns application details including app_definition.
 */
import { apiManager, createJiffyAuthProvider } from '@/services/api-manager';
import type { AuthProvider } from '@/services/api-manager';
import type { AxiosError, AxiosRequestConfig } from 'axios';
import { cookieUtils } from '@/services/auth-service';
import { getAuthService } from './auth-service-manager';
import { getApplications } from './applications';
import { LOCAL_DEV_CONFIG } from './local-dev';

function isLocalDevelopment(): boolean {
  const hostname = window.location.hostname;
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.localhost');
}

function createAuthProvider(): AuthProvider {
  return createJiffyAuthProvider({
    authService: getAuthService(),
    cookieUtils,
  });
}

/**
 * Resolve the deployment environment sent as `X-Jiffy-Env`.
 *
 * The server assigns this: app-manager parses it out of the browser hostname
 * and returns it as `env` from `/public/auth/config?host=…`. It is `omitempty`
 * on the wire, so a host app-manager cannot classify yields NO `env` field at
 * all rather than an empty string.
 *
 * PHX-5724: this used to fall back to a hardcoded `'develop'`, so a published
 * app whose host didn't resolve silently read DEVELOPMENT data from a higher
 * environment — the request asserted `develop` and the server believed it
 * (app-manager trusts the header verbatim). Fall back to the configured
 * `LOCAL_DEV_CONFIG.env` instead, matching every other field in
 * `getAppContextFromAuth` and keeping local dev consistent with
 * `LOCAL_DEV_DERIVED.host`, which is built from the same value.
 *
 * NEVER reintroduce a literal environment name here — a wrong-but-plausible
 * env is worse than a missing one, because it fails silently with real data.
 *
 * Exported for unit tests.
 */
export function resolveAppEnv(configEnv: string | undefined | null): string {
  return configEnv || LOCAL_DEV_CONFIG.env;
}

/**
 * Get app context from the auth config response.
 * This is populated after ensureAuthConfigured() completes.
 */
function getAppContextFromAuth() {
  const authService = getAuthService();
  const configResponse = authService.getFullConfigResponse();
  const app = configResponse?.application;

  return {
    appName: app?.name || LOCAL_DEV_CONFIG.appName,
    appDefinition: app?.app_definition || `${LOCAL_DEV_CONFIG.appName}__V${LOCAL_DEV_CONFIG.version.replace(/\./g, '_')}`,
    appDefinitionKey: app?.app_definition_key || LOCAL_DEV_CONFIG.appName,
    tenant: configResponse?.tenant_name || LOCAL_DEV_CONFIG.tenant,
    // Sent as `X-Jiffy-Env` on every data-plane service below, and used to
    // scope agent-chat sessions. See resolveAppEnv for why there is no
    // hardcoded fallback. (`env` is declared on CognitoConfigResponse in
    // services/auth-service.ts — the previous `as Record<string, unknown>`
    // cast was hiding the typed field.)
    env: resolveAppEnv(configResponse?.env),
    // PHX-5792: `related_applications` from the auth config is deprecated and
    // is NOT read here any more. Cross-app metadata (including the
    // environment-specific `application_url`) comes from the tenant
    // application catalogue — see src/config/applications.ts.
  };
}

/** Exposed for hooks */
export function getAppConfig() {
  return getAppContextFromAuth();
}

/**
 * Returns headers for data service calls.
 *
 * For same-app entities (wealth domain): sends X-Jiffy-App-Name + X-Jiffy-App-Definition
 * For cross-app entities (platform): sends X-Jiffy-App-Name resolved from related_applications
 *
 * NOTE: Never send X-Jiffy-App-Definition-Key — the backend does not expect it.
 */
export function getDataHeaders(appDefinitionKey?: string): Record<string, string> {
  const config = getAppContextFromAuth();
  const headers: Record<string, string> = {};

  // Determine if same-app: match by app_definition_key or by app name prefix
  const isSameApp =
    !appDefinitionKey ||
    appDefinitionKey === config.appDefinitionKey ||
    appDefinitionKey.startsWith(config.appName);

  if (isSameApp) {
    // Same-app call: send only X-Jiffy-App-Name (matching renderer behavior)
    headers['X-Jiffy-App-Name'] = config.appName;
    if (config.appDefinition) {
      headers['X-Jiffy-App-Definition'] = config.appDefinition;
    }
  } else {
    // Cross-app call: resolve the app name from the tenant application
    // catalogue (PHX-5792 — was `related_applications` from the auth config).
    const relatedApp = getApplications().find(
      (ra) =>
        ra.app_definition_key === appDefinitionKey ||
        ra.name === appDefinitionKey ||
        appDefinitionKey.startsWith(ra.name),
    );
    if (relatedApp) {
      headers['X-Jiffy-App-Name'] = relatedApp.name;
    } else {
      // Fallback: extract app name from key (e.g., 'wealthdomain_69c...' → 'wealthdomain')
      // or use as-is for simple keys like 'platform'
      const appName = appDefinitionKey.includes('_') && appDefinitionKey.length > 30
        ? appDefinitionKey.split('_')[0]
        : appDefinitionKey;
      headers['X-Jiffy-App-Name'] = appName;
    }
  }

  console.debug('[getDataHeaders]', { appDefinitionKey, resolved: headers, config: { appName: config.appName, appDefinitionKey: config.appDefinitionKey } });
  return headers;
}

/**
 * Same as `getDataHeaders` but also stamps the current user's id as
 * `X-Jiffy-User-Id`.
 *
 * Workflow execution and partner-module / partner-category proxy calls
 * require the requesting user's id on every request so the server can
 * authorize against per-user permission grants. Saved-query and entity
 * reads infer the user from the bearer token; the workflow + partner
 * routes need the explicit header.
 *
 * Reads `jiffy_user_id` from the current ID token (falling back to
 * the access token) via `AmplifyAuthService.getJiffyUserId()`. When
 * no user id is available (e.g. unauthenticated state, tests, or a
 * token missing the claim), the header is omitted rather than sent
 * empty — an empty header would 400 on the server.
 */
export function getDataHeadersWithUser(appDefinitionKey?: string): Record<string, string> {
  const headers = getDataHeaders(appDefinitionKey);
  const jiffyUserId = getAuthService().getJiffyUserId();
  if (jiffyUserId) {
    headers['X-Jiffy-User-Id'] = jiffyUserId;
  }
  return headers;
}

export async function initializeAuth(): Promise<void> {
  try {
    const { ensureAuthConfigured } = await import('./auth-service-manager');
    await ensureAuthConfigured();
  } catch {
    // Auth init failure handled silently for POC
  }
}

/**
 * Initialize all API services.
 * Call AFTER auth is configured so getAppContextFromAuth() has data.
 */
export function initializeApi(): void {
  const origin = isLocalDevelopment() ? '' : window.location.origin;
  const authProvider = createAuthProvider();
  const authService = getAuthService();
  const config = getAppContextFromAuth();

  apiManager.configure('data', `${origin}/data`, {
    Accept: 'application/json',
    'X-Jiffy-Env': config.env,
    'X-Jiffy-Tenant': config.tenant,
  }, authProvider, authService);

  apiManager.configure('workflow', `${origin}/workflow`, {
    Accept: 'application/json',
    'X-Jiffy-Env': config.env,
    'X-Jiffy-Tenant': config.tenant,
  }, authProvider, authService);

  apiManager.configure('proxy', origin, {
    Accept: 'application/json',
    'X-Jiffy-Env': config.env,
    'X-Jiffy-Tenant': config.tenant,
  }, authProvider, authService);

  apiManager.configure('drive', `${origin}/drive`, {
    'X-Jiffy-Env': config.env,
    'X-Jiffy-Tenant': config.tenant,
  }, authProvider, authService);

  // Platform API plane (`/api`). Backs profile chrome that talks to
  // platform services rather than the app's own data plane:
  //   - `neo-api`  → preferences (Connected Apps account labels), users/me.
  //                  Always carries X-Jiffy-App-Name (matches renderer).
  //   - `tenant`   → partner-module configs + OAuth callback proxy
  //                  (Connected Apps). Tenant-scoped, no default app name.
  // See src/services/partner-modules-api.ts (UI in src/components/shared/connected-apps).
  apiManager.configure('neo-api', `${origin}/api`, {
    Accept: 'application/json',
    'X-Jiffy-App-Name': config.appName,
  }, authProvider, authService);

  apiManager.configure('tenant', `${origin}/api`, {
    Accept: 'application/json',
    'X-Jiffy-Env': config.env,
    'X-Jiffy-Tenant': config.tenant,
  }, authProvider, authService);

  // Events service (`/events`) — alert preferences catalogue + opt-out,
  // backing the Notification Preferences profile dialog.
  // See src/components/shared/notification-preferences.
  apiManager.configure('events', `${origin}/events`, {
    Accept: 'application/json',
    'X-Jiffy-Env': config.env,
    'X-Jiffy-Tenant': config.tenant,
  }, authProvider, authService);

  // Document-processing / e-signature service. Backs the signing envelope
  // endpoints used by useSignatures (GET/POST /api/v1/signing/...). Tenant +
  // env headers only; the auth provider injects Authorization + tenant, and
  // the Drive bytes for a signed copy / document view go through the `drive`
  // service above. See src/queries/SIGNATURE.md.
  apiManager.configure('docproc', `${origin}/docproc`, {
    Accept: 'application/json',
    'X-Jiffy-Env': config.env,
    'X-Jiffy-Tenant': config.tenant,
    // REQUIRED by the docproc gateway — without it the signing endpoints 502
    // (it routes on the requesting app's name, not the envelope's owner app).
    'X-Jiffy-App-Name': config.appName,
  }, authProvider, authService);

  // Document GENERATION service (`/doc`). Backs POST /doc/pdf/from-html/,
  // which renders an HTML string to a PDF, stores it in Jiffy Drive and
  // returns `{ file_id, storage_key, output_filename }` directly — no result
  // envelope. Distinct from `docproc` above, which is the e-signature plane.
  // The endpoint also requires the caller's user id; that is per-request, so
  // it is added at the call site via `getDataHeadersWithUser`.
  apiManager.configure('doc', `${origin}/doc`, {
    Accept: 'application/json',
    'X-Jiffy-Env': config.env,
    'X-Jiffy-Tenant': config.tenant,
  }, authProvider, authService);

  // Agent framework service (`/agentframework/api/v1`) — the chat SESSION index
  // + history behind the agent chat's history dropdown (list/load/rename/delete).
  // The live send+stream path does NOT use this: it runs over the AppSync Events
  // WebSocket (see src/services/chat-service.ts). Same-origin like every other
  // service here. Per-call app/user scope headers (x-jiffy-app-name /
  // -app-definition-key / -user-id) are added by src/services/session-api.ts; the auth
  // provider injects Authorization + tenant. See src/queries/AGENT-CHAT.md.
  apiManager.configure('agentframework', `${origin}/agentframework/api/v1`, {
    Accept: 'application/json',
    'X-Jiffy-Env': config.env,
    'X-Jiffy-Tenant': config.tenant,
  }, authProvider, authService);

  // Install our 403-refresh interceptor on top of api-manager's built-in 401
  // interceptor. The Phoenix data API returns 403 for expired access tokens
  // (not 401, which the api-manager would handle), so without this every
  // entity hook breaks after the access token's TTL and the user gets stuck
  // on a permanent 403 until they re-login. See install403RefreshInterceptor.
  for (const serviceKey of ['data', 'workflow', 'proxy', 'drive', 'doc', 'docproc', 'neo-api', 'tenant', 'events', 'agentframework']) {
    install403RefreshInterceptor(serviceKey, authService);
  }
}

/**
 * Marker we stash on a request config so a single request can only retry once
 * after a 403/refresh. Without it a permanently-unauthorized request would
 * loop forever (refresh succeeds, retry hits the same 403, refresh succeeds, …).
 */
interface RetryableConfig extends AxiosRequestConfig {
  _jiffy403Retried?: boolean;
}

/**
 * The Phoenix data plane returns **403 Forbidden** when the bearer token is
 * structurally valid but expired — not 401 Unauthorized. The local
 * apiManager response interceptor (src/services/api-manager.ts) only triggers
 * a refresh on 401, so a 403 falls straight through and the entity hook
 * surfaces it to the UI as a hard error.
 *
 * We install a second interceptor here that:
 *   1. Catches 403 once per request (idempotent via `_jiffy403Retried`).
 *   2. Calls `authService.refreshWithQueue()` — the same dedupe-queued refresh
 *      the api-manager uses internally, so concurrent failed requests share
 *      one refresh round trip.
 *   3. Re-issues the original request through the SAME axios instance (so
 *      the api-manager's standard request interceptor re-applies the freshly
 *      refreshed Authorization header).
 *
 * If the refresh itself fails OR the retried request again returns 403, we
 * bail with the original error and let the UI handle it (typically a redirect
 * to the login page driven by api-manager's existing _handleAuthFailure).
 *
 * Non-403 errors are passed through untouched.
 */
function install403RefreshInterceptor(
  serviceKey: string,
  authService: ReturnType<typeof getAuthService>,
): void {
  const service = apiManager.getService(serviceKey);
  if (!service?.instance) {
    console.warn(`[install403RefreshInterceptor] service ${serviceKey} not configured`);
    return;
  }

  service.instance.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const config = error.config as RetryableConfig | undefined;
      const status = error.response?.status;

      // Non-403 — leave the existing 401 interceptor / caller error path alone.
      if (status !== 403 || !config) {
        return Promise.reject(error);
      }

      // Already retried once — don't loop. This is the "real 403" exit path.
      if (config._jiffy403Retried) {
        return Promise.reject(error);
      }
      config._jiffy403Retried = true;

      try {
        // refreshWithQueue() dedupes concurrent calls behind a single in-flight
        // promise, so all requests that 403'd around the same expiry share the
        // single Cognito InitiateAuth roundtrip.
        await authService.refreshWithQueue();
      } catch (refreshErr) {
        console.warn(
          `[install403RefreshInterceptor] ${serviceKey}: refresh failed, giving up on retry`,
          refreshErr,
        );
        // Surface the ORIGINAL 403 (not the refresh error) so callers see the
        // failure they expected. api-manager's auth-failure side effects (clear
        // localStorage, redirect to login) are driven by its 401 path; we lean
        // on that to fire on the next request once refresh state is broken.
        return Promise.reject(error);
      }

      // Re-issue the original request. Going through `service.instance(config)`
      // (rather than axios.request) re-runs the request interceptor chain, so
      // the now-refreshed Authorization header gets picked up automatically.
      return service.instance(config);
    },
  );
}
