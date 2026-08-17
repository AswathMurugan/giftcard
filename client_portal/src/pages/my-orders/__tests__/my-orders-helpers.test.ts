/**
 * What a client is allowed to see of Fiserv's process.
 *
 * The mapping is the point: Forge runs nine internal stages, Vista shows five.
 * "Quote" and "Award" deliberately collapse into "Preparing" — naming them on
 * a client's screen invites a conversation about our margin — so a test that
 * lets those two leak back out as distinct steps is catching a real leak, not
 * a cosmetic change.
 */
import { describe, it, expect } from 'vitest';
import {
  CLIENT_STAGES,
  clientStageIndexOf,
  decorateClientOrders,
} from '@/pages/my-orders/my-orders-helpers';
import type { ClientOrderListRow } from '@/types/saved-queries.generated';

/** A row shaped the way the saved query returns it. */
function row(over: {
  code?: string;
  stage?: string | null;
  state?: string | null;
  isFinal?: boolean | null;
  delivery?: string | null;
}): ClientOrderListRow {
  return {
    id: `id-${over.code ?? 'x'}`,
    order_code: over.code ?? 'GC-1000',
    order_brief: 'brief',
    requested_delivery: over.delivery ?? null,
    tq_instance: {
      current_task: over.stage
        ? { tq_sub_task_definition: { name: over.stage } }
        : null,
      current_status: {
        tq_state_definition: {
          state: over.state ?? 'Open',
          is_final: over.isFinal ?? false,
        },
      },
    },
  } as unknown as ClientOrderListRow;
}

describe('my-orders-helpers', { tags: ['my-orders', 'logic'] }, () => {
  describe('clientStageIndexOf', { tags: ['important'] }, () => {
    it('maps every internal stage Forge can be in', () => {
      expect(clientStageIndexOf('Order')).toBe(0);
      expect(clientStageIndexOf('Specs')).toBe(1);
      expect(clientStageIndexOf('Quote')).toBe(2);
      expect(clientStageIndexOf('Award')).toBe(2);
      expect(clientStageIndexOf('Produce')).toBe(3);
      expect(clientStageIndexOf('Proof')).toBe(3);
      expect(clientStageIndexOf('Ship')).toBe(4);
      expect(clientStageIndexOf('Bill')).toBe(4);
      expect(clientStageIndexOf('Order Close')).toBe(4);
    });

    it('collapses Quote and Award onto the same step', { tags: ['important'] }, () => {
      // The margin-privacy rule, asserted directly: a client must not be able
      // to tell "we are shopping this" from "we have picked a supplier".
      expect(clientStageIndexOf('Quote')).toBe(clientStageIndexOf('Award'));
      expect(CLIENT_STAGES[clientStageIndexOf('Quote')].label).toBe('Preparing');
    });

    it('never exposes an internal stage name as a client label', () => {
      const labels = CLIENT_STAGES.map((s) => s.label);
      for (const internal of ['Quote', 'Award', 'Specs', 'Produce', 'Bill']) {
        expect(labels).not.toContain(internal);
      }
    });

    it('returns -1 for a stage it does not know', { tags: ['edge-case'] }, () => {
      expect(clientStageIndexOf('Expired')).toBe(-1);
      expect(clientStageIndexOf('')).toBe(-1);
    });
  });

  describe('decorateClientOrders', { tags: ['smoke'] }, () => {
    it('returns [] for undefined and empty input', { tags: ['edge-case'] }, () => {
      expect(decorateClientOrders(undefined)).toEqual([]);
      expect(decorateClientOrders([])).toEqual([]);
    });

    it('drops rows with no id', { tags: ['edge-case'] }, () => {
      const bad = { order_code: 'GC-9999' } as unknown as ClientOrderListRow;
      expect(decorateClientOrders([bad])).toEqual([]);
    });

    it('shows a mid-flight order at its client-facing step', () => {
      const [r] = decorateClientOrders([row({ code: 'GC-1011', stage: 'Award' })]);
      expect(r.clientStage).toBe('Preparing');
      expect(r.stageIndex).toBe(2);
      expect(r.done).toBe(false);
      expect(r.expired).toBe(false);
    });

    it(
      'is complete only at the END of Order Close, not on arriving',
      { tags: ['important'] },
      () => {
        const arriving = decorateClientOrders([
          row({ stage: 'Order Close', state: 'Closing', isFinal: false }),
        ])[0];
        expect(arriving.done).toBe(false);

        const filed = decorateClientOrders([
          row({ stage: 'Order Close', state: 'Closed', isFinal: true }),
        ])[0];
        expect(filed.done).toBe(true);
      },
    );

    it('marks an expired order and never also calls it complete', { tags: ['important'] }, () => {
      const [r] = decorateClientOrders([
        row({ stage: 'Order Close', state: 'Expired', isFinal: true }),
      ]);
      expect(r.expired).toBe(true);
      expect(r.done).toBe(false);
      expect(r.clientStage).toBe('Expired');
    });

    it('falls back rather than throwing on a missing stage', { tags: ['edge-case'] }, () => {
      const [r] = decorateClientOrders([row({ stage: null, state: null })]);
      expect(r.stageIndex).toBe(-1);
      expect(r.clientStage).toBe('In progress');
      expect(r.blurb).toBe('With your account team');
    });

    it('substitutes placeholders for empty text fields', { tags: ['edge-case'] }, () => {
      const blank = {
        id: 'id-1',
        order_code: '',
        order_brief: '',
        requested_delivery: null,
        tq_instance: null,
      } as unknown as ClientOrderListRow;
      const [r] = decorateClientOrders([blank]);
      expect(r.code).toBe('—');
      expect(r.brief).toBe('No description');
      expect(r.requestedDelivery).toBeNull();
    });
  });
});
