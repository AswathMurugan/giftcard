/**
 * Expired orders in the reports.
 *
 * An order expires when a stage's wait for a response runs out. Two things
 * follow, and both are easy to get wrong because a plausible number looks
 * exactly like a correct one:
 *
 *   1. It is FINISHED. Left out of the terminal set it keeps counting as open
 *      forever — in Pipeline, in At-Risk, accruing "days late" against a
 *      delivery date nobody is working towards.
 *   2. It is not merely slow. The question stops being "who chases this" and
 *      becomes "what did we commit before it died", which is why the report
 *      carries committed cost rather than an age.
 */
import { describe, it, expect } from 'vitest';
import {
  agingReport,
  atRiskReport,
  expiredReport,
  orderFacts,
  pipelineReport,
  toCsv,
  type ReportBoard,
} from '@/pages/reports/report-helpers';
import type { StageDefinition } from '@/pages/orders/stage-helpers';

const TODAY = '2026-08-15';
const LIFECYCLE = ['Order', 'Specs', 'Quote', 'Order Close'];

const STAGES: StageDefinition[] = [
  {
    id: 's1',
    name: 'Specs',
    is_initial: true,
    next_task: { id: 's2' },
    states: [{ state: 'In Design' }],
  },
  { id: 's2', name: 'Quote', previous_task: { id: 's1' }, states: [{ state: 'Deal Review' }] },
  {
    id: 'sx',
    name: 'Expired',
    is_final: true,
    states: [{ state: 'Expired', is_initial: true, is_final: true }],
  },
];

/** One live order and one that expired after committing spend. */
function board(): ReportBoard {
  return {
    orders: [
      {
        id: 'live',
        order_code: 'GC-2001',
        requested_delivery: '2026-08-20',
        created_at: '2026-08-01T00:00:00Z',
        buyer_party_id: { id: 'c1', name: 'Sephora' },
        tq_instance: {
          id: 'inst-live',
          current_status: { tq_state_definition: { state: 'Deal Review' } },
        },
      },
      {
        id: 'dead',
        order_code: 'GC-2002',
        // Long past, and deliberately so: a delivery date nobody is chasing.
        requested_delivery: '2026-07-01',
        created_at: '2026-06-01T00:00:00Z',
        buyer_party_id: { id: 'c2', name: 'Williams-Sonoma' },
        created_by: { full_name: 'A. Specialist' },
        tq_instance: {
          id: 'inst-dead',
          current_status: { tq_state_definition: { state: 'Expired' } },
        },
      },
    ],
    relations: [],
    allocations: [
      // Awarded before it lapsed — the spend that has to be unwound.
      {
        kind: 'line',
        qty: 1_000,
        unit_cost_micros: 500_000,
        order_ref: { id: 'dead' },
        supplier: { name: 'IDEMIA' },
      },
    ],
    plan_items: [],
    rfes: [],
    responses: [],
    reviews: [],
    shipment_records: [],
    shipments: [],
    state_entries: [
      {
        created_at: '2026-07-05T00:00:00Z',
        tq_sub_task_instance: { id: 'st-dead', tq_instance: { id: 'inst-dead' } },
      },
    ],
  };
}

const facts = () => orderFacts(board(), STAGES, TODAY);

describe('Expired is terminal', { tags: ['reports', 'important'] }, () => {
  it('is not open', () => {
    const dead = facts().find((f) => f.code === 'GC-2002');
    expect(dead?.open).toBe(false);
  });

  it('never accrues days late', { tags: ['important'] }, () => {
    // Delivery was 2026-07-01 and today is 2026-08-15. Were Expired missing
    // from the terminal set this would read 45 and climb daily, forever.
    const dead = facts().find((f) => f.code === 'GC-2002');
    expect(dead?.daysLate).toBe(0);
  });

  it('is left out of the pipeline', { tags: ['important'] }, () => {
    const rows = pipelineReport(facts(), LIFECYCLE).rows;
    expect(rows.map((r) => r.code)).toEqual(['GC-2001']);
  });

  it('is not flagged at-risk', () => {
    const rows = atRiskReport(facts(), [], TODAY).rows;
    expect(rows.map((r) => r.order.code)).not.toContain('GC-2002');
  });

  it('is not counted as an aging open order', () => {
    const rows = agingReport(facts(), TODAY).rows;
    expect(rows.map((r) => r.code)).not.toContain('GC-2002');
  });
});

describe('expiredReport', { tags: ['reports', 'logic'] }, () => {
  it('lists only expired orders', { tags: ['smoke'] }, () => {
    const r = expiredReport(facts());
    expect(r.rows.map((x) => x.code)).toEqual(['GC-2002']);
  });

  it('dates the expiry from when it entered Expired', () => {
    const row = expiredReport(facts()).rows[0];
    expect(row.expiredOn).toBe('2026-07-05T00:00:00Z');
    // Raised 1 June, expired 5 July.
    expect(row.livedDays).toBe(34);
  });

  it('carries the cost committed before it lapsed', { tags: ['important'] }, () => {
    const row = expiredReport(facts()).rows[0];
    expect(row.committedMicros).toBe(500_000_000);
    expect(row.suppliers).toEqual(['IDEMIA']);
  });

  it('calls out the committed spend in the summary', () => {
    expect(expiredReport(facts()).summary).toContain('1 expired');
    expect(expiredReport(facts()).summary).toContain('after committing');
  });

  it('says so plainly when nothing has expired', { tags: ['edge-case'] }, () => {
    const r = expiredReport(facts().filter((f) => f.code === 'GC-2001'));
    expect(r.rows).toEqual([]);
    expect(r.committedMicros).toBe(0);
    expect(r.summary).toBe('Nothing has expired.');
  });

  it('does not claim spend that was never committed', { tags: ['edge-case'] }, () => {
    const noSpend = expiredReport(
      facts().map((f) => ({ ...f, awardedCostMicros: 0, suppliers: [] })),
    );
    expect(noSpend.summary).toBe('1 expired.');
    expect(noSpend.committedMicros).toBe(0);
  });

  it('sorts newest expiry first', { tags: ['logic'] }, () => {
    const base = facts().find((f) => f.code === 'GC-2002')!;
    const r = expiredReport([
      { ...base, code: 'OLD', stageEnteredAt: '2026-05-01T00:00:00Z' },
      { ...base, code: 'NEW', stageEnteredAt: '2026-08-01T00:00:00Z' },
    ]);
    expect(r.rows.map((x) => x.code)).toEqual(['NEW', 'OLD']);
  });

  it('survives an order whose entry time was never recorded', { tags: ['edge-case'] }, () => {
    const base = facts().find((f) => f.code === 'GC-2002')!;
    const r = expiredReport([{ ...base, stageEnteredAt: null }]);
    expect(r.rows[0].expiredOn).toBeNull();
    expect(r.rows[0].livedDays).toBeNull();
  });

  it('exports committed cost in dollars, not micros', { tags: ['logic'] }, () => {
    const row = expiredReport(facts()).rows[0];
    const csv = toCsv(['Committed cost'], [[row.committedMicros / 1_000_000]]);
    expect(csv).toContain('"500"');
  });
});
