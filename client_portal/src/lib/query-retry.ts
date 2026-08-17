/**
 * Status-aware React Query retry policy.
 *
 * The blanket `retry: 1` it replaces retried EVERY failure once — including
 * 4xx client errors where a retry is pure waste (a 400/403/404 will not
 * succeed on the second try) — while giving genuinely transient failures
 * (5xx, network blips) only a single extra shot with no meaningful backoff.
 *
 * Policy:
 *   - 4xx  -> never retry.
 *   - 5xx / no HTTP status (network error, timeout) -> retry up to 2 times
 *     (3 attempts total) with exponential backoff capped at 8s.
 *   - Mutations keep React Query's default of 0 retries — saved-query writes
 *     are not idempotent, so auto-retrying a timed-out mutation risks
 *     duplicate inserts. Do not add mutation retries.
 *
 * Pure + browser-free for node vitest.
 */

const MAX_TRANSIENT_RETRIES = 2;
const RETRY_DELAY_CAP_MS = 8_000;

/** Best-effort HTTP status extraction from an axios-shaped error. */
export function errorHttpStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const response = (error as { response?: unknown }).response;
  if (typeof response !== 'object' || response === null) return undefined;
  const status = (response as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

/** React Query `retry` predicate: `failureCount` = retries already performed. */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  const status = errorHttpStatus(error);
  if (status !== undefined && status >= 400 && status < 500) return false;
  return failureCount < MAX_TRANSIENT_RETRIES;
}

/** React Query `retryDelay`: 1s, 2s, 4s, … capped at 8s. */
export function queryRetryDelay(retryAttempt: number): number {
  return Math.min(1000 * 2 ** retryAttempt, RETRY_DELAY_CAP_MS);
}
