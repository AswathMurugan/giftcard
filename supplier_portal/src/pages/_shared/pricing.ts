/**
 * The rate-card vocabulary, shared by everything that prices a deal.
 *
 * This used to live in `src/pages/pricing/pricing-helpers.ts` alongside a
 * Pricing page. That page is gone: a `pricing_template` binds to exactly one
 * client and the tenant allows exactly one active standard template per
 * client, so a rate card is a PROPERTY of a client rather than a catalogue of
 * its own. Editing it now happens on the client's card in Clients, next to the
 * Activate button whose blockers it decides. What survived the merge is only
 * the vocabulary — the roles, and the conversion between how a margin is typed
 * and how it is stored.
 *
 * Rates are basis points: 1200 = 12%. Stored that way so a margin is an integer
 * everywhere and never accumulates float error.
 */

export const BPS = 10_000;

/** The component roles a template can price. Ordered as the demo orders them. */
export const COMPONENT_ROLES = ['card', 'carrier', 'features', 'setup'] as const;
export type ComponentRole = (typeof COMPONENT_ROLES)[number];

/** Basis points → a percentage string. */
export function pct(bps: number | null | undefined): string {
  return bps === null || bps === undefined ? '—' : `${(bps / 100).toFixed(1)}%`;
}

/** A typed percentage → basis points, clamped to the demo's 0–60 range. */
export function pctToBps(value: string): number {
  const n = Number(String(value).replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.max(0, Math.min(60, n)) * 100);
}
