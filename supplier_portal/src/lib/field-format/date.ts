// Pure, DOM-free, TIMEZONE-STABLE date helpers (node-testable). Shared by
// every app's date fields and date display — do NOT re-implement these in
// page code.
//
// WHY TZ-STABLE: the backend returns ISO-ish strings (`2026-07-15`,
// `2026-07-15T00:00:00Z`). Formatting them with `new Date(raw)` and then
// reading LOCAL getters shifts a UTC-midnight value back a calendar day in
// western timezones — `2026-07-15` renders as "07/14" in the US. The fix:
// read the calendar/wall-clock components DIRECTLY out of the ISO string.
// (These formatters intentionally do NOT localise an instant to the viewer's
// zone — the source wall-clock is the intended, deterministic display.)
import { asText } from '@/lib/runtime';

/** `yyyy-MM-dd` string → local Date (or undefined). For DatePicker round-trips. */
export function parseDateOnly(value: string | undefined): Date | undefined {
  return value ? new Date(`${value}T00:00:00`) : undefined;
}

/** Date → `yyyy-MM-dd` string (or empty). For DatePicker round-trips. */
export function toDateOnlyString(d: Date | undefined): string {
  if (!d) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

interface IsoParts {
  y: string;
  mo: string;
  d: string;
  /** Present only when the string carries a time component. */
  hh?: string;
  min?: string;
}

/** Parse the leading `YYYY-MM-DD[(T| )hh:mm]` out of an ISO-ish string. */
function parseIsoParts(raw: string): IsoParts | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(raw);
  if (!m) return null;
  return { y: m[1], mo: m[2], d: m[3], hh: m[4], min: m[5] };
}

/** Convert a 24-hour `HH:mm` to a 12-hour `h:mm AM/PM` label. */
function to12Hour(hh: string, min: string): string {
  let h = parseInt(hh, 10);
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${min} ${ampm}`;
}

/**
 * `MM/DD/YYYY` from an ISO-ish string — or `'—'` when absent, or the raw string
 * when it can't be parsed. The calendar date is read literally (no TZ shift).
 */
export function formatDate(value: unknown): string {
  const raw = asText(value).trim();
  if (!raw) return '—';
  const p = parseIsoParts(raw);
  if (p) return `${p.mo}/${p.d}/${p.y}`;
  // Non-ISO fallback (e.g. a locale string): best-effort local parse.
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${d.getFullYear()}`;
}

/**
 * `MM/DD/YYYY, h:mm AM/PM` from an ISO-ish string (wall-clock as written) — or
 * `MM/DD/YYYY` when the value has no time, `'—'` when absent, or the raw string
 * when unparseable.
 */
export function formatDateTime(value: unknown): string {
  const raw = asText(value).trim();
  if (!raw) return '—';
  const p = parseIsoParts(raw);
  if (p) {
    const date = `${p.mo}/${p.d}/${p.y}`;
    return p.hh !== undefined && p.min !== undefined ? `${date}, ${to12Hour(p.hh, p.min)}` : date;
  }
  // Non-ISO fallback: best-effort local parse.
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${d.getFullYear()}, ${to12Hour(String(d.getHours()), String(d.getMinutes()).padStart(2, '0'))}`;
}
