/**
 * Decision chain — Deal Review, Allocation, Proposal.
 *
 * Turns supplier COST into a governed client SELL price. Domain model B3.
 *
 * `margin_bps` is a MARGIN on the sell price, not a markup on cost:
 *     sell = cost / (1 − margin_bps/10000)
 *
 * Three things agree on that, against the tempting misreading of
 * `model: markup_pct` as "mark cost up by this":
 *   · the column is `margin_bps`, and its sibling `floor_bps` is documented
 *     as "minimum acceptable line MARGIN" — margin is measured on sell;
 *   · cost-plus pricing is literally also called gross-margin pricing, and
 *     manufacturing/service industries quote margin where retail quotes
 *     markup (this is card manufacture, not resale);
 *   · the Forge demo compares them in one unit — "CPI 7.0% below 8% floor"
 *     — which only type-checks if the configured rate and the floor are the
 *     same measure.
 * `model: markup_pct` names the INPUT STYLE (a percentage typed into a box),
 * not the denominator.
 *
 * The floor therefore bites on OVERRIDES rather than on the template: a
 * template at 12% can never breach an 8% floor, but an operator overriding a
 * line to 7% can, and must give a reason to do it.
 *
 * Money is in micros throughout, matching rfe_response_line.cost_micros.
 */

import { asNumber, asText } from '@/lib/runtime';

export const BPS = 10_000;

/** A role margin row. `pricing_template_editor` projects its template as a
 *  BARE id — the client, floor and name live on the separate templates list,
 *  so the two must be joined on template.id before a client can be matched. */
export interface PricingRole {
  component_role?: string;
  margin_bps?: number;
  template?: { id?: string } | null;
}

export interface PricingTemplate {
  id?: string;
  name?: string;
  floor_bps?: number;
  basis?: string;
  model?: string;
  scenario?: string;
  active?: boolean;
  client?: { id?: string; name?: string } | null;
}

/** The active template for a client, or the only one when unscoped. */
export function templateFor(
  templates: PricingTemplate[],
  clientId: string | null,
): PricingTemplate | null {
  const mine = templates.filter(
    (t) => t.active !== false && (!clientId || t.client?.id === clientId),
  );
  return mine[0] ?? null;
}

export interface MarginOverrideRow {
  id?: string;
  component_role?: string;
  margin_bps?: number;
  from_bps?: number;
  reason?: string;
  scenario?: string;
  active?: boolean;
  created_at?: string;
}

/** The rate actually in force for a role: an active override beats the template. */
export function effectiveMarginBps(
  role: string,
  roles: PricingRole[],
  overrides: MarginOverrideRow[],
  templateId: string | null,
): { bps: number | null; source: 'override' | 'template' | 'none'; templateBps: number | null } {
  const templateRow = roles.find(
    (r) =>
      asText(r.component_role) === role &&
      (!templateId || r.template?.id === templateId),
  );
  const templateBps = asNumber(templateRow?.margin_bps);

  // Most recent active override wins — margin_override_supersede deactivates
  // the previous one rather than deleting it, so history survives.
  const active = overrides
    .filter((o) => asText(o.component_role) === role && o.active !== false)
    .sort((a, b) => asText(b.created_at).localeCompare(asText(a.created_at)))[0];
  const overrideBps = asNumber(active?.margin_bps);

  if (overrideBps !== null) return { bps: overrideBps, source: 'override', templateBps };
  if (templateBps !== null) return { bps: templateBps, source: 'template', templateBps };
  return { bps: null, source: 'none', templateBps: null };
}

/**
 * Sell price from cost at a target MARGIN. Null cost in, null out.
 *
 * A margin of 100% or more is unreachable — the divisor hits zero — so it is
 * rejected rather than returning Infinity and rendering as a nonsense price.
 */
export function sellFromCost(costMicros: number | null, marginBps: number | null): number | null {
  if (costMicros === null || marginBps === null) return null;
  if (marginBps >= BPS) return null;
  return Math.round(costMicros / (1 - marginBps / BPS));
}

/** Realised margin on the SELL price, in basis points. */
export function realisedMarginBps(
  costMicros: number | null,
  sellMicros: number | null,
): number | null {
  if (costMicros === null || sellMicros === null || sellMicros <= 0) return null;
  return Math.round(((sellMicros - costMicros) / sellMicros) * BPS);
}

/**
 * One MATERIAL of one line — a card body, its personalisation, its carrier, the
 * press setup. Each carries its own margin, because `pricing_template_role`
 * rates them separately: gold-foil stock and a paper carrier do not earn the
 * same margin, and blending them into one card-level rate hides that.
 */
export interface DealMaterial {
  componentRole: string;
  unitCostMicros: number | null;
  marginBps: number | null;
  marginSource: 'override' | 'template' | 'none';
  unitSellMicros: number | null;
  /** The supplier refused this material — it contributes nothing to the line. */
  declined: boolean;
}

export interface DealLine {
  orderLineId: string;
  tierId: string;
  name: string;
  qty: number;
  /** Priced material by material; the line's cost and sell are their sums. */
  materials: DealMaterial[];
  /** Sum of the chosen supplier's priced materials, in micros. */
  unitCostMicros: number | null;
  supplierId: string | null;
  supplierName: string | null;
  unitSellMicros: number | null;
  extendedCostMicros: number | null;
  extendedSellMicros: number | null;
  realisedBps: number | null;
  /**
   * The realised LINE margin sits under the template's floor.
   *
   * Judged on the line, not on each material: `floor_bps` is documented as the
   * minimum acceptable line margin, so a thin carrier margin is allowed to be
   * carried by a fat card margin — that is what a blended floor means.
   */
  belowFloor: boolean;
  /** A priced material has no rate, so the line cannot be sold. */
  missingMargin: boolean;
  /**
   * The chosen supplier left a material unanswered — the cost shown is a
   * floor, so the margin computed from it is optimistic.
   */
  pickedIsPartial: boolean;
}

export interface DealSummary {
  lines: DealLine[];
  floorBps: number | null;
  templateName: string | null;
  totalCostMicros: number;
  totalSellMicros: number;
  blendedBps: number | null;
  /** Any line under the floor blocks the proposal. */
  anyBelowFloor: boolean;
}

/** Format micros as a money string. */
export function money(micros: number | null): string {
  if (micros === null) return '—';
  return `$${(micros / 1_000_000).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Format micros as a per-unit price, three decimals. */
export function unitMoney(micros: number | null): string {
  return micros === null ? '—' : `$${(micros / 1_000_000).toFixed(3)}`;
}

/** Basis points as a percentage string. */
export function pct(bps: number | null): string {
  return bps === null ? '—' : `${(bps / 100).toFixed(1)}%`;
}

/** One card as priced by ONE supplier's quote. */
export interface SupplierDealLine {
  orderLineId: string;
  tierId: string;
  name: string;
  qty: number;
  materials: DealMaterial[];
  unitCostMicros: number | null;
  unitSellMicros: number | null;
  extendedCostMicros: number | null;
  extendedSellMicros: number | null;
  realisedBps: number | null;
  belowFloor: boolean;
  /** A material was left unanswered — this total is a floor, not a price. */
  hasUncosted: boolean;
  /**
   * A real `line_allocation` row names this supplier for this line — i.e.
   * somebody allocated it and it is recorded.
   */
  awarded: boolean;
  /**
   * The cheapest complete quote, which the deal falls back to before anyone
   * has allocated anything.
   *
   * Deliberately NOT called awarded. Being the default is not a decision, and
   * badging it as one told the operator the order was allocated while the
   * chain still read "Allocation pending" two inches above.
   */
  suggested: boolean;
}

/** Everything one supplier quoted, priced through the client's margins. */
export interface SupplierDeal {
  supplierId: string;
  supplierName: string;
  lines: SupplierDealLine[];
  totalCostMicros: number;
  totalSellMicros: number;
  /** Sell minus cost — the money made, which a percentage alone doesn't show. */
  profitMicros: number;
  blendedBps: number | null;
  belowFloor: boolean;
  /** Lines a real allocation row gives this supplier. */
  awardedLines: number;
  /** Lines where this supplier is merely the cheapest default. */
  suggestedLines: number;
  /** True when this supplier answered every material on every line. */
  complete: boolean;
}

/**
 * The deal seen supplier by supplier — every quote that came in, not just the
 * awarded one.
 *
 * The card-first view answers "what does this card cost"; this one answers
 * "what is each supplier offering, and what would I make on it" — which is the
 * question a deal review is actually for, and the only shape in which a split
 * across suppliers is visible.
 *
 * Margins are applied per material exactly as in `buildDeal`, so both views
 * always agree on a price.
 */
export function buildSupplierDeals(
  lines: Parameters<typeof buildDeal>[0],
  roles: PricingRole[],
  templates: PricingTemplate[],
  overrides: MarginOverrideRow[],
  clientId: string | null,
  picks: Record<string, string> = {},
  /**
   * orderLineId → supplier ids that actually hold an allocation row. Empty
   * until someone allocates, which is what separates "awarded" from "cheapest".
   */
  allocatedBy: Record<string, string[]> = {},
): { suppliers: SupplierDeal[]; floorBps: number | null } {
  const template = templateFor(templates, clientId);
  const floorBps = asNumber(template?.floor_bps);

  // Who the deal SUGGESTS per line — the same rule buildDeal uses, so the two
  // views never disagree. This is a default, not an award.
  const suggestedBy = new Map<string, string | null>();
  for (const l of buildDeal(lines, roles, templates, overrides, clientId, picks).lines) {
    suggestedBy.set(l.tierId, l.supplierId);
  }

  const bySupplier = new Map<string, SupplierDeal>();

  for (const line of lines) {
    for (const quote of line.quotes) {
      // A supplier who was asked but answered nothing has no column here —
      // an empty group reads as "quoted zero", which is not what happened.
      if (quote.unitCostMicros === null) continue;

      const materials: DealMaterial[] = Object.entries(quote.byRole)
        .map(([role, cost]) => {
          const declined = quote.declinedRoles.includes(role);
          const { bps, source } = effectiveMarginBps(role, roles, overrides, template?.id ?? null);
          const unitCost = declined ? null : cost;
          return {
            componentRole: role,
            unitCostMicros: unitCost,
            marginBps: bps,
            marginSource: source,
            unitSellMicros: sellFromCost(unitCost, bps),
            declined,
          };
        })
        .sort((a, b) => a.componentRole.localeCompare(b.componentRole));

      const costed = materials.filter((m) => m.unitCostMicros !== null);
      const unitCost = costed.reduce((n, m) => n + (m.unitCostMicros as number), 0);
      const missingMargin = costed.some((m) => m.marginBps === null);
      const unitSell = missingMargin
        ? null
        : costed.reduce((n, m) => n + (m.unitSellMicros ?? 0), 0);
      const extCost = unitCost * line.qty;
      const extSell = unitSell === null ? null : unitSell * line.qty;
      const realised = realisedMarginBps(unitCost, unitSell);

      const group: SupplierDeal = bySupplier.get(quote.supplierId) ?? {
        supplierId: quote.supplierId,
        supplierName: quote.supplierName,
        lines: [],
        totalCostMicros: 0,
        totalSellMicros: 0,
        profitMicros: 0,
        blendedBps: null,
        belowFloor: false,
        awardedLines: 0,
        suggestedLines: 0,
        complete: true,
      };

      group.lines.push({
        orderLineId: line.orderLineId,
        tierId: line.tierId,
        name: line.name,
        qty: line.qty,
        materials,
        unitCostMicros: unitCost,
        unitSellMicros: unitSell,
        extendedCostMicros: extCost,
        extendedSellMicros: extSell,
        realisedBps: realised,
        belowFloor: floorBps !== null && realised !== null && realised < floorBps,
        hasUncosted: Boolean(quote.hasUncosted),
        awarded: (allocatedBy[line.orderLineId] ?? []).includes(quote.supplierId),
        suggested: suggestedBy.get(line.tierId) === quote.supplierId,
      });
      group.totalCostMicros += extCost;
      group.totalSellMicros += extSell ?? 0;
      if (quote.hasUncosted) group.complete = false;
      bySupplier.set(quote.supplierId, group);
    }
  }

  const suppliers = [...bySupplier.values()].map((g) => ({
    ...g,
    profitMicros: g.totalSellMicros - g.totalCostMicros,
    blendedBps: realisedMarginBps(g.totalCostMicros, g.totalSellMicros),
    belowFloor: g.lines.some((l) => l.belowFloor),
    awardedLines: g.lines.filter((l) => l.awarded).length,
    suggestedLines: g.lines.filter((l) => l.suggested && !l.awarded).length,
  }));

  // Cheapest complete quote first — the recommendation, without hiding the
  // others. A partial quote sorts last however cheap its total looks.
  suppliers.sort((a, b) => {
    if (a.complete !== b.complete) return a.complete ? -1 : 1;
    return a.totalCostMicros - b.totalCostMicros;
  });

  return { suppliers, floorBps };
}

/**
 * One supplier's share of one demand line.
 *
 * Domain model B4 Allocation: "the award split, line to line — which supply
 * line fulfils which demand line", carrying an allocated qty. A supplier is
 * therefore given a QUANTITY, never a whole line, which is what makes a split
 * across two suppliers expressible at all.
 */
export interface AllocationRow {
  supplierId: string;
  qty: number;
}

/**
 * A material taken off the line's supplier and given to another.
 *
 * The demo's third award shape: "a winner can be one supplier, a quantity
 * split, or include material carve-outs to other suppliers". The carve-out
 * maker ships the material to the ASSEMBLER — the supplier holding the line —
 * which is why `line_allocation` carries both `supplier` and `assembler`.
 */
export interface CarveOut {
  componentRole: string;
  /** Who makes this material instead of the assembler. */
  supplierId: string;
}

export interface AllocationLineState {
  orderLineId: string;
  tierId: string;
  name: string;
  /** The demand quantity every allocation on this line must sum to. */
  qty: number;
  rows: AllocationRow[];
  carveOuts: CarveOut[];
  /** Who assembles: the largest quantity holder on the line. */
  assemblerId: string | null;
  allocated: number;
  /** Positive = still to place, negative = over-allocated. */
  remaining: number;
  balanced: boolean;
  costMicros: number;
}

export interface AllocationSummary {
  lines: AllocationLineState[];
  /**
   * Every line sums exactly to its demand quantity — the domain model's
   * constraint, and the demo's "Allocate exactly 10,000 to create the orders".
   * Nothing may be written until this holds.
   */
  allBalanced: boolean;
  totalCostMicros: number;
  splitLines: number;
  carveOutCount: number;
}

export interface AllocationCosts {
  /** A supplier's full unit cost for the card. */
  unit: (orderLineId: string, supplierId: string) => number | null;
  /** One material's unit cost from one supplier. */
  material: (orderLineId: string, supplierId: string, role: string) => number | null;
}

/**
 * What a maker is actually owed per unit once materials are carved away.
 *
 * A carve-out moves the money as well as the work: the assembler no longer
 * makes that material, so their own price for it comes off their unit cost and
 * the carve-out maker charges for it separately. The deduction uses the
 * ASSEMBLER's quote for the material rather than the carve-out maker's — what
 * is being removed is what this supplier would have charged us, which is
 * rarely the same number as what the other one charges.
 *
 * This is the figure the panel shows, the figure the line total is built from
 * AND the figure written to `line_allocation`. It lives here because it was
 * once computed in three places and the write path was the one that forgot:
 * the panel previewed a carve-out order at $7,100 while the award, the supply
 * order and the award record were all raised at $9,100 — paying the assembler
 * in full for a carrier somebody else was making.
 */
export function assemblerUnitCostMicros(
  orderLineId: string,
  supplierId: string,
  carveOuts: CarveOut[],
  costs: AllocationCosts,
): number {
  const full = costs.unit(orderLineId, supplierId) ?? 0;
  const removed = carveOuts.reduce(
    (n, c) => n + (costs.material(orderLineId, supplierId, c.componentRole) ?? 0),
    0,
  );
  // Clamped at zero: a supplier whose quoted materials exceed their own line
  // total would otherwise come out negative and credit us for making the card.
  return Math.max(0, full - removed);
}

/**
 * Roll a per-line split up into what the panel renders and the gate checks.
 *
 * A carve-out moves money as well as work: the assembler no longer makes that
 * material, so its cost comes OFF their unit price, and the carve-out maker's
 * price for it goes on for the whole line quantity. Ignoring that would leave
 * the total quietly double-counting the carried material.
 *
 * Over-allocation is reported as a negative `remaining` rather than being
 * clamped: silently capping a typo at the line quantity would hide the
 * mistake instead of showing it.
 */
export function allocationSummary(
  lines: Array<{ orderLineId: string; tierId: string; name: string; qty: number }>,
  splits: Record<string, AllocationRow[]>,
  carveOuts: Record<string, CarveOut[]>,
  costs: AllocationCosts,
): AllocationSummary {
  const out = lines.map((l) => {
    const rows = splits[l.orderLineId] ?? [];
    const carved = carveOuts[l.orderLineId] ?? [];
    const allocated = rows.reduce((n, r) => n + (r.qty || 0), 0);

    // Whoever holds the most units assembles, and so receives the carve-outs.
    const assemblerId =
      rows.length === 0
        ? null
        : rows.reduce((best, r) => ((r.qty || 0) > (best.qty || 0) ? r : best), rows[0])
            .supplierId || null;

    const makerCost = rows.reduce(
      (n, r) =>
        n + assemblerUnitCostMicros(l.orderLineId, r.supplierId, carved, costs) * (r.qty || 0),
      0,
    );

    const carvedCost = carved.reduce(
      (n, c) => n + (costs.material(l.orderLineId, c.supplierId, c.componentRole) ?? 0) * l.qty,
      0,
    );

    return {
      orderLineId: l.orderLineId,
      tierId: l.tierId,
      name: l.name,
      qty: l.qty,
      rows,
      carveOuts: carved,
      assemblerId,
      allocated,
      remaining: l.qty - allocated,
      balanced: allocated === l.qty && l.qty > 0,
      costMicros: makerCost + carvedCost,
    };
  });

  return {
    lines: out,
    // An order with no lines is not "balanced" — there is nothing to award.
    allBalanced: out.length > 0 && out.every((l) => l.balanced),
    totalCostMicros: out.reduce((n, l) => n + l.costMicros, 0),
    splitLines: out.filter((l) => l.rows.length > 1).length,
    carveOutCount: out.reduce((n, l) => n + l.carveOuts.length, 0),
  };
}

/** A recommendation for the top of the deal table. */
export interface DealAdvice {
  tone: 'info' | 'warn';
  headline: string;
  /** The split opportunity, when awarding card-by-card beats any one supplier. */
  detail: string | null;
  /** Anything that should stop the operator, e.g. a floor breach. */
  warning: string | null;
}

/**
 * Which supplier to take, and what it would save.
 *
 * Only COMPLETE quotes are ever recommended: a supplier who skipped materials
 * has a total that is a floor, and recommending it would advise awarding a
 * card at a price that does not cover it.
 *
 * Also reports the SPLIT — the cheapest supplier per card rather than one for
 * the whole order — because that saving is invisible in a supplier-total
 * comparison and is exactly the decision this table exists to support.
 */
export function recommendSuppliers(
  suppliers: SupplierDeal[],
  floorBps: number | null,
  awardedCostMicros: number | null,
): DealAdvice | null {
  if (suppliers.length === 0) return null;

  const complete = suppliers.filter((s) => s.complete);
  const partialCount = suppliers.length - complete.length;

  if (complete.length === 0) {
    return {
      tone: 'warn',
      headline: `No supplier has priced every material yet — ${partialCount} quote${
        partialCount === 1 ? ' is' : 's are'
      } partial.`,
      detail: null,
      warning: 'A partial quote cannot be compared on total, so none is recommended.',
    };
  }

  // Already sorted cheapest-complete-first by buildSupplierDeals.
  const best = complete[0];
  const runnerUp = complete[1];

  let headline = `${best.supplierName} is the lowest complete quote at ${money(
    best.totalCostMicros,
  )}`;
  if (runnerUp) {
    const gap = runnerUp.totalCostMicros - best.totalCostMicros;
    const pctUnder = runnerUp.totalCostMicros > 0 ? (gap / runnerUp.totalCostMicros) * 100 : 0;
    headline += ` — ${money(gap)} (${pctUnder.toFixed(0)}%) under ${runnerUp.supplierName}`;
  }
  headline += '.';

  // Cheapest complete quote for each card, which may span suppliers.
  const cheapestByCard = new Map<string, { supplierName: string; cost: number }>();
  for (const s of complete) {
    for (const l of s.lines) {
      if (l.extendedCostMicros === null) continue;
      const held = cheapestByCard.get(l.tierId);
      if (!held || l.extendedCostMicros < held.cost) {
        cheapestByCard.set(l.tierId, { supplierName: s.supplierName, cost: l.extendedCostMicros });
      }
    }
  }
  const splitTotal = [...cheapestByCard.values()].reduce((n, c) => n + c.cost, 0);
  const splitNames = new Set([...cheapestByCard.values()].map((c) => c.supplierName));
  const splitSaving = best.totalCostMicros - splitTotal;

  const detail =
    splitSaving > 0 && splitNames.size > 1
      ? `Splitting card by card across ${splitNames.size} suppliers would cost ${money(
          splitTotal,
        )} — a further ${money(splitSaving)} saved.`
      : null;

  let warning: string | null = null;
  if (floorBps !== null && best.blendedBps !== null && best.blendedBps < floorBps) {
    warning = `Even the lowest quote lands at ${pct(best.blendedBps)}, under the ${pct(
      floorBps,
    )} floor.`;
  } else if (awardedCostMicros !== null && awardedCostMicros > best.totalCostMicros) {
    warning = `Currently awarded ${money(awardedCostMicros)} — ${money(
      awardedCostMicros - best.totalCostMicros,
    )} above the recommendation.`;
  } else if (partialCount > 0) {
    warning = `${partialCount} partial quote${
      partialCount === 1 ? '' : 's'
    } excluded from the comparison.`;
  }

  return { tone: warning ? 'warn' : 'info', headline, detail, warning };
}

/** One committed quantity share, as `line_allocation` records it. */
export interface CommittedShare {
  supplierId: string;
  qty: number;
}

/**
 * Blend the per-material costs of the suppliers a line was actually awarded to.
 *
 * Once a line is split, no single quote is its cost. Pricing it off one of them
 * — which is what happens when the picked quote is used after an award — quotes
 * the client against a rate that only applies to part of the order. GC-1001 was
 * awarded 5,000 at $0.840 and 3,000 at $0.950, and the proposal priced all
 * 8,000 at $0.840: a $330 hole, and a margin reported as 13.9% when it was 9.7%.
 *
 * Blending is per MATERIAL and weighted by quantity, not a single average of
 * the line totals, because each material carries its own margin — averaging the
 * totals first would apply one rate to a basket of materials priced at several.
 *
 * A role goes null when ANY awarded supplier has no price for it. That is the
 * honest answer: part of the quantity has an unknown cost, so the line's cost
 * is unknown. Silently blending only the suppliers who did answer would
 * under-state it by exactly the share that did not.
 */
export function blendShares(
  shares: CommittedShare[],
  quotes: Array<{
    supplierId: string;
    byRole: Record<string, number | null>;
    declinedRoles: string[];
  }>,
): { byRole: Record<string, number | null>; declinedRoles: string[] } | null {
  const priced = shares
    .map((s) => ({ share: s, quote: quotes.find((q) => q.supplierId === s.supplierId) }))
    .filter((p) => p.quote !== undefined && p.share.qty > 0) as Array<{
    share: CommittedShare;
    quote: (typeof quotes)[number];
  }>;
  if (priced.length === 0) return null;

  const totalQty = priced.reduce((n, p) => n + p.share.qty, 0);
  if (totalQty <= 0) return null;

  const roles = new Set<string>();
  for (const p of priced) for (const r of Object.keys(p.quote.byRole)) roles.add(r);

  const byRole: Record<string, number | null> = {};
  const declined = new Set<string>();
  for (const role of roles) {
    let weighted = 0;
    let known = true;
    for (const p of priced) {
      if (p.quote.declinedRoles.includes(role)) declined.add(role);
      const cost = p.quote.byRole[role];
      if (cost === null || cost === undefined) {
        known = false;
        break;
      }
      weighted += cost * p.share.qty;
    }
    byRole[role] = known ? Math.round(weighted / totalQty) : null;
  }
  return { byRole, declinedRoles: [...declined] };
}

/**
 * Build the Deal Review table.
 *
 * `picks` maps an order line to the supplier chosen for it. Without a pick the
 * line falls back to its cheapest complete quote, so the review has a number
 * to show before anyone has allocated anything.
 *
 * `committed` is the award once it exists. It OUTRANKS both the pick and the
 * fallback: after an award the line's cost is what was actually bought, not
 * what somebody quoted. See `blendShares`.
 */
export function buildDeal(
  lines: Array<{
    orderLineId: string;
    tierId: string;
    name: string;
    qty: number;
    quotes: Array<{
      supplierId: string;
      supplierName: string;
      unitCostMicros: number | null;
      /** Per-material unit cost in micros. Null = unanswered. */
      byRole: Record<string, number | null>;
      declinedRoles: string[];
      /**
       * A material was left unanswered, so `unitCostMicros` is a FLOOR rather
       * than this supplier's price for the card.
       */
      hasUncosted?: boolean;
    }>;
  }>,
  roles: PricingRole[],
  templates: PricingTemplate[],
  overrides: MarginOverrideRow[],
  clientId: string | null,
  picks: Record<string, string> = {},
  committed: Record<string, CommittedShare[]> = {},
): DealSummary {
  const template = templateFor(templates, clientId);
  const floorBps = asNumber(template?.floor_bps);
  const templateName = template?.name ?? null;

  const out: DealLine[] = lines.map((l) => {
    const priced = l.quotes.filter((q) => q.unitCostMicros !== null);
    /**
     * Only a COMPLETE quote may win the automatic pick.
     *
     * A supplier who priced one material and skipped three has a total that is
     * a floor, not an offer — and being a fraction of a real quote, it would
     * always look cheapest and always be auto-picked, quoting the client for a
     * fraction of the card. An explicit pick still honours a partial quote:
     * awarding one is the operator's call to make knowingly, not a default to
     * fall into.
     */
    const complete = priced.filter((q) => !q.hasUncosted);
    const picked =
      priced.find((q) => q.supplierId === picks[l.orderLineId]) ??
      // Cheapest wins by default — the review is about margin, not about
      // making the operator choose a supplier before they can see one.
      complete.reduce<(typeof complete)[number] | undefined>(
        (best, q) =>
          best === undefined || (q.unitCostMicros as number) < (best.unitCostMicros as number)
            ? q
            : best,
        undefined,
      );

    /**
     * The award, once there is one, replaces the picked quote as the source of
     * cost. Everything downstream — the proposal, the client price, the margin
     * — reads these materials, so this is the single point where "what we were
     * quoted" becomes "what we actually bought".
     */
    const shares = committed[l.orderLineId] ?? [];
    const blended = shares.length > 0 ? blendShares(shares, l.quotes) : null;
    const awardedNames = blended
      ? shares
          .map((s) => l.quotes.find((q) => q.supplierId === s.supplierId)?.supplierName)
          .filter((n): n is string => Boolean(n))
      : [];
    const costSource = blended ?? picked ?? null;

    // Price each material at its OWN rate, then sum. Summing the costs first
    // and applying one rate would silently average the margins.
    const materials: DealMaterial[] = Object.entries(costSource?.byRole ?? {})
      .map(([role, cost]) => {
        const declined = costSource?.declinedRoles.includes(role) ?? false;
        const { bps, source } = effectiveMarginBps(role, roles, overrides, template?.id ?? null);
        const unitCost = declined ? null : cost;
        return {
          componentRole: role,
          unitCostMicros: unitCost,
          marginBps: bps,
          marginSource: source,
          unitSellMicros: sellFromCost(unitCost, bps),
          declined,
        };
      })
      .sort((a, b) => a.componentRole.localeCompare(b.componentRole));

    const costed = materials.filter((m) => m.unitCostMicros !== null);
    const unitCost = costed.length > 0 ? costed.reduce((n, m) => n + (m.unitCostMicros as number), 0) : null;
    // A material priced but unrated cannot be sold, so the LINE has no sell
    // price — falling back to the sum of the rated ones would quote the client
    // for less than the order actually contains.
    const missingMargin = costed.some((m) => m.marginBps === null);
    const unitSell =
      missingMargin || costed.length === 0
        ? null
        : costed.reduce((n, m) => n + (m.unitSellMicros ?? 0), 0);

    const extCost = unitCost === null ? null : unitCost * l.qty;
    const extSell = unitSell === null ? null : unitSell * l.qty;
    const realised = realisedMarginBps(unitCost, unitSell);

    return {
      orderLineId: l.orderLineId,
      tierId: l.tierId,
      name: l.name,
      qty: l.qty,
      materials,
      unitCostMicros: unitCost,
      // A split has no single supplier id — naming one of them would let a
      // later read treat the whole line as that supplier's.
      supplierId: blended ? (awardedNames.length === 1 ? shares[0].supplierId : null) : (picked?.supplierId ?? null),
      supplierName: blended ? awardedNames.join(' · ') : (picked?.supplierName ?? null),
      unitSellMicros: unitSell,
      extendedCostMicros: extCost,
      extendedSellMicros: extSell,
      realisedBps: realised,
      belowFloor: floorBps !== null && realised !== null && realised < floorBps,
      missingMargin,
      pickedIsPartial: Boolean(picked?.hasUncosted),
    };
  });

  const totalCost = out.reduce((n, l) => n + (l.extendedCostMicros ?? 0), 0);
  const totalSell = out.reduce((n, l) => n + (l.extendedSellMicros ?? 0), 0);

  return {
    lines: out,
    floorBps,
    templateName,
    totalCostMicros: totalCost,
    totalSellMicros: totalSell,
    blendedBps: realisedMarginBps(totalCost, totalSell),
    anyBelowFloor: out.some((l) => l.belowFloor),
  };
}

/** Every material quoted across the order, in a stable order — the margin
 *  editor's rows. Margins are order-wide per material: `margin_override`
 *  carries a component_role and an order, and no line. */
export function dealMaterialRoles(deal: DealSummary): string[] {
  const seen = new Set<string>();
  for (const l of deal.lines) for (const m of l.materials) seen.add(m.componentRole);
  return [...seen].sort();
}

/** The rate in force for a material, read off whichever line quotes it. */
export function marginForRole(
  deal: DealSummary,
  role: string,
): { bps: number | null; source: 'override' | 'template' | 'none' } {
  for (const l of deal.lines) {
    const m = l.materials.find((x) => x.componentRole === role);
    if (m) return { bps: m.marginBps, source: m.marginSource };
  }
  return { bps: null, source: 'none' };
}

/** Chain step state, driven by what actually exists rather than a flag column. */
export type ChainState = 'current' | 'pending' | 'approved';

/**
 * Badge treatment per step state.
 *
 * Lives here rather than beside `ChainBlock` because a component file may only
 * export components — the react-refresh rule the linter enforces.
 */
/**
 * What each state is CALLED on screen.
 *
 * Separate from the state name because `approved` is the internal fact — a
 * verdict row exists — while the badge has to read sensibly on every step.
 * "Approved" is right for Deal Review and meaningless on Ship or Produce;
 * "Completed" is true of all of them.
 */
export const STATE_LABEL: Record<ChainState, string> = {
  pending: 'Pending',
  current: 'Current',
  approved: 'Completed',
};

export const STATE_CLASS: Record<ChainState, string> = {
  pending: 'bg-muted text-muted-foreground',
  current: 'bg-teal-50 text-teal-700',
  approved: 'bg-success-50 text-success-500',
};

export function chainStates(input: {
  deal: DealSummary;
  allocatedQty: Record<string, number>;
  awarded: boolean;
  /**
   * True once a `deal_review` review_request has been approved — i.e. the
   * operator pressed Build proposal.
   *
   * Deliberately NOT derived from "everything is priced and above the floor".
   * Prices being present says the data is there; it does not say a human
   * looked at the margins and accepted them, and that judgement is the whole
   * point of a deal review. Deriving it would let an order walk to Proposal
   * with nobody having reviewed anything.
   */
  dealReviewed: boolean;
}): { dealReview: ChainState; allocation: ChainState; proposal: ChainState } {
  const priced = input.deal.lines.some((l) => l.unitSellMicros !== null);
  // Every line fully allocated — the sum of allocations equals the line qty,
  // which is the domain model's own constraint on Allocation.
  const fullyAllocated =
    input.deal.lines.length > 0 &&
    input.deal.lines.every((l) => (input.allocatedQty[l.orderLineId] ?? 0) >= l.qty);

  if (input.awarded) {
    return { dealReview: 'approved', allocation: 'approved', proposal: 'approved' };
  }
  if (input.dealReviewed && fullyAllocated) {
    return { dealReview: 'approved', allocation: 'approved', proposal: 'current' };
  }
  if (input.dealReviewed) {
    return { dealReview: 'approved', allocation: 'current', proposal: 'pending' };
  }
  // Priced and above the floor only makes the review POSSIBLE, never done.
  void priced;
  return { dealReview: 'current', allocation: 'pending', proposal: 'pending' };
}
