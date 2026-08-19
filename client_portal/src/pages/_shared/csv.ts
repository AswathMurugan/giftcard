/**
 * CSV for the download buttons.
 *
 * Excel is the real consumer here, and it is fussy in three specific ways that
 * a naive `rows.join(',')` gets wrong every time:
 *
 *  1. **A leading BOM or it mangles non-ASCII.** Without `﻿` Excel reads
 *     the file as the local ANSI codepage, so "Sephora — Reno" arrives as
 *     mojibake. The BOM costs three bytes and removes a whole class of bug
 *     reports.
 *  2. **CRLF line endings.** Excel accepts LF, but Notepad and a few older
 *     importers render the whole file as one line.
 *  3. **A value starting `=`, `+`, `-` or `@` is executed as a formula.** A
 *     destination literally named "=SUM(A1)" is a spreadsheet injection, and
 *     the fix is a leading apostrophe, not quoting — quotes alone do not stop
 *     it. This matters because destinations and tracking numbers are free text
 *     typed by suppliers.
 *
 * Everything is quoted rather than only-when-needed: it is one branch fewer,
 * and Excel does not care.
 */

/** Values a cell can hold before it becomes text. */
export type CsvValue = string | number | boolean | null | undefined;

export interface CsvColumn<Row> {
  /** Header text, written verbatim. */
  header: string;
  /** Pull the cell out of the row. Keep it total — return '' rather than throw. */
  value: (row: Row) => CsvValue;
}

/** Characters that make Excel treat a cell as a formula rather than text. */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * One cell: stringify, defuse a formula, then quote.
 *
 * `null`/`undefined` become empty rather than the strings "null"/"undefined" —
 * a blank cell is what a reader expects for a missing tracking number.
 */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return '""';
  let text = String(value);
  if (FORMULA_LEAD.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * Build the CSV text for a set of rows.
 *
 * Returns headers alone when there are no rows — an empty file with a header
 * is a valid, readable answer to "export this list"; a zero-byte file looks
 * like the download broke.
 */
export function toCsv<Row>(rows: readonly Row[], columns: readonly CsvColumn<Row>[]): string {
  const lines: string[] = [columns.map((c) => csvCell(c.header)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => csvCell(c.value(row))).join(','));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

/**
 * A filesystem-safe filename stem.
 *
 * Order codes carry hyphens already (`GC-1019`), so the only real risks are
 * slashes and colons from a destination or a date. Collapses runs rather than
 * deleting, so `GC-1019 / Reno` reads as `GC-1019-Reno` and not `GC-1019Reno`.
 */
export function csvFilename(stem: string, isoDate: string): string {
  const safe = stem
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  const day = isoDate.slice(0, 10);
  return `${safe || 'export'}-${day}.csv`;
}
