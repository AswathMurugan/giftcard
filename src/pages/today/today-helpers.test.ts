import { describe, expect, it } from 'vitest';
import {
  atRiskCount,
  briefOf,
  daysUntil,
  decorateTasks,
  isTerminal,
  needsYouCount,
  openTasks,
  slaLabel,
  urgencyOf,
  type TaskBoardRow,
} from './today-helpers';

// Fixed clock so the buckets are deterministic.
const TODAY = new Date(2026, 7, 12); // 2026-08-12, local

describe('daysUntil', () => {
  it('counts forward and backward from today', () => {
    expect(daysUntil('2026-08-12', TODAY)).toBe(0);
    expect(daysUntil('2026-08-15', TODAY)).toBe(3);
    expect(daysUntil('2026-07-29', TODAY)).toBe(-14);
  });

  it('returns null for a missing or unparseable date', () => {
    expect(daysUntil(undefined, TODAY)).toBeNull();
    expect(daysUntil('', TODAY)).toBeNull();
    expect(daysUntil('not-a-date', TODAY)).toBeNull();
  });

  it('treats a date-only string as LOCAL, not UTC', () => {
    // Parsing "2026-08-12" via new Date() yields UTC midnight, which is
    // 2026-08-11 in any negative-offset zone — that would report -1 day and
    // wrongly mark today's work as overdue.
    expect(daysUntil('2026-08-12', new Date(2026, 7, 12, 23, 30))).toBe(0);
  });
});

describe('urgencyOf', () => {
  it('buckets by proximity', () => {
    expect(urgencyOf(-1)).toBe('late');
    expect(urgencyOf(0)).toBe('soon');
    expect(urgencyOf(3)).toBe('soon');
    expect(urgencyOf(4)).toBe('ontrack');
  });

  it('never marks unknown dates urgent', () => {
    expect(urgencyOf(null)).toBe('ontrack');
  });

  it('never marks terminal work urgent, however old', () => {
    expect(urgencyOf(-99, true)).toBe('ontrack');
  });
});

describe('isTerminal', () => {
  it('detects closed work by stage or state', () => {
    expect(isTerminal('Order Close', 'Closed')).toBe(true);
    expect(isTerminal('Order Close', null)).toBe(true);
    expect(isTerminal(null, 'Cancelled')).toBe(true);
    expect(isTerminal('Quote', 'Deal Review')).toBe(false);
    expect(isTerminal(null, null)).toBe(false);
  });
});

describe('slaLabel', () => {
  it('reads naturally on both sides of the due date', () => {
    expect(slaLabel(-1)).toBe('1 day late');
    expect(slaLabel(-14)).toBe('14 days late');
    expect(slaLabel(0)).toBe('Due today');
    expect(slaLabel(1)).toBe('Due tomorrow');
    expect(slaLabel(5)).toBe('5 days left');
    expect(slaLabel(null)).toBe('No date');
  });
});

describe('briefOf', () => {
  it('falls back to the order type when the brief is blank', () => {
    expect(briefOf({ order_brief: 'AAAA!@' })).toBe('AAAA!@');
    expect(briefOf({ order_brief: '   ', order_type: 'standard' })).toBe(
      'standard order',
    );
    expect(briefOf({})).toBe('No brief');
  });
});

describe('decorateTasks', () => {
  const rows: TaskBoardRow[] = [
    {
      id: 'c',
      order_code: 'GC-1015',
      requested_delivery: '2026-08-15',
      buyer_party_id: { name: 'IDEMIA' },
      // Closed but dated in the future — must not count as urgent.
      tq_instance: {
        current_task: { tq_sub_task_definition: { name: 'Order Close' } },
        current_status: { tq_state_definition: { state: 'Closed' } },
      },
    },
    {
      id: 'a',
      order_code: 'GC-1012',
      requested_delivery: '2026-07-29',
      buyer_party_id: { name: 'IDEMIA' },
      tq_instance: {
        current_task: { tq_sub_task_definition: { name: 'Produce' } },
        current_status: { tq_state_definition: { state: 'In Production' } },
      },
    },
    {
      id: 'b',
      order_code: 'GC-1010',
      requested_delivery: '2026-08-14',
      buyer_party_id: { name: 'Williams-Sonoma' },
      tq_instance: {
        current_task: { tq_sub_task_definition: { name: 'Specs' } },
        current_status: { tq_state_definition: { state: 'In Design' } },
      },
    },
  ];

  it('sorts most urgent first by requested delivery', () => {
    expect(decorateTasks(rows, TODAY).map((t) => t.code)).toEqual([
      'GC-1012',
      'GC-1010',
      'GC-1015',
    ]);
  });

  it('maps stage, state and buyer off the nested tq_instance', () => {
    const first = decorateTasks(rows, TODAY)[0];
    expect(first).toMatchObject({
      code: 'GC-1012',
      buyer: 'IDEMIA',
      stage: 'Produce',
      state: 'In Production',
      urgency: 'late',
      sla: '14 days late',
    });
  });

  it('labels terminal rows Closed instead of an SLA', () => {
    const closed = decorateTasks(rows, TODAY).find((t) => t.code === 'GC-1015');
    expect(closed).toMatchObject({ terminal: true, urgency: 'ontrack', sla: 'Closed' });
  });

  it('sorts undated rows last', () => {
    const withUndated = decorateTasks(
      [...rows, { id: 'z', order_code: 'GC-9999' }],
      TODAY,
    );
    expect(withUndated[withUndated.length - 1].code).toBe('GC-9999');
  });

  it('handles a missing list', () => {
    expect(decorateTasks(undefined, TODAY)).toEqual([]);
  });
});

describe('counts', () => {
  it('counts at-risk and needs-you independently of closed work', () => {
    const tasks = decorateTasks(
      [
        { id: '1', requested_delivery: '2026-07-29' }, // late
        { id: '2', requested_delivery: '2026-08-14' }, // soon
        { id: '3', requested_delivery: '2026-09-30' }, // on track
        {
          id: '4',
          requested_delivery: '2026-07-01', // long past, but closed
          tq_instance: {
            current_status: { tq_state_definition: { state: 'Closed' } },
          },
        },
      ],
      TODAY,
    );
    expect(atRiskCount(tasks)).toBe(1);
    expect(needsYouCount(tasks)).toBe(2);
  });
});

describe('openTasks', { tags: ['today', 'important'] }, () => {
  const task = (state: string | null) =>
    ({ key: state ?? 'none', state, stage: 'Order Close' }) as never;

  it('drops finished work — a to-do list is not a register', () => {
    // Today listed Closed orders under "open orders that need a decision
    // today" while the footer said "You're all caught up" in the same view.
    const out = openTasks([task('Closed'), task('Cancelled'), task('Proofing')]);
    expect(out.map((t) => t.state)).toEqual(['Proofing']);
  });

  it('KEEPS an order at Closing — it still needs someone to close it', () => {
    // `isTerminal` calls the whole Order Close stage terminal, but Closing is
    // not filed yet, and filing is exactly the decision this queue surfaces.
    expect(openTasks([task('Closing')]).map((t) => t.state)).toEqual(['Closing']);
  });

  it('keeps a row whose state never resolved', () => {
    expect(openTasks([task(null)])).toHaveLength(1);
  });
});

describe('openTasks', { tags: ['today', 'important'] }, () => {
  const task = (state: string | null) =>
    ({ key: state ?? 'none', state, stage: 'Order Close' }) as never;

  it('drops finished work — a to-do list is not a register', () => {
    // Today listed Closed orders under "open orders that need a decision
    // today" while the footer said "You're all caught up" in the same view.
    const out = openTasks([task('Closed'), task('Cancelled'), task('Proofing')]);
    expect(out.map((t) => t.state)).toEqual(['Proofing']);
  });

  it('KEEPS an order at Closing — it still needs someone to close it', () => {
    // `isTerminal` calls the whole Order Close stage terminal, but Closing is
    // not filed yet, and filing is exactly the decision this queue surfaces.
    expect(openTasks([task('Closing')]).map((t) => t.state)).toEqual(['Closing']);
  });

  it('keeps a row whose state never resolved', () => {
    expect(openTasks([task(null)])).toHaveLength(1);
  });
});
