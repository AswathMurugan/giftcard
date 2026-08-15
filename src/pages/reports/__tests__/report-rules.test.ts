/**
 * What each report actually counts.
 *
 * The demo hard-codes every figure it shows, so none of these definitions came
 * from it — they are decisions, and a wrong one is invisible on screen because
 * a plausible number looks exactly like a correct one. These pin the ones that
 * would otherwise drift: which orders are demand, what counts as on-time, what
 * a win rate is measured over, and where the tenant genuinely cannot answer.
 */
import { describe, it, expect } from 'vitest';
import {
  activityReport,
  agingReport,
  atRiskReport,
  daysBetween,
  milestoneReport,
  orderFacts,
  pipelineReport,
  proofingReport,
  shippingReport,
  toCsv,
  type ReportBoard,
} from '@/pages/reports/report-helpers';
import type { StageDefinition } from '@/pages/orders/stage-helpers';

const TODAY = '2026-08-15';
const LIFECYCLE = ['Order', 'Specs', 'Quote', 'Award', 'Produce', 'Proof', 'Ship', 'Bill', 'Order Close'];

const STAGES: StageDefinition[] = [
  { id: 's1', name: 'Quote', is_initial: true, next_task: { id: 's2' }, states: [{ state: 'Deal Review' }] },
  { id: 's2', name: 'Ship', previous_task: { id: 's1' }, states: [{ state: 'Ready to Ship' }] },
  { id: 's3', name: 'Order Close', is_final: true, states: [{ state: 'Closed', is_final: true }] },
];

const DEMAND = 'o-demand';
const SUPPLY = 'o-supply';

function board(over: Partial<ReportBoard> = {}): ReportBoard {
  return {
    orders: [
      {
        id: DEMAND,
        order_code: 'GC-1073',
        requested_delivery: '2026-08-20',
        created_at: '2026-08-01T00:00:00Z',
        buyer_party_id: { id: 'c1', name: 'Williams-Sonoma' },
        tq_instance: {
          id: 'inst-1',
          current_status: { tq_state_definition: { state: 'Deal Review' } },
        },
      },
      {
        id: SUPPLY,
        order_code: 'GC-1073-SO1',
        buyer_party_id: { id: 'fiserv', name: 'Fiserv Card Services' },
      },
    ],
    relations: [
      { kind: 'supply', parent_order: { id: DEMAND }, child_order: { id: SUPPLY, order_code: 'GC-1073-SO1', seller_party_id: { name: 'IDEMIA' } } },
    ],
    allocations: [
      { kind: 'line', qty: 10_000, unit_cost_micros: 560_000, order_ref: { id: DEMAND }, supplier: { name: 'IDEMIA' } },
      { kind: 'carve_out', qty: 10_000, unit_cost_micros: 150_000, order_ref: { id: DEMAND }, supplier: { name: 'Travel Tags' } },
    ],
    plan_items: [],
    rfes: [],
    responses: [],
    reviews: [],
    shipment_records: [],
    shipments: [],
    state_entries: [
      { created_at: '2026-08-10T00:00:00Z', tq_sub_task_instance: { id: 'st-1', tq_instance: { id: 'inst-1' } } },
    ],
    ...over,
  };
}

const facts = (b = board()) => orderFacts(b, STAGES, TODAY);

describe('orderFacts', () => {
  it('treats an order that is somebody’s supply order as not demand', () => {
    // order_kind is unreliable — 17 rows carry 'merchant' — so the supply side
    // is identified by appearing as a child in order_relation.
    const f = facts();
    expect(f).toHaveLength(1);
    expect(f[0].code).toBe('GC-1073');
  });

  it('sums awarded cost across line and carve-out allocations', () => {
    // 10,000 x 0.560 + 10,000 x 0.150 = 7,100.
    expect(facts()[0].awardedCostMicros).toBe(7_100_000_000);
    expect(facts()[0].suppliers).toEqual(['IDEMIA', 'Travel Tags']);
  });

  it('prefers the live TQ state and falls back to the status snapshot', () => {
    expect(facts()[0].state).toBe('Deal Review');
    expect(facts()[0].stage).toBe('Quote');

    const noLive = board({
      orders: [
        {
          id: DEMAND,
          order_code: 'GC-1073',
          status: { state: 'Ready to Ship' },
          buyer_party_id: { name: 'Williams-Sonoma' },
        },
      ],
      relations: [],
    });
    expect(orderFacts(noLive, STAGES, TODAY)[0].stage).toBe('Ship');
  });

  it('counts an order late only while it is still open', () => {
    const late = board({
      orders: [
        {
          id: DEMAND,
          order_code: 'GC-1',
          requested_delivery: '2026-08-10',
          buyer_party_id: { name: 'Sephora' },
          status: { state: 'Deal Review' },
        },
      ],
      relations: [],
    });
    expect(orderFacts(late, STAGES, TODAY)[0].daysLate).toBe(5);

    const closed = board({
      orders: [
        {
          id: DEMAND,
          order_code: 'GC-1',
          requested_delivery: '2026-08-10',
          buyer_party_id: { name: 'Sephora' },
          status: { state: 'Closed' },
        },
      ],
      relations: [],
    });
    const f = orderFacts(closed, STAGES, TODAY)[0];
    expect(f.open).toBe(false);
    expect(f.daysLate).toBe(0);
  });

  it('takes the newest current-state row as the stage entry', () => {
    expect(facts()[0].stageEnteredAt).toBe('2026-08-10T00:00:00Z');
  });
});

describe('daysBetween', () => {
  it('is whole days and direction-aware, in UTC', () => {
    expect(daysBetween('2026-08-10', '2026-08-15')).toBe(5);
    expect(daysBetween('2026-08-20', '2026-08-15')).toBe(-5);
    expect(daysBetween('2026-08-15T23:59:59Z', '2026-08-15')).toBe(0);
  });
});

describe('pipelineReport', () => {
  it('groups open orders by stage in lifecycle order', () => {
    const r = pipelineReport(facts(), LIFECYCLE);
    expect(r.stages).toHaveLength(1);
    expect(r.stages[0]).toMatchObject({ stage: 'Quote', count: 1, costMicros: 7_100_000_000 });
    expect(r.summary).toMatch(/1 open order/);
  });

  it('excludes closed orders', () => {
    const closed = facts().map((f) => ({ ...f, open: false }));
    expect(pipelineReport(closed, LIFECYCLE).rows).toEqual([]);
  });
});

describe('atRiskReport', () => {
  it('flags an order past its requested delivery', () => {
    const f = facts().map((x) => ({ ...x, daysLate: 3 }));
    const r = atRiskReport(f, [], TODAY);
    expect(r.rows[0].why).toBe('3d past requested delivery');
  });

  it('flags a slipped milestone before the order itself is late', () => {
    const r = atRiskReport(facts(), [
      { milestone_type: 'Prod Art Proof Out', target_date: '2026-08-10', actual_date: null, plan: { subject_order: { id: DEMAND } } },
    ], TODAY);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].why).toBe('Prod Art Proof Out overdue by 5d');
  });

  it('ignores a milestone that already happened', () => {
    const r = atRiskReport(facts(), [
      { milestone_type: 'Art to Supplier', target_date: '2026-08-10', actual_date: '2026-08-09', plan: { subject_order: { id: DEMAND } } },
    ], TODAY);
    expect(r.rows).toEqual([]);
    expect(r.summary).toMatch(/Nothing at risk/);
  });
});

describe('milestoneReport', () => {
  const plans = [
    { milestone_type: 'A', target_date: '2026-08-10', actual_date: '2026-08-09', plan: { subject_order: { id: DEMAND } } },
    { milestone_type: 'B', target_date: '2026-08-10', actual_date: '2026-08-12', plan: { subject_order: { id: DEMAND } } },
    { milestone_type: 'C', target_date: '2026-08-01', actual_date: null, plan: { subject_order: { id: DEMAND } } },
    { milestone_type: 'D', target_date: '2026-09-01', actual_date: null, plan: { subject_order: { id: DEMAND } } },
  ];

  it('classifies met, late, overdue and pending', () => {
    const r = milestoneReport(facts(), plans, TODAY);
    expect(r.rows.map((x) => x.state)).toEqual(['Overdue', 'Met', 'Late', 'Pending']);
  });

  it('measures on-time over milestones that happened, not all of them', () => {
    // 1 met of 2 completed = 50%. Counting the 2 unfinished would give 25%
    // and would fall every time a plan is published.
    expect(milestoneReport(facts(), plans, TODAY).onTimePct).toBe(50);
  });

  it('reports null rather than 0% when nothing has come due', () => {
    const r = milestoneReport(facts(), [plans[3]], TODAY);
    expect(r.onTimePct).toBeNull();
    expect(r.summary).toMatch(/No milestone has come due/);
  });
});

describe('activityReport', () => {
  const b = board({
    rfes: [
      { id: 'r1', status: 'responded', sent_at: '2026-08-01', supplier: { name: 'IDEMIA' }, demand_order: { id: DEMAND } },
      { id: 'r2', status: 'responded', sent_at: '2026-08-01', supplier: { name: 'Thales' }, demand_order: { id: DEMAND } },
      { id: 'r3', status: 'sent', sent_at: '2026-08-01', supplier: { name: 'CPI Card Group' }, demand_order: { id: DEMAND } },
    ],
    responses: [
      { id: 'p1', status: 'submitted', round: 1, lead_time_weeks: 3, rfe: { id: 'r1' } },
      { id: 'p2', status: 'submitted', round: 1, lead_time_weeks: 4, rfe: { id: 'r2' } },
    ],
  });

  it('measures win rate over quotes received, not orders awarded', () => {
    // Two quoted (IDEMIA, Thales); IDEMIA holds an allocation, Thales does not.
    const r = activityReport(orderFacts(b, STAGES, TODAY), b, TODAY);
    expect(r.quotesIn).toBe(2);
    expect(r.rfesOut).toBe(3);
    expect(r.winRatePct).toBe(50);
  });

  it('marks an unanswered RFE stalled once it is older than the threshold', () => {
    const r = activityReport(orderFacts(b, STAGES, TODAY), b, TODAY);
    expect(r.rows.find((x) => x.supplier === 'CPI Card Group')?.stalled).toBe(true);
    expect(r.rows.find((x) => x.supplier === 'IDEMIA')?.stalled).toBe(false);
    expect(r.summary).toMatch(/worth a nudge/);
  });

  it('reports a null win rate when nobody has quoted', () => {
    const none = board({ rfes: [{ id: 'r1', sent_at: '2026-08-14', supplier: { name: 'X' }, demand_order: { id: DEMAND } }], responses: [] });
    expect(activityReport(orderFacts(none, STAGES, TODAY), none, TODAY).winRatePct).toBeNull();
  });

  it('lists supplier orders against the demand order they belong to', () => {
    const r = activityReport(orderFacts(b, STAGES, TODAY), b, TODAY);
    expect(r.supplyOrders).toEqual([
      { code: 'GC-1073-SO1', supplier: 'IDEMIA', parentCode: 'GC-1073' },
    ]);
  });
});

describe('proofingReport', () => {
  it('counts proof rounds only — a deal review is not a proof', () => {
    const reviews = [
      { review_kind: 'proof', proof_type: 'Art proof', round: 2, status: 'in_review', subject_order: { id: DEMAND } },
      { review_kind: 'deal_review', round: 1, status: 'approved', subject_order: { id: DEMAND } },
    ];
    const r = proofingReport(facts(), reviews);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ proof: 'Art proof', round: 2, state: 'in_review' });
    expect(r.summary).toMatch(/1 still open/);
  });
});

describe('shippingReport', () => {
  const b = board({
    shipment_records: [
      { id: 'sr1', qty: 6000, supply_order: { id: SUPPLY } },
      { id: 'sr2', qty: 4000, supply_order: { id: SUPPLY } },
    ],
    shipments: [
      { shipped_qty: 6000, shipment_record: { id: 'sr1' } },
      { shipped_qty: 1000, shipment_record: { id: 'sr2' } },
    ],
  });

  it('attributes a supply order’s shipments to its demand order', () => {
    const r = shippingReport(orderFacts(b, STAGES, TODAY), b);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({
      code: 'GC-1073',
      destinations: 2,
      planned: 10_000,
      despatched: 7_000,
      outstanding: 3_000,
    });
  });

  it('does not claim to know about delivery', () => {
    expect(shippingReport(orderFacts(b, STAGES, TODAY), b).deliveryTracked).toBe(false);
  });
});

describe('agingReport', () => {
  it('reports days in stage from the workflow, and null when it recorded none', () => {
    const r = agingReport(facts(), TODAY);
    expect(r.rows[0].inStage).toBe(5);
    expect(r.rows[0].totalAge).toBe(14);

    const noEntry = facts().map((f) => ({ ...f, stageEnteredAt: null }));
    // Null, never 0 — zero would read as "arrived today" and hide the stall.
    expect(agingReport(noEntry, TODAY).rows[0].inStage).toBeNull();
  });

  it('flags an order sitting beyond the stage threshold', () => {
    const stuck = facts().map((f) => ({ ...f, stageEnteredAt: '2026-08-01T00:00:00Z' }));
    const r = agingReport(stuck, TODAY);
    expect(r.rows[0].stuck).toBe(true);
    expect(r.summary).toMatch(/beyond 7 days in one stage/);
  });
});

describe('toCsv', () => {
  it('quotes every cell and escapes inner quotes', () => {
    const csv = toCsv(['Client', 'Note'], [['Williams-Sonoma, Inc.', 'said "no"'], [null, 3]]);
    expect(csv.split('\n')[1]).toBe('"Williams-Sonoma, Inc.","said ""no"""');
    expect(csv.split('\n')[2]).toBe('"","3"');
  });
});
