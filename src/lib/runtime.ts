/**
 * Runtime-safe coercions for values read off Phoenix data rows.
 *
 * WHY THIS EXISTS: the generated `src/types/*` types are compile-time hints
 * derived from Phoenix's *declared* attribute types — they are NOT a runtime
 * guarantee. A field declared `string` can arrive as a `boolean`, `number`, or
 * `null` from the backend. Calling `.trim()` / `.toLowerCase()` / `.toFixed()`
 * directly on such a value throws ("x.trim is not a function"), and inside an
 * AG Grid cell renderer that trips the error boundary and blanks the page.
 *
 * Use these at the data boundary (cell renderers, formatters, status/flag
 * derivations) instead of trusting the declared type.
 */

/** Coerce any row value to a display string. number/boolean are stringified; null/object → ''. */
export function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return String(value);
  return '';
}

/**
 * Interpret any row value as a boolean flag, tolerant of the shapes Phoenix
 * actually returns for a "flag" scalar: a real boolean, a 0/1 number, or a
 * string like "true"/"active"/"yes"/"1"/"y" (case-insensitive). Anything else
 * (null, object, "", "false", "0") → false.
 */
export function coerceBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    return ['true', 'active', 'yes', '1', 'y'].includes(value.trim().toLowerCase());
  }
  return false;
}

/** Coerce any row value to a finite number, or null when it isn't one. */
export function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
