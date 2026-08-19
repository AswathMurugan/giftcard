/**
 * The shipments CSV (US-809).
 *
 * A destination is a PLAN and a shipment is what actually left the dock, so
 * the export flattens the two into one row per destination with the actuals
 * folded in. That shape is chosen for the reader: the question someone opens
 * this file to answer is "what is still owed", and that is a comparison
 * between two numbers that must therefore sit on the same line.
 *
 * Two deliberate choices about the numbers:
 *
 *  - **Money is a plain number, not a formatted string.** `$240.00` sorts and
 *    sums as text; `240.00` is a number the moment it lands in a cell. The
 *    column header carries the currency instead.
 *  - **Outstanding is computed, not left to the reader.** It is the whole
 *    point of the file, and a spreadsheet formula written by hand is a formula
 *    that can be wrong.
 *
 * Pure functions — the vitest environment here is `node`.
 */

import { asNumber, asText } from '@/lib/runtime';
import type { CsvColumn } from '@/pages/_shared/csv';
import type { ShipmentRecordRow, ShipmentRow } from './fulfilment-helpers';

/** One destination, with whatever has shipped against it. */
export interface ShipmentExportRow {
  supplyOrder: string;
  destination: string;
  shipmentType: string;
  plannedQty: number;
  plannedDate: string;
  status: string;
  shippedQty: number;
  outstanding: number;
  carrier: string;
  tracking: string;
  shipDate: string;
  freightCost: number | null;
}

/** Micros to a plain decimal. Returns null so an unrecorded cost stays blank. */
function micros(value: unknown): number | null {
  const n = asNumber(value);
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  return Math.round(n) / 1_000_000;
}

/**
 * Flatten destinations plus their despatches into export rows.
 *
 * A destination with several despatches (a partial, then the remainder) emits
 * ONE row with the quantities summed and the carrier/tracking of the most
 * recent — repeating the destination would double-count the planned quantity
 * for anyone who sums the column, which is the most likely thing a reader does
 * with this file.
 */
export function shipmentExportRows(
  records: readonly ShipmentRecordRow[],
  shipments: readonly ShipmentRow[],
): ShipmentExportRow[] {
  return records.map((record) => {
    const mine = shipments.filter((s) => s.shipment_record?.id === record.id);

    const plannedQty = asNumber(record.qty) ?? 0;
    const shippedQty = mine.reduce((n, s) => n + (asNumber(s.shipped_qty) ?? 0), 0);

    // Latest despatch wins for the carrier fields. Sorted rather than assumed:
    // the API returns these in no guaranteed order.
    const latest = [...mine].sort((a, b) =>
      asText(a.ship_date).localeCompare(asText(b.ship_date)),
    ).pop();

    const costs = mine
      .map((s) => micros(s.shipping_cost_micros))
      .filter((n): n is number => n !== null);

    return {
      supplyOrder: asText(record.supply_order?.order_code),
      destination: asText(record.destination),
      shipmentType: asText(record.shipment_type),
      plannedQty,
      plannedDate: asText(record.planned_date).slice(0, 10),
      status: asText(record.status),
      shippedQty,
      outstanding: Math.max(0, plannedQty - shippedQty),
      carrier: asText(latest?.carrier),
      tracking: asText(latest?.tracking_no),
      shipDate: asText(latest?.ship_date).slice(0, 10),
      freightCost: costs.length > 0 ? costs.reduce((a, b) => a + b, 0) : null,
    };
  });
}

/** Column order for the download. Stable — people build habits on it. */
export const SHIPMENT_CSV_COLUMNS: CsvColumn<ShipmentExportRow>[] = [
  { header: 'Supply order', value: (r) => r.supplyOrder },
  { header: 'Destination', value: (r) => r.destination },
  { header: 'Type', value: (r) => r.shipmentType },
  { header: 'Planned qty', value: (r) => r.plannedQty },
  { header: 'Planned date', value: (r) => r.plannedDate },
  { header: 'Status', value: (r) => r.status },
  { header: 'Shipped qty', value: (r) => r.shippedQty },
  { header: 'Outstanding', value: (r) => r.outstanding },
  { header: 'Carrier', value: (r) => r.carrier },
  { header: 'Tracking', value: (r) => r.tracking },
  { header: 'Ship date', value: (r) => r.shipDate },
  { header: 'Freight cost (USD)', value: (r) => r.freightCost },
];

/**
 * Totals for the summary line above the table (US-802).
 *
 * `unshipped` and `partial` are counted separately because they mean different
 * things operationally: nothing has left the dock at all, versus something has
 * and the rest is late. Lumping them into "incomplete" hides which one you are
 * looking at.
 */
export interface ShipmentGaps {
  destinations: number;
  unshipped: number;
  partial: number;
  missingTracking: number;
  missingCost: number;
  unitsOutstanding: number;
}

export function shipmentGaps(rows: readonly ShipmentExportRow[]): ShipmentGaps {
  let unshipped = 0;
  let partial = 0;
  let missingTracking = 0;
  let missingCost = 0;
  let unitsOutstanding = 0;

  for (const r of rows) {
    if (r.shippedQty <= 0) unshipped += 1;
    else if (r.shippedQty < r.plannedQty) partial += 1;

    // Only meaningful once something has actually shipped — an unshipped
    // destination is not "missing" a tracking number, it simply has none yet.
    if (r.shippedQty > 0 && !r.tracking) missingTracking += 1;
    if (r.shippedQty > 0 && r.freightCost === null) missingCost += 1;

    unitsOutstanding += r.outstanding;
  }

  return {
    destinations: rows.length,
    unshipped,
    partial,
    missingTracking,
    missingCost,
    unitsOutstanding,
  };
}
