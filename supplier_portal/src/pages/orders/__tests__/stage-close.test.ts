/**
 * Finishing the last stage.
 *
 * Every other stage is shown as done by the order having LEFT it, which is a
 * rule the last stage can never satisfy — nothing follows Order Close to push
 * it into the past. A delivered, invoiced order therefore sat on a gold "in
 * progress" pip forever, and the one signal that finishes the run was never
 * offered, because arriving at the stage was being read as the end of it.
 *
 * Order Close runs `Closing` → `Closed`. The end is the second of those.
 */
import { describe, it, expect } from 'vitest';
import {
  decorateStages,
  isFinalState,
  type StageDefinition,
} from '@/pages/orders/stage-helpers';

/** Three stages, linked, with the last one carrying two states. */
const STAGES: StageDefinition[] = [
  {
    id: 's1',
    name: 'Ship',
    is_initial: true,
    next_task: { id: 's2' },
    states: [{ state: 'Ready to Ship', is_initial: true }],
  },
  {
    id: 's2',
    name: 'Bill',
    next_task: { id: 's3' },
    previous_task: { id: 's1' },
    states: [{ state: 'Billing', is_initial: true }],
  },
  {
    id: 's3',
    name: 'Order Close',
    is_final: true,
    previous_task: { id: 's2' },
    states: [
      { state: 'Closing', is_initial: true, is_final: false },
      { state: 'Closed', is_initial: false, is_final: true },
    ],
  },
];

const statuses = (stateName?: string | null) =>
  decorateStages(STAGES, 'Order Close', stateName).map((s) => s.status);

describe('isFinalState', () => {
  it('is true only for the stage’s last state', () => {
    expect(isFinalState(STAGES, 'Order Close', 'Closed')).toBe(true);
    expect(isFinalState(STAGES, 'Order Close', 'Closing')).toBe(false);
  });

  it('is false for a state belonging to another stage', () => {
    expect(isFinalState(STAGES, 'Bill', 'Closed')).toBe(false);
  });

  it('is false when either side is missing', () => {
    expect(isFinalState(STAGES, 'Order Close', null)).toBe(false);
    expect(isFinalState(STAGES, null, 'Closed')).toBe(false);
    expect(isFinalState(undefined, 'Order Close', 'Closed')).toBe(false);
  });
});

describe('decorateStages on the final stage', () => {
  it('ticks Order Close once the order is Closed', () => {
    expect(statuses('Closed')).toEqual(['done', 'done', 'done']);
  });

  it('leaves it current while it is still Closing', () => {
    expect(statuses('Closing')).toEqual(['done', 'done', 'current']);
  });

  it('leaves it current when no state is supplied at all', () => {
    // The state argument is optional — a caller that only knows the stage name
    // must keep the behaviour it had before, not accidentally tick the strip.
    expect(statuses()).toEqual(['done', 'done', 'current']);
    expect(statuses(null)).toEqual(['done', 'done', 'current']);
  });

  it('does not tick a mid-process stage that has no final state', () => {
    // Bill's only state is not marked final, so being on it means being IN it.
    const s = decorateStages(STAGES, 'Bill', 'Billing').map((x) => x.status);
    expect(s).toEqual(['done', 'current', 'todo']);
  });

  it('still marks everything todo when the stage is unknown', () => {
    const s = decorateStages(STAGES, 'Nowhere', 'Closed').map((x) => x.status);
    expect(s).toEqual(['todo', 'todo', 'todo']);
  });

  it('keeps the stage order it walked from the links', () => {
    expect(decorateStages(STAGES, 'Order Close', 'Closed').map((s) => s.name)).toEqual([
      'Ship',
      'Bill',
      'Order Close',
    ]);
  });
});
