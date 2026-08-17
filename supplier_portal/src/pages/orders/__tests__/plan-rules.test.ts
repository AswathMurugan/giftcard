/**
 * The schedule's arithmetic and its rule about where actual dates come from.
 *
 * Two things are worth guarding here. The date maths must not drift by a day
 * across time zones — a schedule that is silently one day out is worse than
 * none. And `deriveActuals` must only ever return dates it can point at a
 * stored row for; the moment it starts guessing, the plan stops being evidence.
 */
import { describe, it, expect } from 'vitest';
import {
  addDays,
  leadTimeSlip,
  statusChip,
  daysBetween,
  dateOf,
  deriveActuals,
  milestoneStatus,
  milestoneViews,
  pendingStamps,
  planFromTemplate,
  planSummary,
  sequenceForDate,
  templateFor,
  type PlanTemplateRow,
} from '@/pages/orders/plan-helpers';

const TEMPLATE: PlanTemplateRow[] = [
  {
    id: 't1',
    milestone_type: 'Proposal Approval',
    sequence: 1,
    offset_days: 50,
    pad_days: 0,
    owner_role: 'cs',
    client_obligation: false,
    template: { id: 'tpl', name: 'Standard', client: null },
  },
  {
    id: 't2',
    milestone_type: 'Prod Art Proof Approval',
    sequence: 4,
    offset_days: 34,
    pad_days: 2,
    owner_role: 'client',
    client_obligation: true,
    template: { id: 'tpl', name: 'Standard', client: null },
  },
  {
    id: 't3',
    milestone_type: 'Final Ship',
    sequence: 9,
    offset_days: 0,
    pad_days: 0,
    owner_role: 'supplier',
    client_obligation: false,
    template: { id: 'tpl', name: 'Standard', client: null },
  },
];

describe('schedule dates', { tags: ['orders', 'schedule', 'logic'] }, () => {
  it('counts back from the in-hands date', { tags: ['important'] }, () => {
    expect(addDays('2026-08-31', -50)).toBe('2026-07-12');
    expect(addDays('2026-08-31', 0)).toBe('2026-08-31');
  });

  it('crosses a month and a year boundary', { tags: ['edge-case'] }, () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2027-01-02', -3)).toBe('2026-12-30');
  });

  it('is unaffected by the local time zone', { tags: ['important'] }, () => {
    // A naive `new Date(iso).getDate()` shifts a day west of Greenwich; this
    // must return the same answer wherever the operator is.
    expect(addDays('2026-08-31', -1)).toBe('2026-08-30');
    expect(daysBetween('2026-08-30', '2026-08-31')).toBe(1);
    expect(daysBetween('2026-08-31', '2026-08-30')).toBe(-1);
    expect(daysBetween('2026-08-31', '2026-08-31')).toBe(0);
  });

  it('takes the date part off a timestamp', { tags: ['edge-case'] }, () => {
    expect(dateOf('2026-08-15T01:12:35.109685+00:00')).toBe('2026-08-15');
    expect(dateOf(null)).toBeNull();
    expect(dateOf(undefined)).toBeNull();
  });
});

describe('applying a template', { tags: ['orders', 'schedule', 'logic'] }, () => {
  it('back-calculates every target from the anchor', { tags: ['important'] }, () => {
    const out = planFromTemplate(TEMPLATE, '2026-08-31');
    expect(out.map((m) => [m.milestoneType, m.targetDate])).toEqual([
      ['Proposal Approval', '2026-07-12'],
      // 34 + 2 days of padding: the ask lands EARLIER than strictly needed.
      ['Prod Art Proof Approval', '2026-07-26'],
      ['Final Ship', '2026-08-31'],
    ]);
  });

  it('keeps padding visible rather than folding it into the offset', () => {
    const proof = planFromTemplate(TEMPLATE, '2026-08-31')[1];
    expect(proof.padDays).toBe(2);
    expect(proof.clientObligation).toBe(true);
  });

  it('orders by sequence, not by input order', { tags: ['edge-case'] }, () => {
    const shuffled = [TEMPLATE[2], TEMPLATE[0], TEMPLATE[1]];
    expect(planFromTemplate(shuffled, '2026-08-31').map((m) => m.sequence)).toEqual([1, 4, 9]);
  });

  it('prefers the client-specific template over the fallback', { tags: ['important'] }, () => {
    const rows: PlanTemplateRow[] = [
      ...TEMPLATE,
      {
        id: 'c1',
        milestone_type: 'Final Ship',
        sequence: 9,
        offset_days: 5,
        template: { id: 'acme', name: 'Acme', client: { id: 'client-1', name: 'Acme' } },
      },
    ];
    expect(templateFor(rows, 'client-1')).toHaveLength(1);
    expect(templateFor(rows, 'someone-else')).toHaveLength(3);
    expect(templateFor(rows, null)).toHaveLength(3);
  });
});

describe('milestone status', { tags: ['orders', 'schedule', 'logic'] }, () => {
  it('is met on or before target, late after', { tags: ['important'] }, () => {
    expect(milestoneStatus('2026-08-20', '2026-08-19', '2026-08-25')).toBe('met');
    expect(milestoneStatus('2026-08-20', '2026-08-20', '2026-08-25')).toBe('met');
    expect(milestoneStatus('2026-08-20', '2026-08-21', '2026-08-25')).toBe('late');
  });

  it('separates not-yet-due from overdue while nothing has happened', () => {
    expect(milestoneStatus('2026-08-20', null, '2026-08-10')).toBe('pending');
    expect(milestoneStatus('2026-08-20', null, '2026-08-20')).toBe('pending');
    expect(milestoneStatus('2026-08-20', null, '2026-08-21')).toBe('missed');
  });

  it('has no verdict without a target', { tags: ['edge-case'] }, () => {
    expect(milestoneStatus(null, null, '2026-08-20')).toBe('na');
  });

  it('labels the offset back from delivery', () => {
    const [view] = milestoneViews(
      [{ id: 'i1', milestone_type: 'Final Ship', sequence: 9, target_date: '2026-08-22' }],
      '2026-08-31',
      '2026-08-15',
    );
    expect(view.offsetLabel).toBe('D-9');
    expect(view.daysToTarget).toBe(7);
  });

  it('summarises what an operator needs from a collapsed card', { tags: ['smoke'] }, () => {
    const views = milestoneViews(
      [
        { id: 'a', milestone_type: 'Art to Supplier', sequence: 2, target_date: '2026-08-01', actual_date: '2026-08-01' },
        { id: 'b', milestone_type: 'First Box Approval', sequence: 7, target_date: '2026-08-14' },
        { id: 'c', milestone_type: 'Final Ship', sequence: 9, target_date: '2026-08-31' },
      ],
      '2026-08-31',
      '2026-08-15',
    );
    expect(planSummary(views, '2026-08-15')).toContain('1 overdue');
    expect(planSummary(views, '2026-08-15')).toContain('First Box Approval');
    expect(planSummary([], '2026-08-15')).toBe('No schedule yet');
  });
});

describe('actuals come from events', { tags: ['orders', 'schedule', 'important'] }, () => {
  const sources = {
    proposals: [{ sent_at: '2026-08-15T02:00:00Z', accepted_at: null }],
    relations: [
      { kind: 'supply', created_at: '2026-08-15T03:00:00Z', child_order: { id: 'so1' } },
      { kind: 'supply', created_at: '2026-08-15T03:05:00Z', child_order: { id: 'so2' } },
      { kind: 'other', created_at: '2026-01-01T00:00:00Z', child_order: { id: 'x' } },
    ],
    reviews: [
      { review_kind: 'proof', proof_type: 'Art proof', round: 1, proof_uploaded_at: '2026-08-15T04:00:00Z' },
      { review_kind: 'proof', proof_type: 'Art proof', round: 2, proof_uploaded_at: '2026-08-16T04:00:00Z' },
      { review_kind: 'proof', proof_type: 'Data proof', round: 1, requested_at: '2026-08-15T05:00:00Z' },
    ],
    verdicts: [
      { decision: 'reject', decided_at: '2026-08-15T06:00:00Z', review_request: { review_kind: 'proof', proof_type: 'Art proof', round: 1 } },
      { decision: 'approve', decided_at: '2026-08-16T06:00:00Z', review_request: { review_kind: 'proof', proof_type: 'Art proof', round: 2 } },
    ],
    shipments: [
      { ship_date: '2026-08-17', shipment_record: { id: 'r1' } },
      { ship_date: '2026-08-18', shipment_record: { id: 'r2' } },
    ],
    shippingComplete: true,
  };

  it('takes the FIRST supply order for art-to-supplier', () => {
    expect(deriveActuals(sources)['Art to Supplier'].date).toBe('2026-08-15');
  });

  it('takes the LAST approval for a proof that was rejected first', { tags: ['important'] }, () => {
    // v1 was rejected on the 15th; the milestone is met when v2 is approved.
    expect(deriveActuals(sources)['Prod Art Proof Approval'].date).toBe('2026-08-16');
  });

  it('ignores a rejection — a reject is not an approval', () => {
    const rejectedOnly = { ...sources, verdicts: [sources.verdicts[0]] };
    expect(deriveActuals(rejectedOnly)['Prod Art Proof Approval']).toBeUndefined();
  });

  it('spans first and last despatch', () => {
    const out = deriveActuals(sources);
    expect(out['Partial Ship'].date).toBe('2026-08-17');
    expect(out['Final Ship'].date).toBe('2026-08-18');
  });

  it('withholds Final Ship while a destination is short', { tags: ['important'] }, () => {
    const partial = { ...sources, shippingComplete: false };
    const out = deriveActuals(partial);
    expect(out['Partial Ship']).toBeDefined();
    expect(out['Final Ship']).toBeUndefined();
  });

  it('never invents a date for an event this app does not record', { tags: ['important'] }, () => {
    expect(deriveActuals(sources)['First Box Approval']).toBeUndefined();
  });

  it('returns nothing at all for an order where nothing happened', { tags: ['edge-case'] }, () => {
    expect(Object.keys(deriveActuals({}))).toHaveLength(0);
  });
});

describe('stamping', { tags: ['orders', 'schedule', 'logic'] }, () => {
  const actuals = {
    'Art to Supplier': { date: '2026-08-15', note: 'supply order raised (2)' },
    'Final Ship': { date: '2026-08-15', note: 'all planned destinations despatched' },
  };

  it('fills only empty actuals, so a repeat run is a no-op', { tags: ['important'] }, () => {
    const items = [
      { id: 'a', milestone_type: 'Art to Supplier', target_date: '2026-07-17' },
      { id: 'b', milestone_type: 'Final Ship', target_date: '2026-08-31', actual_date: '2026-08-15' },
    ];
    const out = pendingStamps(items, actuals);
    expect(out.map((s) => s.itemId)).toEqual(['a']);
    expect(pendingStamps([items[1]], actuals)).toHaveLength(0);
  });

  it('records met or late from the event date, not from today', () => {
    const [late] = pendingStamps(
      [{ id: 'a', milestone_type: 'Art to Supplier', target_date: '2026-07-17' }],
      actuals,
    );
    expect(late.status).toBe('late');
    const [met] = pendingStamps(
      [{ id: 'b', milestone_type: 'Final Ship', target_date: '2026-08-31' }],
      actuals,
    );
    expect(met.status).toBe('met');
  });

  it('leaves a milestone with no matching event alone', { tags: ['edge-case'] }, () => {
    expect(
      pendingStamps([{ id: 'c', milestone_type: 'First Box Approval', target_date: '2026-08-14' }], actuals),
    ).toHaveLength(0);
  });
});

describe('the chip an operator reads', { tags: ['orders', 'schedule', 'logic'] }, () => {
  const view = (over: Partial<ReturnType<typeof milestoneViews>[number]>) =>
    ({
      id: 'i',
      milestoneType: 'Final Ship',
      sequence: 9,
      targetDate: '2026-08-20',
      actualDate: null,
      status: 'pending' as const,
      ownerRole: 'cs',
      clientObligation: false,
      padDays: 0,
      note: null,
      ownerName: null,
      origin: 'template',
      offsetLabel: null,
      daysToTarget: null,
      ...over,
    });

  it('says how imminent a pending milestone is', { tags: ['important'] }, () => {
    expect(statusChip(view({}), '2026-08-18').label).toBe('Due 2d');
    expect(statusChip(view({}), '2026-08-20').label).toBe('Due today');
    // Far enough out to be nobody's problem today.
    expect(statusChip(view({}), '2026-08-10').label).toBe('Pending');
  });

  it('says how far gone an overdue one is', () => {
    expect(statusChip(view({}), '2026-08-23').label).toBe('Overdue 3d');
  });

  it('reads the actual, not the clock, once something has happened', () => {
    expect(statusChip(view({ actualDate: '2026-08-19', status: 'met' }), '2026-09-30').label).toBe('Met');
    expect(statusChip(view({ actualDate: '2026-08-25', status: 'late' }), '2026-09-30').label).toBe('Late');
  });
});

describe('firming against the quoted lead time', { tags: ['orders', 'schedule', 'important'] }, () => {
  it('reports nothing when the supplier can make the date', () => {
    // 1 week from 2026-08-15 is 2026-08-22, inside the committed 2026-08-31.
    expect(
      leadTimeSlip(
        [{ supplierId: 's1', supplierName: 'IDEMIA', weeks: 1 }],
        '2026-08-31',
        '2026-08-15',
      ),
    ).toBeNull();
  });

  it('names the supplier and the size of the slip', () => {
    const slip = leadTimeSlip(
      [
        { supplierId: 's1', supplierName: 'IDEMIA', weeks: 1 },
        { supplierId: 's2', supplierName: 'Thales', weeks: 4 },
      ],
      '2026-08-31',
      '2026-08-15',
    );
    // The LATEST supplier drives the final date, not the average.
    expect(slip?.supplierName).toBe('Thales');
    expect(slip?.earliest).toBe('2026-09-12');
    expect(slip?.daysLate).toBe(12);
  });

  it('ignores a supplier who quoted no lead time', { tags: ['edge-case'] }, () => {
    expect(
      leadTimeSlip([{ supplierId: 's1', supplierName: 'IDEMIA', weeks: 0 }], '2026-08-31', '2026-08-15'),
    ).toBeNull();
    expect(leadTimeSlip([], '2026-08-31', '2026-08-15')).toBeNull();
  });
});

describe('the two tables', { tags: ['orders', 'schedule', 'logic'] }, () => {
  const items = [
    { id: 'a', milestone_type: 'First Box Approval', sequence: 7, target_date: '2026-08-14', origin: 'template' },
    { id: 'b', milestone_type: 'Partial Ship', sequence: 8, target_date: '2026-08-22', origin: 'template' },
    { id: 'c', milestone_type: 'Press Check', sequence: 7, target_date: '2026-08-20', origin: 'added', owner_name: 'Thales QA' },
  ];

  it('reads as a timeline — by date, not by when it was added', { tags: ['important'] }, () => {
    const views = milestoneViews(items, '2026-08-31', '2026-08-15');
    expect(views.map((v) => v.milestoneType)).toEqual([
      'First Box Approval',
      'Press Check',
      'Partial Ship',
    ]);
  });

  it('separates the client-facing set from the operational one', { tags: ['important'] }, () => {
    const views = milestoneViews(items, '2026-08-31', '2026-08-15');
    // Schedule = the template set the client accepted; Milestones = everything.
    expect(views.filter((v) => v.origin === 'template')).toHaveLength(2);
    expect(views).toHaveLength(3);
  });

  it('treats a row written before origin existed as part of the template', { tags: ['edge-case'] }, () => {
    const [view] = milestoneViews([{ id: 'x', milestone_type: 'Final Ship', target_date: '2026-08-31' }], null, '2026-08-15');
    expect(view.origin).toBe('template');
  });

  it('puts a dateless milestone last rather than first', { tags: ['edge-case'] }, () => {
    const views = milestoneViews(
      [{ id: 'n', milestone_type: 'Unscheduled', sequence: 1 }, ...items],
      '2026-08-31',
      '2026-08-15',
    );
    expect(views[views.length - 1].milestoneType).toBe('Unscheduled');
  });

  it('slots an added milestone after whatever already falls that day', () => {
    // Ties on the same date fall back to sequence, so a press check booked for
    // the 22nd sits after the Partial Ship already due then.
    expect(sequenceForDate(items, '2026-08-22')).toBe(8);
    expect(sequenceForDate(items, '2026-08-01')).toBe(0);
  });
});
