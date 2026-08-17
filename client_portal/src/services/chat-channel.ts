/**
 * Pure helpers for the AppSync Events chat transport.
 *
 * Kept free of `fetch` / `WebSocket` / React so they can be unit-tested in the
 * repo's node vitest environment (the same rule the codegen libs follow).
 *
 * The wire contract is AppSync's **Events API** (pub/sub over channels) — NOT
 * GraphQL. There are no queries/mutations, just `subscribe` + `publish` frames.
 */

/**
 * AppSync channel segments accept only `[A-Za-z0-9-]`. Anything else collapses
 * to `-`, runs are squeezed, and leading/trailing dashes trimmed. An empty
 * result becomes `default` so a path never contains an empty segment.
 */
export function sanitizeChannelSegment(value: string, maxLength = 0): string {
  let result = value
    .replace(/[^A-Za-z0-9-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!result) return 'default';
  if (maxLength > 0) result = result.slice(0, maxLength).replace(/-+$/, '');
  return result;
}

/**
 * Build a channel path. AppSync rejects anything outside the `/default`
 * namespace with `UnauthorizedException`, so the namespace is always first
 * (capped at 50 chars).
 */
export function buildChannelPath(namespace: string, ...segments: string[]): string {
  const ns = sanitizeChannelSegment(namespace, 50);
  const parts = segments.map((s) => sanitizeChannelSegment(s));
  return `/${ns}/${parts.join('/')}`;
}

/** The per-session channel an agent publishes its response events to. */
export function agentChannelPath(agentName: string, sessionId: string): string {
  return buildChannelPath('default', 'agentframework', agentName, sessionId);
}

/** The shared channel every session-control message is published to. */
export const LISTENER_CHANNEL = '/default/agents/invoke';

/**
 * AppSync's realtime endpoint and its API endpoint differ by one infix. The
 * `host` we sign each frame with must be the API host, not the realtime one.
 */
export function extractHost(wsUrl: string): string {
  const url = new URL(wsUrl);
  return url.host.replace('.appsync-realtime-api.', '.appsync-api.');
}

/**
 * AppSync smuggles the auth header through the WebSocket subprotocol array, so
 * it must be base64**url** — the standard alphabet's `+` / `/` / `=` are not
 * legal in a subprotocol token.
 */
export function createAuthHeader(host: string, token: string): string {
  const header = { host, Authorization: `Bearer ${token}` };
  const base64 = btoa(JSON.stringify(header));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Normalize the `websocket_url` from the auth-config API. Phoenix may send a
 * full `wss://` URL or a bare host; a bare host needs the scheme and the
 * AppSync Events realtime path appended.
 */
export function normalizeWsUrl(raw: string): string {
  const value = raw.trim();
  if (!value) return '';
  return value.startsWith('wss://') ? value : `wss://${value}/event/realtime`;
}
