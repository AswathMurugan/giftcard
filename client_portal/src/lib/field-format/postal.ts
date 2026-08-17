// Pure, DOM-free postal/ZIP format helpers (node-testable). Shared by every
// app's address blocks — do NOT re-implement these in page code. The admin
// preference layer that CHOOSES a format for a page stays app-side; these are
// only the format rules themselves.

export const POSTAL_FORMATS = ['auto', 'zip5', 'zip9', 'zip6', 'alnum'] as const;
export type PostalFormat = (typeof POSTAL_FORMATS)[number];

const digits = (s: string) => s.replace(/\D/g, '');

/**
 * Clamp/format postal input per format. `auto`: US → 5 digits; otherwise
 * alphanumeric up to 10 chars.
 */
export function validatePostalForFormat(input: string, format: PostalFormat, isUs: boolean): string {
  switch (format) {
    case 'zip5':
      return digits(input).slice(0, 5);
    case 'zip6':
      return digits(input).slice(0, 6);
    case 'zip9': {
      const d = digits(input).slice(0, 9);
      return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
    }
    case 'alnum':
      return input.replace(/[^A-Za-z0-9 -]/g, '').slice(0, 10);
    default:
      // auto: US → 5 digits; else alphanumeric up to 10.
      return isUs ? digits(input).slice(0, 5) : input.replace(/[^A-Za-z0-9 -]/g, '').slice(0, 10);
  }
}

/** Placeholder text for the postal input given the format. */
export function postalPlaceholder(format: PostalFormat, isUs: boolean): string {
  switch (format) {
    case 'zip5':
      return 'ZIP code (5 digits)';
    case 'zip6':
      return '6-digit postal code';
    case 'zip9':
      return 'ZIP+4 (12345-6789)';
    case 'alnum':
      return 'Postal code';
    default:
      return isUs ? 'ZIP code' : 'Postal code';
  }
}

/** Whether a postal value satisfies its format (for required-completeness). */
export function postalComplete(value: string, format: PostalFormat): boolean {
  const v = value.trim();
  switch (format) {
    case 'zip5':
      return /^\d{5}$/.test(v);
    case 'zip6':
      return /^\d{6}$/.test(v);
    case 'zip9':
      return /^\d{5}(-\d{4})?$/.test(v);
    default:
      return v !== '';
  }
}
