/**
 * AppSync Events connection config for the agent chat transport.
 *
 * Two values, resolved lazily at connect time:
 *
 *   - `wsUrl`     — from `websocket_url` on the auth-config response. This is
 *                   BACKEND-SUPPLIED per tenant + environment; it is NOT a build
 *                   env var, so sandbox and prod each get their own endpoint
 *                   with nothing baked into the bundle.
 *   - `authToken` — the credential, chosen by HOSTNAME: localhost →
 *                   VITE_APPSYNC_API_KEY; any real host (sandbox/prod) → the
 *                   Cognito access token. There is no prod API key.
 *
 * Lazy pull, not a bootstrap push: `main.tsx` already awaits
 * `ensureAuthConfigured()` + `initializeApi()` BEFORE React renders, so by the
 * time a chat can be opened the config response is guaranteed present. Reading
 * it at connect time also keeps the token fresh.
 */

import { getAuthService } from '@/config/auth-service-manager';
import { normalizeWsUrl } from './chat-channel';

export interface AppSyncEventsConfig {
  /** Full `wss://…/event/realtime` URL. */
  wsUrl: string;
  /** Bearer credential — a Cognito access token, or an API key on localhost. */
  authToken: string;
}

/** True when running on a local dev origin (the only place an API key is used). */
export function isLocalDevHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

/**
 * Read `websocket_url` off the auth-config response.
 *
 * `CognitoConfigResponse` declares `[key: string]: unknown`, so this field is
 * present on the wire but untyped — narrowed here rather than editing the
 * starter-owned auth-service.
 */
export function readWebsocketUrl(config: Record<string, unknown> | null): string {
  const raw = config?.websocket_url;
  return typeof raw === 'string' ? normalizeWsUrl(raw) : '';
}

/**
 * Resolve the WebSocket credential for the current origin. The branch is on
 * HOSTNAME, not build mode. Returns '' when unavailable — the caller turns that
 * into a loud, actionable error rather than a silent dead socket.
 */
export function resolveAuthToken(
  hostname: string,
  accessToken: string | null,
  apiKey: string | undefined,
): string {
  if (isLocalDevHost(hostname)) return apiKey ?? '';
  return accessToken ?? '';
}

/** Full config, or `null` when the endpoint/credential isn't available. */
export function getAppSyncEventsConfig(): AppSyncEventsConfig | null {
  const authService = getAuthService();
  const wsUrl = readWebsocketUrl(
    authService.getFullConfigResponse() as Record<string, unknown> | null,
  );
  if (!wsUrl) return null;

  const authToken = resolveAuthToken(
    window.location.hostname,
    authService.getAccessToken(),
    import.meta.env.VITE_APPSYNC_API_KEY as string | undefined,
  );
  if (!authToken) return null;

  return { wsUrl, authToken };
}

/**
 * Why a connection can't be made, for an actionable error message. Only called
 * once `getAppSyncEventsConfig()` has already returned null.
 */
export function describeConfigFailure(): string {
  const authService = getAuthService();
  const wsUrl = readWebsocketUrl(
    authService.getFullConfigResponse() as Record<string, unknown> | null,
  );
  if (!wsUrl) {
    return (
      'Agent chat is unavailable: the tenant auth config did not include a ' +
      '`websocket_url`, so there is no AppSync endpoint to connect to.'
    );
  }
  if (isLocalDevHost(window.location.hostname)) {
    return (
      'Agent chat is unavailable on localhost: set VITE_APPSYNC_API_KEY in ' +
      'codegen-starter/.env. (Deployed sessions use the Cognito access token ' +
      'and need no AppSync config.)'
    );
  }
  return 'Agent chat is unavailable: no access token. Sign in and try again.';
}
