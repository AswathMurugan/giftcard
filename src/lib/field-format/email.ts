// Pure email helpers (node-testable). Shared by every app's email fields —
// do NOT re-implement these in page code.

/**
 * Pragmatic email shape: `local@domain.tld` — no spaces, a single `@`, and a
 * dotted domain with a 2+ char TLD. Intentionally simple (not full RFC 5322);
 * catches the common typos (missing `@`, missing domain/TLD) without rejecting
 * valid addresses.
 */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** True when the value looks like a valid email address (trimmed). */
export function isValidEmail(value: string | undefined): boolean {
  return EMAIL_RE.test((value ?? '').trim());
}
