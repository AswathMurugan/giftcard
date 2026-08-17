// Pure, DOM-free money/currency helpers (node-testable). Shared by every
// app's money inputs and USD display formatting — do NOT re-implement these
// in page code. (These unify what used to be four separate per-app
// implementations: sanitizeMoney/formatMoneyDisplay on the input side and
// formatAmount/formatBalance/formatMoneyCap on the display side.)
import { asNumber } from '@/lib/runtime';

/** A stored money string: whole dollars with an optional 1–2 digit decimal. */
export const MONEY_RE = /^\d+(\.\d{1,2})?$/;

/** Keep only digits + a single decimal point (max 2 decimals) — stored value. */
export function sanitizeMoney(v: string): string {
  let s = v.replace(/[^\d.]/g, '');
  const dot = s.indexOf('.');
  if (dot !== -1) {
    const intPart = s.slice(0, dot);
    const decPart = s.slice(dot + 1).replace(/\./g, '').slice(0, 2);
    s = `${intPart}.${decPart}`;
  }
  return s;
}

/** Format a raw money string with thousands separators for DISPLAY only. */
export function formatMoneyDisplay(value: unknown): string {
  const v = typeof value === 'string' ? value : value == null ? '' : String(value);
  if (!v) return '';
  const [intPart, decPart] = v.split('.');
  const grouped = (intPart || '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return decPart !== undefined ? `${grouped}.${decPart}` : grouped;
}

export interface FormatUsdOptions {
  /** Include cents (`$1,234.50`). Default true; false → whole dollars (`$1,235`). */
  cents?: boolean;
  /** Returned when the value isn't a finite number. Default `'—'`. */
  fallback?: string;
}

/**
 * Format any row value as USD. Runtime-safe: accepts number | numeric string |
 * anything (via `asNumber`); a non-numeric/absent value returns `fallback`.
 *
 *   formatUsd(1234.5)                      → "$1,234.50"
 *   formatUsd('1234.5', { cents: false })  → "$1,235"
 *   formatUsd(null)                        → "—"
 *   formatUsd(null, { fallback: '' })      → ""
 */
export function formatUsd(value: unknown, opts: FormatUsdOptions = {}): string {
  const { cents = true, fallback = '—' } = opts;
  const n = asNumber(value);
  if (n === null) return fallback;
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    ...(cents ? { minimumFractionDigits: 2 } : { maximumFractionDigits: 0 }),
  });
}
