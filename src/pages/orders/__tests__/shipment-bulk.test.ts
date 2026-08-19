/**
 * Bulk destination planning.
 *
 * The convenience half of this feature is easy and barely worth testing. The
 * half that matters is the refusal: bulk entry makes it twenty-four times
 * easier to over-plan a supply order than single entry did, and an
 * over-planned destination is a promise to a client that nobody can keep.
 *
 * So the bulk of these cases are about the cap holding — including the case a
 * naive per-row check misses, where two rows against the SAME supply order
 * each pass individually and breach it together.
 */
import { describe, it, expect } from 'vitest';
import {
  splitEvenly,
  fillRemaining,
  activeRows,
  bulkTotal,
  buildBulkPlan,
  bulkSummary,
  type BulkTarget,
} from '@/pages/orders/shipment-bulk';

const TARGETS: BulkTarget[] = [
  { supplyOrderId: 'po1', supplyOrderCode: 'GC-1019-PO1', unplanned: 4000 },
  { supplyOrderId: 'po2', supplyOrderCode: 'GC-1019-PO2', unplanned: 2000 },
  { supplyOrderId: 'po3', supplyOrderCode: 'GC-1019-PO3', unplanned: 0 },
];

const COMMON = { destination: 'Sephora DC - Reno NV', shipmentType: 'standard' };

describe('splitEvenly', { tags: ['shipping', 'logic'] }, () => {
  it('divides cleanly when it can', { tags: ['smoke'] }, () => {
    expect(splitEvenly(6000, 3)).toEqual([2000, 2000, 2000]);
  });

  /** Cards are whole units — the remainder is handed out, never rounded away. */
  it('hands the remainder out from the top', { tags: ['important'] }, () => {
    expect(splitEvenly(10, 3)).toEqual([4, 3, 3]);
    expect(splitEvenly(11, 3)).toEqual([4, 4, 3]);
  });

  it('always sums back to the floored total', { tags: ['important'] }, () => {
    for (const total of [1, 7, 999, 6000, 12345]) {
      for (const buckets of [1, 2, 3, 7]) {
        const parts = splitEvenly(total, buckets);
        expect(parts.reduce((a, b) => a + b, 0)).toBe(Math.floor(total));
      }
    }
  });

  it('returns zeros rather than throwing on half-typed input', { tags: ['edge-case'] }, () => {
    expect(splitEvenly(0, 3)).toEqual([0, 0, 0]);
    expect(splitEvenly(-5, 2)).toEqual([0, 0]);
    expect(splitEvenly(Number.NaN, 2)).toEqual([0, 0]);
  });

  it('handles a degenerate bucket count', { tags: ['edge-case'] }, () => {
    expect(splitEvenly(100, 0)).toEqual([]);
    expect(splitEvenly(100, -1)).toEqual([]);
  });
});

describe('fillRemaining', { tags: ['shipping', 'logic'] }, () => {
  it('proposes exactly what each supply order still owes', () => {
    expect(fillRemaining(TARGETS)).toEqual([
      { supplyOrderId: 'po1', qty: 4000 },
      { supplyOrderId: 'po2', qty: 2000 },
    ]);
  });

  it('skips a fully planned supply order', { tags: ['edge-case'] }, () => {
    expect(fillRemaining(TARGETS).some((r) => r.supplyOrderId === 'po3')).toBe(false);
  });
});

describe('activeRows / bulkTotal', { tags: ['shipping', 'logic'] }, () => {
  it('treats a zero as a deselect, not an error', () => {
    const rows = [
      { supplyOrderId: 'po1', qty: 1000 },
      { supplyOrderId: 'po2', qty: 0 },
    ];
    expect(activeRows(rows)).toHaveLength(1);
    expect(bulkTotal(rows)).toBe(1000);
  });

  it('ignores NaN quantities while typing', { tags: ['edge-case'] }, () => {
    expect(bulkTotal([{ supplyOrderId: 'po1', qty: Number.NaN }])).toBe(0);
  });
});

describe('buildBulkPlan', { tags: ['shipping', 'important'] }, () => {
  it('builds one payload per selected supply order', { tags: ['smoke'] }, () => {
    const plan = buildBulkPlan(COMMON, [
      { supplyOrderId: 'po1', qty: 4000 },
      { supplyOrderId: 'po2', qty: 2000 },
    ], TARGETS);

    expect(plan.errors).toEqual([]);
    expect(plan.payloads).toEqual([
      { supplyOrderId: 'po1', shipmentType: 'standard', destination: 'Sephora DC - Reno NV', qty: 4000, plannedDate: null },
      { supplyOrderId: 'po2', shipmentType: 'standard', destination: 'Sephora DC - Reno NV', qty: 2000, plannedDate: null },
    ]);
  });

  it('refuses a quantity over what the supply order can take', () => {
    const plan = buildBulkPlan(COMMON, [{ supplyOrderId: 'po2', qty: 2500 }], TARGETS);
    expect(plan.payloads).toEqual([]);
    expect(plan.errors[0]).toContain('GC-1019-PO2');
    expect(plan.errors[0]).toContain('2,500');
    expect(plan.errors[0]).toContain('2,000');
  });

  /**
   * The case a per-row check misses: 1,500 and 1,000 each fit under PO2's
   * 2,000 cap, but together they are 2,500.
   */
  it('sums two rows against the same supply order before capping', { tags: ['important'] }, () => {
    const plan = buildBulkPlan(COMMON, [
      { supplyOrderId: 'po2', qty: 1500 },
      { supplyOrderId: 'po2', qty: 1000 },
    ], TARGETS);
    expect(plan.payloads).toEqual([]);
    expect(plan.errors.some((e) => e.includes('GC-1019-PO2'))).toBe(true);
  });

  it('never returns a partial set when anything fails', { tags: ['important'] }, () => {
    // po1 is fine; po2 is over. Creating just po1 would leave a half-done bulk.
    const plan = buildBulkPlan(COMMON, [
      { supplyOrderId: 'po1', qty: 1000 },
      { supplyOrderId: 'po2', qty: 9999 },
    ], TARGETS);
    expect(plan.payloads).toEqual([]);
    expect(plan.errors).toHaveLength(1);
  });

  it('requires a destination', { tags: ['edge-case'] }, () => {
    const plan = buildBulkPlan({ ...COMMON, destination: '   ' }, [{ supplyOrderId: 'po1', qty: 10 }], TARGETS);
    expect(plan.errors).toContain('Give the destination a name.');
  });

  it('requires a shipment type', { tags: ['edge-case'] }, () => {
    const plan = buildBulkPlan({ ...COMMON, shipmentType: '' }, [{ supplyOrderId: 'po1', qty: 10 }], TARGETS);
    expect(plan.errors).toContain('Pick a shipment type.');
  });

  it('requires at least one selected row', { tags: ['edge-case'] }, () => {
    expect(buildBulkPlan(COMMON, [], TARGETS).errors[0]).toContain('Select at least one');
    expect(buildBulkPlan(COMMON, [{ supplyOrderId: 'po1', qty: 0 }], TARGETS).errors[0]).toContain(
      'Select at least one',
    );
  });

  it('rejects a supply order that is no longer on the order', { tags: ['edge-case'] }, () => {
    const plan = buildBulkPlan(COMMON, [{ supplyOrderId: 'ghost', qty: 10 }], TARGETS);
    expect(plan.errors[0]).toContain('no longer on this order');
  });

  it('refuses anything against a fully planned supply order', () => {
    const plan = buildBulkPlan(COMMON, [{ supplyOrderId: 'po3', qty: 1 }], TARGETS);
    expect(plan.payloads).toEqual([]);
    expect(plan.errors[0]).toContain('GC-1019-PO3');
  });

  it('floors a pasted decimal rather than blocking on it', { tags: ['edge-case'] }, () => {
    const plan = buildBulkPlan(COMMON, [{ supplyOrderId: 'po1', qty: 1000.0 }], TARGETS);
    expect(plan.payloads[0].qty).toBe(1000);
  });

  it('trims common fields and narrows the date to a day', () => {
    const plan = buildBulkPlan(
      { destination: '  Reno  ', shipmentType: ' standard ', plannedDate: '2026-10-15T00:00:00Z' },
      [{ supplyOrderId: 'po1', qty: 5 }],
      TARGETS,
    );
    expect(plan.payloads[0].destination).toBe('Reno');
    expect(plan.payloads[0].shipmentType).toBe('standard');
    expect(plan.payloads[0].plannedDate).toBe('2026-10-15');
  });

  it('accepts exactly the remaining quantity', { tags: ['edge-case'] }, () => {
    const plan = buildBulkPlan(COMMON, fillRemaining(TARGETS), TARGETS);
    expect(plan.errors).toEqual([]);
    expect(bulkTotal(plan.payloads.map((p) => ({ supplyOrderId: p.supplyOrderId, qty: p.qty })))).toBe(6000);
  });
});

describe('bulkSummary', { tags: ['shipping', 'logic'] }, () => {
  it('counts destinations and units', { tags: ['smoke'] }, () => {
    expect(bulkSummary([
      { supplyOrderId: 'po1', qty: 4000 },
      { supplyOrderId: 'po2', qty: 2000 },
    ])).toBe('Create 2 destinations · 6,000 units');
  });

  it('uses the singular for one', { tags: ['edge-case'] }, () => {
    expect(bulkSummary([{ supplyOrderId: 'po1', qty: 10 }])).toBe('Create 1 destination · 10 units');
  });

  it('says nothing is selected when nothing is', { tags: ['edge-case'] }, () => {
    expect(bulkSummary([])).toBe('Nothing selected');
    expect(bulkSummary([{ supplyOrderId: 'po1', qty: 0 }])).toBe('Nothing selected');
  });
});
