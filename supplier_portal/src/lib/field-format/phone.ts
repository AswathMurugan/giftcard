// Pure, DOM-free US-phone helpers (node-testable). Shared by every app's
// phone inputs — do NOT re-implement these in page code.

/**
 * Format input as a US phone with country code: `+1 (XXX) XXX-XXXX`, built up
 * progressively as the user types. Empty → '' (so the placeholder shows). A
 * leading `1` country-code digit is stripped (we always render the `+1`).
 */
export function formatPhone(input: string): string {
  let d = (input ?? '').replace(/\D/g, '');
  // The field already renders `+1`, so a leading `1` is the country code — strip
  // it (US national numbers never start with 1) to avoid re-consuming it.
  if (d.startsWith('1')) d = d.slice(1);
  d = d.slice(0, 10);
  // Show raw digits until the area code is complete; the `+1 (…)` formatting
  // only kicks in at 3 digits.
  if (d.length < 3) return d;
  let out = `+1 (${d.slice(0, 3)})`;
  if (d.length > 3) out += ` ${d.slice(3, 6)}`;
  if (d.length > 6) out += `-${d.slice(6, 10)}`;
  return out;
}

/** True when the value is a complete US phone (10 national digits). */
export function isCompletePhone(value: string | undefined): boolean {
  let d = (value ?? '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return d.length === 10;
}
