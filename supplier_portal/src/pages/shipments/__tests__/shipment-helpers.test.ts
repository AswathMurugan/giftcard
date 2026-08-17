/**
 * Planned versus shipped. The state is derived from quantities on purpose —
 * `shipment_record.status` is stamped when the plan is made and never updated,
 * so trusting it leaves shipped destinations reading "planned" forever.
 */
import { describe, it, expect } from 'vitest';
import {
  decorateShipments,
  outstandingCount,
  shipmentState,
} from '@/pages/shipments/shipment-helpers';
import type { SupplierShipmentListRow } from '@/types/saved-queries.generated';

describe('shipment-helpers', { tags: ['shipments', 'logic'] }, () => {
  describe('shipmentState', { tags: ['important'] }, () => {
    it('is planned with nothing despatched', () => {
      expect(shipmentState(5000, 0)).toBe('planned');
    });

    it('is partial part-way', () => {
      expect(shipmentState(5000, 3000)).toBe('partial');
    });

    it('is shipped at or beyond the planned quantity', () => {
      expect(shipmentState(5000, 5000)).toBe('shipped');
      // Over-shipping still meets the destination — it must not read partial.
      expect(shipmentState(5000, 5200)).toBe('shipped');
    });

    it('treats a zero-quantity plan as met once anything ships', { tags: ['edge-case'] }, () => {
      expect(shipmentState(0, 0)).toBe('planned');
      expect(shipmentState(0, 10)).toBe('shipped');
    });
  });

  describe('decorateShipments', { tags: ['smoke'] }, () => {
    it('returns [] for null and empty packets', { tags: ['edge-case'] }, () => {
      expect(decorateShipments(null)).toEqual([]);
      expect(decorateShipments({} as SupplierShipmentListRow)).toEqual([]);
      expect(decorateShipments({ records: [], actuals: [] })).toEqual([]);
    });

    it('sums several despatches against one destination', { tags: ['important'] }, () => {
      const packet = {
        records: [
          { id: 'r1', destination: 'Ontario', qty: 5000, supply_order: { order_code: 'PO1' } },
        ],
        actuals: [
          { id: 's1', shipped_qty: 3000, ship_date: '2026-01-01', shipment_record: { id: 'r1' } },
          { id: 's2', shipped_qty: 2000, ship_date: '2026-01-05', shipment_record: { id: 'r1' } },
        ],
      } as unknown as SupplierShipmentListRow;
      const [row] = decorateShipments(packet);
      // Last-write-wins would report 2,000 and leave the line looking short.
      expect(row.shippedQty).toBe(5000);
      expect(row.state).toBe('shipped');
      // The carrier shown is the most recent despatch.
      expect(row.shipDate).toBe('2026-01-05');
    });

    it('ignores despatches for a destination it does not hold', { tags: ['edge-case'] }, () => {
      const packet = {
        records: [{ id: 'r1', destination: 'A', qty: 100 }],
        actuals: [{ id: 's9', shipped_qty: 99, shipment_record: { id: 'other' } }],
      } as unknown as SupplierShipmentListRow;
      const [row] = decorateShipments(packet);
      expect(row.shippedQty).toBe(0);
      expect(row.state).toBe('planned');
    });

    it('puts outstanding work above completed receipts', { tags: ['important'] }, () => {
      const packet = {
        records: [
          { id: 'done', destination: 'B', qty: 10, planned_date: '2026-01-01' },
          { id: 'todo', destination: 'A', qty: 10, planned_date: '2026-02-01' },
        ],
        actuals: [{ id: 's1', shipped_qty: 10, shipment_record: { id: 'done' } }],
      } as unknown as SupplierShipmentListRow;
      const rows = decorateShipments(packet);
      expect(rows.map((r) => r.id)).toEqual(['todo', 'done']);
      expect(outstandingCount(rows)).toBe(1);
    });

    it('names a destination that has none', { tags: ['edge-case'] }, () => {
      const packet = {
        records: [{ id: 'r1', destination: null, qty: null }],
        actuals: [],
      } as unknown as SupplierShipmentListRow;
      const [row] = decorateShipments(packet);
      expect(row.destination).toBe('Destination not named');
      expect(row.plannedQty).toBe(0);
    });
  });
});
