/**
 * Local-dev helper for pointing the codegen fetch scripts at the Phoenix
 * PUBLIC gateway (e.g. prod) instead of the in-VPC internal endpoints.
 *
 * Why this exists
 * ---------------
 * The fetch scripts call `…/internal/…` endpoints (e.g.
 * `/api/internal/component-definitions-all/entity`). Those are
 * header-authenticated and only reachable from inside the platform network —
 * the sandbox edge, or the cloud editor's in-VPC PHOENIX_API_URL. In PROD the
 * public CloudFront edge BLOCKS every `…/internal/…` path with a 403 ("Request
 * blocked"), regardless of any auth header.
 *
 * Empirically, the same component-definition data is served WITHOUT the
 * `internal` path segment behind the authenticated gateway, gated by a Cognito
 * bearer token. So when `PHOENIX_AUTH_TOKEN` is set (local dev against a public
 * host) we:
 *   1. strip the `/internal` segment from the request path, and
 *   2. send `Authorization: Bearer <token>`.
 *
 * When `PHOENIX_AUTH_TOKEN` is NOT set (sandbox, or the in-VPC cloud bootstrap),
 * behaviour is unchanged: internal paths, header-only auth. So this is a
 * local-dev opt-in that never affects the normal sandbox/cloud flows.
 *
 * Getting a token (local dev only — the token is short-lived, ~1h Cognito):
 *   - Obtain an access token for the tenant (e.g. via Cognito InitiateAuth).
 *   - Put it in `codegen-starter/.env`:  PHOENIX_AUTH_TOKEN=<accessToken>
 *   - NEVER commit the token. It expires; re-fetch as needed.
 */

function authToken(): string | undefined {
  const t = process.env.PHOENIX_AUTH_TOKEN?.trim();
  return t ? t : undefined;
}

/** True when a bearer token is configured (local dev → public gateway mode). */
export function usingGatewayAuth(): boolean {
  return authToken() !== undefined;
}

/**
 * Rewrite a Phoenix URL/path for the active mode. In gateway-auth mode the
 * `/internal` path segment is removed (CloudFront blocks it); otherwise the
 * input is returned unchanged. Accepts a full URL or a bare path.
 *
 *   /api/internal/component-definitions-all/entity → /api/component-definitions-all/entity
 *   /api/internal/applications?name=x              → /api/applications?name=x
 *   /data/internal/query/org                       → /data/query/org
 */
export function phoenixUrl(urlOrPath: string): string {
  return authToken() ? urlOrPath.replace(/\/internal(?=\/)/, '') : urlOrPath;
}

/**
 * Add `Authorization: Bearer <token>` when a token is configured; otherwise
 * return the headers unchanged. Use to wrap the headers object of any fetch
 * call in the codegen scripts.
 */
export function withAuth(
  headers: Record<string, string>,
): Record<string, string> {
  const t = authToken();
  return t ? { ...headers, Authorization: `Bearer ${t}` } : headers;
}
