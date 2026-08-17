// Pure, DOM-free EIN (Employer Identification Number) helpers (node-testable).
// Shared by every app's EIN inputs — do NOT re-implement these in page code.

/** A complete US EIN in display form. */
export const EIN_RE = /^\d{2}-\d{7}$/;

/** Format raw input as a US EIN `XX-XXXXXXX` (max 9 digits). */
export function formatEin(input: string): string {
  const d = (input ?? '').replace(/\D/g, '').slice(0, 9);
  if (d.length <= 2) return d;
  return `${d.slice(0, 2)}-${d.slice(2)}`;
}

/** True when the value is a complete EIN (`XX-XXXXXXX`). */
export function isCompleteEin(value: string | undefined): boolean {
  return EIN_RE.test((value ?? '').trim());
}
