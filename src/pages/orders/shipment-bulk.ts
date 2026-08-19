/**
 * Bulk destination planning.
 *
 * Today a destination is added one at a time: pick the supply order, type the
 * place, type the quantity, press Add. For an order split across four
 * suppliers going to six DCs that is twenty-four passes through the same form,
 * which is why the spreadsheet exists in the first place (US-807).
 *
 * The shape of the fix is "select the targets, say the thing that is common,
 * adjust the quantities that are not". So this module is deliberately two
 * halves:
 *
 *   - a **spread** that proposes quantities across the selected targets, and
 *   - a **validation + payload build** that refuses to create anything until
 *     the numbers reconcile.
 *
 * The refusal matters more than the convenience. A destination is a promise to
 * a client; over-planning a supply order by 500 units is a promise nobody can
 * keep, and it is far easier to make that mistake twenty-four rows at a time
 * than one at a time. So bulk entry is held to a STRICTER check than single
 * entry, not a looser one.
 *
 * Pure functions only — the vitest environment here is `node`.
 */

import { asText } from '@/lib/runtime';

/** A supply order that can still take destinations. */
export interface BulkTarget {
  supplyOrderId: string;
  /** Shown in errors — `GC-1019-PO1` reads better than a uuid. */
  supplyOrderCode: string;
  /** Units on this supply order not yet covered by a destination. */
  unplanned: number;
}

/** The fields the operator sets once and applies to every selected row. */
export interface BulkCommon {
  destination: string;
  shipmentType: string;
  /** ISO date. Optional — the plan may carry its own target instead. */
  plannedDate?: string | null;
}

/** One selected target and the quantity to plan against it. */
export interface BulkRow {
  supplyOrderId: string;
  qty: number;
}

/** What `shipment_record_create` needs, one call per entry. */
export interface ShipmentRecordPayload {
  supplyOrderId: string;
  shipmentType: string;
  destination: string;
  qty: number;
  plannedDate: string | null;
}

export interface BulkPlan {
  /** Empty whenever `errors` is non-empty — never a partial create. */
  payloads: ShipmentRecordPayload[];
  errors: string[];
}

/**
 * Spread a total across buckets, biggest remainders first.
 *
 * 10 across 3 gives 4/3/3, not 3/3/3-and-lose-one. Card quantities are whole
 * units and the sum has to land exactly on the total, so the remainder is
 * handed out one unit at a time from the top rather than rounded away.
 *
 * A non-positive or non-finite total yields all zeros rather than throwing —
 * the caller renders this live as someone types, and a half-typed number must
 * not blow up the panel.
 */
export function splitEvenly(total: number, buckets: number): number[] {
  if (!Number.isFinite(buckets) || buckets <= 0) return [];
  const size = Math.floor(buckets);
  if (!Number.isFinite(total) || total <= 0) return new Array(size).fill(0);

  const whole = Math.floor(total);
  const base = Math.floor(whole / size);
  let remainder = whole - base * size;

  return Array.from({ length: size }, () => {
    const extra = remainder > 0 ? 1 : 0;
    if (remainder > 0) remainder -= 1;
    return base + extra;
  });
}

/**
 * Cap each row at what its supply order can still take.
 *
 * Used for the "fill the remainder" affordance: rather than making someone
 * work out that PO1 has 1,200 left and PO2 has 800, propose exactly that.
 */
export function fillRemaining(targets: readonly BulkTarget[]): BulkRow[] {
  return targets
    .filter((t) => t.unplanned > 0)
    .map((t) => ({ supplyOrderId: t.supplyOrderId, qty: t.unplanned }));
}

/** Rows the operator actually wants — a zero is a deselect, not an error. */
export function activeRows(rows: readonly BulkRow[]): BulkRow[] {
  return rows.filter((r) => Number.isFinite(r.qty) && r.qty > 0);
}

/** Total units this bulk entry would plan. */
export function bulkTotal(rows: readonly BulkRow[]): number {
  return activeRows(rows).reduce((sum, r) => sum + Math.floor(r.qty), 0);
}

/**
 * Build the create payloads, or explain why not.
 *
 * Every error names the supply order it belongs to. A bare "quantity too high"
 * on a twenty-four row form is a puzzle; "GC-1019-PO2: 900 exceeds the 400
 * still unplanned" is an instruction.
 *
 * Quantities are floored rather than rejected on a decimal, because a stray
 * `.0` from a paste is not worth blocking on — but a quantity that is NaN,
 * negative or over the cap is refused outright.
 */
export function buildBulkPlan(
  common: BulkCommon,
  rows: readonly BulkRow[],
  targets: readonly BulkTarget[],
): BulkPlan {
  const errors: string[] = [];

  const destination = asText(common.destination).trim();
  if (!destination) errors.push('Give the destination a name.');

  const shipmentType = asText(common.shipmentType).trim();
  if (!shipmentType) errors.push('Pick a shipment type.');

  const byId = new Map(targets.map((t) => [t.supplyOrderId, t]));
  const wanted = activeRows(rows);

  if (wanted.length === 0) {
    errors.push('Select at least one supply order and give it a quantity.');
  }

  // Two rows against one supply order would each pass their own cap while
  // together breaching it, so they are summed before the check.
  const perOrder = new Map<string, number>();
  for (const row of wanted) {
    perOrder.set(row.supplyOrderId, (perOrder.get(row.supplyOrderId) ?? 0) + Math.floor(row.qty));
  }

  for (const [supplyOrderId, qty] of perOrder) {
    const target = byId.get(supplyOrderId);
    if (!target) {
      errors.push('One of the selected supply orders is no longer on this order.');
      continue;
    }
    if (qty > target.unplanned) {
      errors.push(
        `${target.supplyOrderCode}: ${qty.toLocaleString()} exceeds the ${target.unplanned.toLocaleString()} still unplanned.`,
      );
    }
  }

  if (errors.length > 0) return { payloads: [], errors };

  return {
    payloads: wanted.map((row) => ({
      supplyOrderId: row.supplyOrderId,
      shipmentType,
      destination,
      qty: Math.floor(row.qty),
      plannedDate: common.plannedDate ? asText(common.plannedDate).slice(0, 10) : null,
    })),
    errors: [],
  };
}

/**
 * One-line summary for the button.
 *
 * Reads as "Create 4 destinations · 6,000 units" so the operator confirms the
 * shape of what they are about to do without re-reading the grid.
 */
export function bulkSummary(rows: readonly BulkRow[]): string {
  const count = activeRows(rows).length;
  const units = bulkTotal(rows);
  if (count === 0) return 'Nothing selected';
  const plural = count === 1 ? 'destination' : 'destinations';
  return `Create ${count} ${plural} · ${units.toLocaleString()} units`;
}
