// Pure, DOM-free SSN helpers (node-testable). Shared by every app's SSN
// inputs — do NOT re-implement these in page code.

/** A complete US SSN in display form. */
export const SSN_RE = /^\d{3}-\d{2}-\d{4}$/;

/** Format raw input into a masked SSN as the user types: digits → XXX-XX-XXXX. */
export function formatSsn(raw: string): string {
  const digits = (raw ?? '').replace(/\D/g, '').slice(0, 9);
  const a = digits.slice(0, 3);
  const b = digits.slice(3, 5);
  const c = digits.slice(5, 9);
  if (digits.length <= 3) return a;
  if (digits.length <= 5) return `${a}-${b}`;
  return `${a}-${b}-${c}`;
}

/** True when the value is a complete SSN. */
export function isCompleteSsn(value: string | undefined): boolean {
  return SSN_RE.test((value ?? '').trim());
}

/** Mask all but the last 4 digits for read-only display (Review steps etc.). */
export function maskSsn(value: unknown): string {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v) return '—';
  const digits = v.replace(/\D/g, '');
  if (digits.length < 4) return v;
  return `•••-••-${digits.slice(-4)}`;
}

/**
 * Mask for the SSN INPUT's hidden state: show only the last 4 digits
 * (`***-**-6789`). Only masks a COMPLETE SSN; an incomplete/empty value is
 * returned as-is (the user is still entering it).
 */
export function maskSsnInput(value: unknown): string {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v) return '';
  const digits = v.replace(/\D/g, '');
  if (digits.length < 9) return v;
  return `***-**-${digits.slice(-4)}`;
}
