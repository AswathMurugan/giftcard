/**
 * Quote stage — turning four unjoined lists into a comparison matrix.
 *
 * `order_quote_grid` returns `rfes`, `tiers`, `responses` and `response_lines`
 * separately; the join is done here, client-side, exactly as the saved query's
 * description says. Nothing is derived that the data doesn't carry: a supplier
 * with no response shows as awaiting, not as zero.
 *
 * Costs are stored as MICROS — millionths of a currency unit — so $0.044 is
 * 44000. Integer storage avoids the float drift you get multiplying a
 * three-decimal unit price by a five-figure quantity.
 */

import { asNumber, asText } from '@/lib/runtime';

export const MICROS_PER_UNIT = 1_000_000;

/** Micros → a unit price. Null in, null out — never 0, which reads as free. */
export function microsToUnit(micros: unknown): number | null {
  const n = asNumber(micros);
  return n === null ? null : n / MICROS_PER_UNIT;
}

/** A typed unit price → micros, rounded to the nearest whole micro. */
export function unitToMicros(unit: number): number {
  return Math.round(unit * MICROS_PER_UNIT);
}

/** `$0.044` — three decimals is the precision the category quotes in. */
export function formatUnit(unit: number | null): string {
  return unit === null ? '—' : `$${unit.toFixed(3)}`;
}

export function formatTotal(total: number | null): string {
  return total === null ? '—' : `$${Math.round(total).toLocaleString()}`;
}

export interface QuoteRfe {
  id?: string;
  status?: string;
  respond_by?: string;
  sent_at?: string | null;
  supplier?: { id?: string; name?: string } | null;
}

export interface QuoteTier {
  id?: string;
  tier_qty?: number;
  /** Which material this tier prices — card body, personalisation, carrier,
   *  setup. A line has one tier PER MATERIAL, all at the same tier_qty. */
  component_role?: string;
  rfe_line?: {
    id?: string;
    qty?: number;
    rfe_id?: string;
    order_line_id?: { id?: string } | null;
    item_rev_id?: {
      rev?: number;
      item_id?: { id?: string; name?: string; component_role?: string; item_type?: string };
    } | null;
  } | null;
}

export interface QuoteResponse {
  id?: string;
  round?: number;
  status?: string;
  lead_time_weeks?: number;
  supplier_quote_no?: string;
  validity_until?: string;
  commits_to_delivery?: boolean;
  submitted_at?: string;
  rfe?: { id?: string } | null;
}

export interface QuoteResponseLine {
  id?: string;
  cost_micros?: number;
  declined?: boolean;
  uncosted?: boolean;
  note?: string;
  response?: { id?: string } | null;
  tier?: { id?: string } | null;
}

export interface QuoteGridResult {
  rfes?: QuoteRfe[];
  tiers?: QuoteTier[];
  responses?: QuoteResponse[];
  response_lines?: QuoteResponseLine[];
}

/** One product line being quoted, keyed by the tier that represents it. */
export interface QuoteLine {
  tierId: string;
  rfeId: string;
  /** The demand order line this tier bids on — what an allocation is keyed by. */
  orderLineId: string | null;
  name: string;
  componentRole: string;
  rev: number | null;
  qty: number;
}

/**
 * One supplier's answer for one product line.
 *
 * A line is quoted MATERIAL by material — card body, personalisation,
 * carrier, setup — and those costs sum to the card's unit cost. `unitCost` is
 * therefore a SUM, never a single tier's price: reading one tier and calling
 * it the card's cost under-reports the quote by however many materials it
 * ignored.
 */
export interface QuoteCell {
  /** Sum of the priced materials. Null when nothing on this line was priced. */
  unitCost: number | null;
  extended: number | null;
  /** Per-material unit cost. Null = not answered, 0 with `declined` = refused. */
  byRole: Record<string, number | null>;
  /** Materials the supplier refused to supply. */
  declinedRoles: string[];
  /** True when a material was left unanswered — the line is not fully quoted. */
  hasUncosted: boolean;
  declined: boolean;
  uncosted: boolean;
}

export interface QuoteColumn {
  rfeId: string;
  supplierId: string;
  supplierName: string;
  status: string;
  /** Latest round's response, or null if none started. */
  response: QuoteResponse | null;
  leadTimeWeeks: number | null;
  /** tierId → cell. */
  cells: Record<string, QuoteCell>;
  /** Sum of extended costs across every line the supplier priced. */
  total: number | null;
  /** True when the supplier has priced every line. */
  complete: boolean;
}

/** The lines under quote, one per distinct tier, in a stable order. */
export function quoteLines(result: QuoteGridResult | null | undefined): QuoteLine[] {
  const seen = new Map<string, QuoteLine>();
  for (const t of result?.tiers ?? []) {
    if (!t.id || !t.rfe_line?.rfe_id) continue;
    const item = t.rfe_line.item_rev_id?.item_id;
    // Key by product + quantity, not tier id: the same card quoted by three
    // suppliers produces three tier rows that are one logical line.
    const key = `${item?.id ?? t.rfe_line.id}-${t.tier_qty ?? 0}`;
    if (!seen.has(key)) {
      seen.set(key, {
        tierId: t.id,
        rfeId: t.rfe_line.rfe_id,
        orderLineId: t.rfe_line.order_line_id?.id ?? null,
        name: asText(item?.name) || 'Unnamed line',
        componentRole: asText(item?.component_role) || 'card',
        rev: asNumber(t.rfe_line.item_rev_id?.rev),
        qty: asNumber(t.tier_qty) ?? asNumber(t.rfe_line.qty) ?? 0,
      });
    }
  }
  return [...seen.values()];
}

/**
 * The tier row belonging to a SPECIFIC RFE for a logical line.
 *
 * `quoteLines` collapses the three tier rows for "Thanksgiving Harvest @
 * 25,000" (one per supplier asked) into one display line, keeping the first
 * tier's id as its key. That representative id must never be written back:
 * a response line hangs off the tier of the RFE being answered, so posting
 * every supplier's cost against the representative tier files all three
 * quotes under one supplier — which is exactly what happened before this
 * existed. Resolve the answering supplier's own tier at submit time.
 */
export function tierIdFor(
  result: QuoteGridResult | null | undefined,
  line: QuoteLine,
  rfeId: string,
): string | null {
  const match = (result?.tiers ?? []).find(
    (t) =>
      t.rfe_line?.rfe_id === rfeId &&
      asText(t.rfe_line?.item_rev_id?.item_id?.name) === line.name &&
      (asNumber(t.tier_qty) ?? 0) === line.qty,
  );
  return match?.id ?? null;
}

/** Pick the highest round — a returned RFE opens round 2 rather than overwriting. */
export function latestResponse(
  responses: QuoteResponse[],
  rfeId: string,
): QuoteResponse | null {
  const mine = responses.filter((r) => r.rfe?.id === rfeId);
  if (mine.length === 0) return null;
  return mine.reduce((best, r) => ((r.round ?? 0) > (best.round ?? 0) ? r : best));
}

/**
 * Build one column per RFE.
 *
 * Driven by the RFE list, so a supplier who has been asked but not answered
 * still gets a column — the whole point of the comparison is seeing who is
 * missing.
 */
export function quoteColumns(
  result: QuoteGridResult | null | undefined,
  lines: QuoteLine[],
): QuoteColumn[] {
  const responses = result?.responses ?? [];
  const responseLines = result?.response_lines ?? [];
  const tiers = result?.tiers ?? [];

  return (result?.rfes ?? [])
    .filter((r) => r.id)
    .map((rfe) => {
      const rfeId = rfe.id as string;
      const response = latestResponse(responses, rfeId);
      // This supplier's own tier rows, matched back to the logical lines.
      const myTiers = tiers.filter((t) => t.rfe_line?.rfe_id === rfeId);
      const cells: Record<string, QuoteCell> = {};
      let total = 0;
      let priced = 0;

      for (const line of lines) {
        // EVERY tier for this line, one per material — not just the first.
        const lineTiers = myTiers.filter(
          (t) =>
            asText(t.rfe_line?.item_rev_id?.item_id?.name) === line.name &&
            (asNumber(t.tier_qty) ?? 0) === line.qty,
        );

        const byRole: Record<string, number | null> = {};
        const declinedRoles: string[] = [];
        let sum = 0;
        let anyPriced = false;
        let hasUncosted = false;

        for (const tier of lineTiers) {
          const role = asText(tier.component_role) || 'card';
          const rl = responseLines.find(
            (l) => l.tier?.id === tier.id && l.response?.id === response?.id,
          );
          if (!rl) {
            // No answer at all for this material.
            byRole[role] = null;
            if (response) hasUncosted = true;
            continue;
          }
          if (rl.declined) {
            // Refusing a material is not a price for it. The role is kept —
            // "I'll do the card but not the carrier" is exactly what a
            // carve-out is made of — but the LINE is no longer fully quoted,
            // so this supplier's total cannot be compared with one who priced
            // everything. Without this, declining the dearest component made a
            // supplier look like the cheapest complete quote.
            byRole[role] = 0;
            declinedRoles.push(role);
            hasUncosted = true;
            continue;
          }
          if (rl.uncosted) {
            byRole[role] = null;
            hasUncosted = true;
            continue;
          }
          const unit = microsToUnit(rl.cost_micros);
          byRole[role] = unit;
          if (unit !== null) {
            sum += unit;
            anyPriced = true;
          }
        }

        const unitCost = anyPriced ? sum : null;
        const extended = unitCost === null ? null : unitCost * line.qty;
        // A line counts as priced only when nothing was left unanswered —
        // a half-answered line would otherwise flatter the supplier's total.
        if (extended !== null && !hasUncosted) {
          total += extended;
          priced += 1;
        }
        cells[line.tierId] = {
          unitCost,
          extended,
          byRole,
          declinedRoles,
          hasUncosted,
          declined: lineTiers.length > 0 && declinedRoles.length === lineTiers.length,
          uncosted: !anyPriced && declinedRoles.length === 0,
        };
      }

      return {
        rfeId,
        supplierId: asText(rfe.supplier?.id),
        supplierName: asText(rfe.supplier?.name) || 'Unknown supplier',
        status: asText(rfe.status) || 'sent',
        response,
        leadTimeWeeks: asNumber(response?.lead_time_weeks),
        cells,
        total: priced > 0 ? total : null,
        complete: priced === lines.length && lines.length > 0,
      };
    })
    .sort((a, b) => a.supplierName.localeCompare(b.supplierName));
}

/**
 * The best complete quote.
 *
 * Only fully-priced columns compete: a supplier who priced one line of three
 * would otherwise always "win" on total. Null when nobody has quoted in full.
 */
export function bestColumn(columns: QuoteColumn[]): QuoteColumn | null {
  const complete = columns.filter((c) => c.complete && c.total !== null);
  if (complete.length === 0) return null;
  return complete.reduce((best, c) => ((c.total as number) < (best.total as number) ? c : best));
}

/** Percentage a column sits above the best complete quote, or null. */
export function premiumPct(column: QuoteColumn, best: QuoteColumn | null): number | null {
  if (!best || best.total === null || column.total === null || best.total <= 0) return null;
  return Math.round(((column.total - best.total) / best.total) * 100);
}
