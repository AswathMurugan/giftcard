/**
 * A supplier's own scorecard.
 *
 * Everything here is computed from records the supplier already has on their
 * other screens — their POs, their destinations, their extras. Nothing is
 * benchmarked against another supplier, because a supplier's standing relative
 * to their competitors is Fiserv's information, not theirs.
 *
 * Pure functions, no DOM — the vitest environment here is `node`.
 */
import type { PoRow } from '@/pages/orders-po/po-helpers';
import type { ShipmentRow } from '@/pages/shipments/shipment-helpers';
import type { InvoiceRow } from '@/pages/invoices/invoice-helpers';

export interface Scorecard {
  /** POs on the book right now, still needing something. */
  openOrders: number;
  /** POs seen through to despatch. */
  completedOrders: number;
  totalOrders: number;
  /** Units across every destination planned for this supplier. */
  plannedUnits: number;
  shippedUnits: number;
  /** Destinations shipped in full, as a percentage of those planned. */
  fulfilmentPct: number;
  /** Destinations whose planned date has passed with nothing despatched. */
  lateDestinations: number;
  billableExtras: number;
}

/**
 * Whether a destination is late.
 *
 * `today` is injected rather than read from the clock so the calculation is
 * testable and so every row on one render is judged against the same instant.
 * A destination with no planned date cannot be late — an absent commitment is
 * not a missed one.
 */
export function isLate(row: ShipmentRow, today: string): boolean {
  if (row.state === 'shipped') return false;
  if (!row.plannedDate) return false;
  return row.plannedDate.slice(0, 10) < today.slice(0, 10);
}

export function buildScorecard(
  pos: PoRow[],
  shipments: ShipmentRow[],
  invoices: InvoiceRow[],
  today: string,
): Scorecard {
  const completedOrders = pos.filter((p) => p.done).length;
  const plannedUnits = shipments.reduce((s, r) => s + r.plannedQty, 0);
  const shippedUnits = shipments.reduce((s, r) => s + r.shippedQty, 0);
  const shippedDests = shipments.filter((r) => r.state === 'shipped').length;

  return {
    // "Open" is what still needs the SUPPLIER, not merely what is unfinished:
    // a PO parked on Fiserv's side is not work sitting in their queue.
    openOrders: pos.filter((p) => p.next !== null).length,
    completedOrders,
    totalOrders: pos.length,
    plannedUnits,
    shippedUnits,
    // Guard the divide: a supplier with nothing planned is at 0%, not NaN%.
    fulfilmentPct:
      shipments.length === 0 ? 0 : Math.round((shippedDests / shipments.length) * 100),
    lateDestinations: shipments.filter((r) => isLate(r, today)).length,
    billableExtras: invoices
      .filter((i) => i.status === 'billable')
      .reduce((s, i) => s + i.amount, 0),
  };
}
