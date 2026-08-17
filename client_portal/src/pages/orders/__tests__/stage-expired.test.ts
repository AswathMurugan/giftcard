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
