/**
 * The supplier scorecard. `today` is injected rather than read from the clock
 * so lateness is deterministic and every row on one render is judged against
 * the same instant.
 */
import { describe, it, expect } from 'vitest';
import { buildScorecard, isLate } from '@/pages/reports/report-helpers';
import type { PoRow } from '@/pages/orders-po/po-helpers';
import type { ShipmentRow } from '@/pages/shipments/shipment-helpers';
import type { InvoiceRow } from '@/pages/invoices/invoice-helpers';

function ship(over: Partial<ShipmentRow>): ShipmentRow {
  return {
    id: 'r1',
    orderCode: 'PO1',
    destination: 'A',
    plannedQty: 100,
    shippedQty: 0,
    plannedDate: null,
    shipDate: null,
    carrier: null,
    tracking: null,
    state: 'planned',
    label: 'Awaiting despatch',
    ...over,
  };
}

function po(over: Partial<PoRow>): PoRow {
  return {
    id: 'p1',
    code: 'PO1',
    parentCode: 'GC-1',
    brief: '',
    requestedDelivery: null,
    instanceId: 'i1',
    stage: 'PO Acknowledge',
    state: 'PO Raised',
    stageIndex: 0,
    done: false,
    next: { label: 'Acknowledge order', toStage: '', toState: '', blurb: '' },
    ...over,
  } as PoRow;
}

const TODAY = '2026-08-17';

describe('report-helpers', { tags: ['reports', 'logic'] }, () => {
  describe('isLate', { tags: ['important'] }, () => {
    it('is late when the planned date has passed and nothing shipped', () => {
      expect(isLate(ship({ plannedDate: '2026-08-01' }), TODAY)).toBe(true);
    });

    it('is not late once shipped, however overdue', () => {
      // A late delivery that arrived is a history entry, not outstanding work.
      expect(isLate(ship({ plannedDate: '2026-01-01', state: 'shipped' }), TODAY)).toBe(false);
    });

    it('is not late without a planned date', { tags: ['edge-case'] }, () => {
      // An absent commitment cannot be a missed one.
      expect(isLate(ship({ plannedDate: null }), TODAY)).toBe(false);
    });

    it('is not late on the planned day itself', { tags: ['edge-case'] }, () => {
      expect(isLate(ship({ plannedDate: TODAY }), TODAY)).toBe(false);
    });

    it('compares dates, not timestamps', { tags: ['edge-case'] }, () => {
      expect(isLate(ship({ plannedDate: '2026-08-16T23:00:00Z' }), '2026-08-17T01:00:00Z')).toBe(
        true,
      );
    });
  });

  describe('buildScorecard', { tags: ['important'] }, () => {
    it('does not divide by zero on an empty book', { tags: ['edge-case'] }, () => {
      const card = buildScorecard([], [], [], TODAY);
      expect(card.fulfilmentPct).toBe(0);
      expect(Number.isNaN(card.fulfilmentPct)).toBe(false);
      expect(card.totalOrders).toBe(0);
      expect(card.billableExtras).toBe(0);
    });

    it('counts "needs you" by outstanding action, not by unfinished', () => {
      const pos = [
        po({ id: 'a', next: { label: 'x', toStage: '', toState: '', blurb: '' } }),
        // Parked on Fiserv's side: unfinished, but not the supplier's queue.
        po({ id: 'b', next: null, done: false }),
        po({ id: 'c', next: null, done: true }),
      ];
      const card = buildScorecard(pos, [], [], TODAY);
      expect(card.openOrders).toBe(1);
      expect(card.completedOrders).toBe(1);
      expect(card.totalOrders).toBe(3);
    });

    it('reports fulfilment by destination and units by quantity', () => {
      const shipments = [
        ship({ id: '1', plannedQty: 100, shippedQty: 100, state: 'shipped' }),
        ship({ id: '2', plannedQty: 100, shippedQty: 50, state: 'partial' }),
      ];
      const card = buildScorecard([], shipments, [], TODAY);
      expect(card.fulfilmentPct).toBe(50); // one of two destinations complete
      expect(card.plannedUnits).toBe(200);
      expect(card.shippedUnits).toBe(150);
    });

    it('sums only billable extras', () => {
      const invoices = [
        { id: 'a', status: 'billable', amount: 100 },
        { id: 'b', status: 'draft', amount: 999 },
      ] as InvoiceRow[];
      expect(buildScorecard([], [], invoices, TODAY).billableExtras).toBe(100);
    });
  });
});
