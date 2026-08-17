/**
 * Expiry and the stage strip.
 *
 * `Expired` is reachable from ANY stage, so it deliberately carries no
 * `previous_task`/`next_task` and lands last in the strip. That breaks the
 * rule the strip was built on — "everything before the current stage is
 * done" — because an order that expired at Specs has a current index of 9
 * while having touched only two stages. It rendered Quote, Award, Produce,
 * Proof, Ship, Bill and Order Close as finished work that never happened.
 *
 * Two things follow from reading the trail instead of the index:
 *   - stages never entered stay grey, wherever they sit;
 *   - the stage whose wait ran out is FAILED, not done. `Expired` is where
 *     the order ended up, not where it went wrong, and it never earns a
 *     success tick — expiry is an outcome, not an accomplishment.
 */
import { describe, it, expect } from 'vitest';
import {
  decorateStages,
  failedStageOf,
  orderStages,
  type StageDefinition,
} from '@/pages/orders/stage-helpers';

/** The real shape: a linked chain plus an out-of-chain terminal stage. */
const STAGES: StageDefinition[] = [
  {
    id: 'o',
    name: 'Order',
    is_initial: true,
    next_task: { id: 'sp' },
    states: [
      { state: 'Order Received', is_initial: true },
      { state: 'Order In progress', is_final: true },
    ],
  },
  {
    id: 'sp',
    name: 'Specs',
    previous_task: { id: 'o' },
    next_task: { id: 'q' },
    states: [
      { state: 'In Design', is_initial: true },
      { state: 'Approved', is_final: true },
    ],
  },
  {
    id: 'q',
    name: 'Quote',
    previous_task: { id: 'sp' },
    next_task: { id: 'oc' },
    states: [{ state: 'Quote Requested', is_initial: true }],
  },
  {
    id: 'oc',
    name: 'Order Close',
    previous_task: { id: 'q' },
    is_final: true,
    states: [
      { state: 'Closing', is_initial: true },
      { state: 'Closed', is_final: true },
    ],
  },
  // No links either side — expiry can strike from anywhere.
  {
    id: 'x',
    name: 'Expired',
    is_final: true,
    previous_task: null,
    next_task: null,
    states: [{ state: 'Expired', is_initial: true, is_final: true }],
  },
];

const byName = (stages: ReturnType<typeof decorateStages>) =>
  Object.fromEntries(stages.map((s) => [s.name, s.status]));

/** Trail of an order that expired waiting at Specs. */
const EXPIRED_AT_SPECS = ['Order', 'Specs', 'Expired'];

describe('failedStageOf', { tags: ['orders', 'logic'] }, () => {
  it('names the stage the order was sitting on when it expired', () => {
    expect(failedStageOf(EXPIRED_AT_SPECS)).toBe('Specs');
    expect(failedStageOf(['Order', 'Specs', 'Quote', 'Expired'])).toBe('Quote');
  });

  it('returns null when the order never expired', { tags: ['edge-case'] }, () => {
    expect(failedStageOf(['Order', 'Specs', 'Quote'])).toBeNull();
    expect(failedStageOf([])).toBeNull();
  });

  it('handles a trail with nothing before Expired', { tags: ['edge-case'] }, () => {
    expect(failedStageOf(['Expired'])).toBeNull();
  });
});

describe('Expired in the stage strip', { tags: ['orders', 'important'] }, () => {
  it('renders Expired last even though it has no chain links', { tags: ['smoke'] }, () => {
    expect(orderStages(STAGES).map((s) => s.name)).toEqual([
      'Order',
      'Specs',
      'Quote',
      'Order Close',
      'Expired',
    ]);
  });

  /**
   * `Expired` is an OUTCOME, not a step. Shown on every order it rendered a
   * permanent dead-end pip after Order Close on healthy orders, implying a
   * stage still to come that never arrives.
   */
  it('is hidden entirely on an order that never expired', { tags: ['important'] }, () => {
    const healthy = decorateStages(STAGES, 'Quote', 'Quote Requested', [
      'Order',
      'Specs',
      'Quote',
    ]);
    expect(healthy.map((s) => s.name)).toEqual(['Order', 'Specs', 'Quote', 'Order Close']);
  });

  it('is hidden on a closed order, whose strip ends at Order Close', { tags: ['important'] }, () => {
    const closed = decorateStages(STAGES, 'Order Close', 'Closed', [
      'Order',
      'Specs',
      'Quote',
      'Order Close',
    ]);
    expect(closed.some((s) => s.name === 'Expired')).toBe(false);
    expect(closed[closed.length - 1].name).toBe('Order Close');
  });

  it('still shows Expired once the order has expired', { tags: ['important'] }, () => {
    const expired = decorateStages(STAGES, 'Expired', 'Expired', EXPIRED_AT_SPECS);
    expect(expired.some((s) => s.name === 'Expired')).toBe(true);
  });

  /**
   * With no trail at all the helper cannot tell a healthy order from an expired
   * one, so it hides Expired rather than showing a dead end to every order.
   */
  it('hides Expired when there is no trail to judge by', { tags: ['edge-case'] }, () => {
    expect(decorateStages(STAGES, 'Quote', 'Quote Requested').some((s) => s.name === 'Expired')).toBe(
      false,
    );
  });

  it('marks the timed-out stage failed and everything unreached grey', { tags: ['important'] }, () => {
    const status = byName(decorateStages(STAGES, 'Expired', 'Expired', EXPIRED_AT_SPECS));
    expect(status).toEqual({
      Order: 'done', // genuinely completed
      Specs: 'failed', // the wait that ran out
      Quote: 'todo',
      'Order Close': 'todo',
      Expired: 'todo', // never a success tick
    });
  });

  it('never shows a green tick anywhere after the failure', { tags: ['important'] }, () => {
    const stages = decorateStages(STAGES, 'Expired', 'Expired', EXPIRED_AT_SPECS);
    const after = stages.slice(stages.findIndex((s) => s.status === 'failed') + 1);
    expect(after.every((s) => s.status === 'todo')).toBe(true);
  });

  it('does not mark a skipped stage done just because it sits earlier', { tags: ['edge-case'] }, () => {
    // Position alone would call Quote done — it is at a lower index than
    // Expired. It never ran.
    expect(byName(decorateStages(STAGES, 'Expired', 'Expired', EXPIRED_AT_SPECS)).Quote).toBe(
      'todo',
    );
  });

  it('expiring later keeps the earlier stages done', { tags: ['logic'] }, () => {
    const status = byName(
      decorateStages(STAGES, 'Expired', 'Expired', ['Order', 'Specs', 'Quote', 'Expired']),
    );
    expect(status).toEqual({
      Order: 'done',
      Specs: 'done',
      Quote: 'failed',
      'Order Close': 'todo',
      Expired: 'todo',
    });
  });

  it('leaves Expired grey on an order that is still running', { tags: ['important'] }, () => {
    const status = byName(
      decorateStages(STAGES, 'Quote', 'Quote Requested', ['Order', 'Specs', 'Quote']),
    );
    expect(status).toEqual({
      Order: 'done',
      Specs: 'done',
      Quote: 'current',
      'Order Close': 'todo',
      Expired: 'todo',
    });
  });

  it('a normally closed order shows no failure and no Expired', { tags: ['logic'] }, () => {
    const status = byName(
      decorateStages(STAGES, 'Order Close', 'Closed', ['Order', 'Specs', 'Quote', 'Order Close']),
    );
    expect(status['Order Close']).toBe('done');
    expect(status.Expired).toBe('todo');
    expect(Object.values(status)).not.toContain('failed');
  });

  it('falls back to position when no trail is supplied', { tags: ['edge-case'] }, () => {
    // Callers without history keep the old behaviour rather than losing every
    // completed pip.
    const status = byName(decorateStages(STAGES, 'Quote', 'Quote Requested'));
    expect(status).toEqual({
      Order: 'done',
      Specs: 'done',
      Quote: 'current',
      'Order Close': 'todo',
      Expired: 'todo',
    });
  });

  it('an empty trail marks nothing done', { tags: ['edge-case'] }, () => {
    const status = byName(decorateStages(STAGES, 'Order', 'Order Received', []));
    expect(status).toEqual({
      Order: 'current',
      Specs: 'todo',
      Quote: 'todo',
      'Order Close': 'todo',
      Expired: 'todo',
    });
  });
});

describe('a second process in the tenant', { tags: ['orders', 'important'] }, () => {
  /**
   * Supply orders got their own three-stage process on 2026-08-17. Because
   * `tq_stage_list` is unfiltered, those stages arrive in the same payload as
   * the demand ones, and a blanket "append everything unreached" put PO
   * Acknowledge / PO Production / PO Dispatch on the end of every client
   * order's strip.
   */
  const WITH_PO: StageDefinition[] = [
    ...STAGES,
    {
      id: 'po1',
      name: 'PO Acknowledge',
      is_initial: true,
      next_task: { id: 'po2' },
      states: [{ state: 'PO Raised', is_initial: true }],
    },
    {
      id: 'po2',
      name: 'PO Production',
      previous_task: { id: 'po1' },
      next_task: { id: 'po3' },
      states: [{ state: 'PO In Production', is_initial: true }],
    },
    {
      id: 'po3',
      name: 'PO Dispatch',
      previous_task: { id: 'po2' },
      is_final: true,
      states: [{ state: 'PO Shipped', is_final: true }],
    },
  ];

  it('keeps another process off this order’s strip', () => {
    const names = orderStages(WITH_PO).map((s) => s.name);
    expect(names).not.toContain('PO Acknowledge');
    expect(names).not.toContain('PO Production');
    expect(names).not.toContain('PO Dispatch');
  });

  it('still shows the standalone Expired stage', () => {
    // Expired has no links either side — reachable from anywhere, so it is
    // the one unreached stage that genuinely belongs on every strip.
    expect(orderStages(WITH_PO).map((s) => s.name)).toEqual([
      'Order',
      'Specs',
      'Quote',
      'Order Close',
      'Expired',
    ]);
  });
});
