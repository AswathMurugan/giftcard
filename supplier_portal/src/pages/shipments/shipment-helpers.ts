/**
 * Planned versus actually despatched, across a supplier's whole book.
 *
 * A destination is a PLAN — "5,000 to Ontario" — and a shipment is what left
 * the dock against it. The two are separate records, so the interesting number
 * is the gap: a destination with a shipment for less than its planned quantity
 * is a partial, and one with none is still owed.
 *
 * Pure functions, no DOM — the vitest environment here is `node`.
 */
import { asText, asNumber } from '@/lib/runtime';
import type { SupplierShipmentListRow } from '@/types/saved-queries.generated';

export interface ShipmentRow {
  id: string;
  orderCode: string;
  destination: string;
  plannedQty: number;
  shippedQty: number;
  plannedDate: string | null;
  shipDate: string | null;
  carrier: string | null;
  tracking: string | null;
  /** planned · partial · shipped — derived from quantities, not a column. */
  state: 'planned' | 'partial' | 'shipped';
  label: string;
}

/**
 * Which of the three states a destination is in.
 *
 * Derived from the quantities rather than read off `shipment_record.status`,
 * because that column is written when the plan is made and is not updated as
 * despatches land — a fully shipped destination can still say "planned".
 */
export function shipmentState(planned: number, shipped: number): ShipmentRow['state'] {
  if (shipped <= 0) return 'planned';
  // A supplier who over-ships has still met the destination in full; treating
  // that as "partial" would leave a line looking outstanding forever.
  if (shipped >= planned) return 'shipped';
  return 'partial';
}

const LABELS: Record<ShipmentRow['state'], string> = {
  planned: 'Awaiting despatch',
  partial: 'Part shipped',
  shipped: 'Shipped',
};

export function decorateShipments(packet: SupplierShipmentListRow | null): ShipmentRow[] {
  // One despatch per destination is the norm; when there are several, sum them
  // rather than letting the last one win and under-report what was sent.
  const shippedByRecord = new Map<string, number>();
  const latestByRecord = new Map<
    string,
    NonNullable<SupplierShipmentListRow['actuals']>[number]
  >();

  for (const a of packet?.actuals ?? []) {
    const rec = a.shipment_record?.id;
    if (!rec) continue;
    shippedByRecord.set(rec, (shippedByRecord.get(rec) ?? 0) + (asNumber(a.shipped_qty) ?? 0));
    const held = latestByRecord.get(rec);
    if (!held || (a.ship_date ?? '') >= (held.ship_date ?? '')) latestByRecord.set(rec, a);
  }

  return (packet?.records ?? [])
    .filter((r) => r.id)
    .map((r) => {
      const id = r.id as string;
      const plannedQty = asNumber(r.qty) ?? 0;
      const shippedQty = shippedByRecord.get(id) ?? 0;
      const latest = latestByRecord.get(id);
      const state = shipmentState(plannedQty, shippedQty);
      return {
        id,
        orderCode: asText(r.supply_order?.order_code) || '—',
        destination: asText(r.destination) || 'Destination not named',
        plannedQty,
        shippedQty,
        plannedDate: r.planned_date ?? null,
        shipDate: latest?.ship_date ?? null,
        carrier: latest?.carrier ?? null,
        tracking: latest?.tracking_no ?? null,
        state,
        label: LABELS[state],
      } satisfies ShipmentRow;
    })
    .sort((a, b) => {
      // Outstanding work first — a shipped line is a receipt, not a task.
      const rank = { planned: 0, partial: 1, shipped: 2 } as const;
      if (rank[a.state] !== rank[b.state]) return rank[a.state] - rank[b.state];
      return (a.plannedDate ?? '').localeCompare(b.plannedDate ?? '');
    });
}

/** Destinations still owing a despatch. */
export function outstandingCount(rows: ShipmentRow[]): number {
  return rows.filter((r) => r.state !== 'shipped').length;
}
