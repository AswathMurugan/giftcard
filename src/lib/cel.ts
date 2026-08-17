/**
 * CEL filter-string helpers — the ONE blessed escaping rule for Phoenix CEL
 * string literals.
 *
 * The backend accepts exactly one escaping scheme inside a CEL `'…'` literal:
 * backslash escaping, with backslashes doubled FIRST (CEL single-quoted
 * strings process backslash escapes, so an unescaped user `C:\temp` would
 * silently turn `\t` into a TAB in the parsed literal), then `'` -> `\'`.
 *
 * NOT valid, in any context:
 *   - SQL-style quote-doubling (`''`) — runtime PHX-ERR-400.
 *   - `ilike()` — does not exist; use `containsIgnoreCase(field, value)`
 *     (case-insensitive, and `%`/`_` match literally).
 *
 * Every interpolation of a runtime value into a CEL filter MUST go through
 * these helpers — never hand-roll an escaper in page code.
 *
 * Pure + browser-free for node vitest.
 */

/** Escape a string for inclusion inside a CEL `'…'` literal. */
export function escapeCelString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Fully quoted CEL string literal — prefer this over hand-quoting so the
 * quotes and escaping can never drift apart:
 * `celString("O'Brien")` -> `'O\'Brien'`.
 */
export function celString(value: string): string {
  return `'${escapeCelString(value)}'`;
}
