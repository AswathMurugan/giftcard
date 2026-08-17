/**
 * The client's own view of one order.
 *
 * The load-bearing tests here are the privacy ones: a `deal_review` verdict is
 * Fiserv's internal margin sign-off, and letting one into "Your decisions"
 * would show a client that their deal was reviewed for profitability.
 */
import { describe, it, expect } from 'vitest';
import {
  buildEvents,
  buildTimeline,
  decorateOrderDetail,
  deliveryHealth,
  fromMicros,
  orderValueOf,
  usableImageSrc,
  type DetailDocument,
  type DetailLine,
} from '@/pages/my-orders/order-detail-helpers';
import type { ClientOrderDetailRow } from '@/types/saved-queries.generated';

function doc(over: Partial<DetailDocument>): DetailDocument {
  return {
    id: 'd1',
    version: 1,
    status: 'sent',
    totalSell: 3187.37,
    pdfName: null,
    sentAt: '2026-08-17T00:00:00Z',
    acceptedAt: null,
    ...over,
  };
}

describe('order-detail-helpers', { tags: ['order-detail', 'logic'] }, () => {
  describe('fromMicros', { tags: ['edge-case'] }, () => {
    it('handles absent values', () => {
      expect(fromMicros(3_187_370_000)).toBeCloseTo(3187.37, 2);
      expect(fromMicros(null)).toBe(0);
    });
  });

  describe('orderValueOf', { tags: ['important'] }, () => {
    it('prefers priced lines when they exist', () => {
      const lines = [{ amount: 100 }, { amount: 50 }] as DetailLine[];
      expect(orderValueOf(lines, [doc({})])).toEqual({ orderValue: 150, valueSource: 'lines' });
    });

    it('falls back to the proposal rather than saying "not priced"', () => {
      // Demand lines often carry no unit_price; pricing lives on the proposal.
      // Reporting "not priced yet" beside a signed $3,187.37 document reads as
      // a contradiction on the client's own screen.
      const r = orderValueOf([], [doc({})]);
      expect(r.valueSource).toBe('proposal');
      expect(r.orderValue).toBeCloseTo(3187.37, 2);
    });

    it('prefers what was signed over a later unsigned version', () => {
      const signed = doc({ id: 'v1', version: 1, totalSell: 100, acceptedAt: '2026-08-18' });
      const newer = doc({ id: 'v2', version: 2, totalSell: 900 });
      // documents arrive newest-first
      expect(orderValueOf([], [newer, signed]).orderValue).toBe(100);
    });

    it('is null when there is nothing to price from', { tags: ['edge-case'] }, () => {
      expect(orderValueOf([], [])).toEqual({ orderValue: null, valueSource: null });
    });
  });

  describe('buildEvents', { tags: ['important'] }, () => {
    it('never surfaces an internal deal review', () => {
      const packet = {
        verdicts: [
          {
            id: 'v-internal',
            decision: 'approve',
            decided_at: '2026-08-16T00:00:00Z',
            comment: 'Margins reviewed against the supplier quotes.',
            review_request: { review_kind: 'deal_review', round: 1 },
          },
          {
            id: 'v-client',
            decision: 'approve',
            decided_at: '2026-08-17T00:00:00Z',
            review_request: { review_kind: 'proof', proof_type: 'Art proof', round: 1 },
          },
        ],
      } as unknown as ClientOrderDetailRow;
      const events = buildEvents(packet);
      expect(events).toHaveLength(1);
      expect(events[0].id).toBe('v-client');
      expect(JSON.stringify(events)).not.toContain('Margins');
    });

    it('records a signed proposal and orders events oldest first', () => {
      const packet = {
        verdicts: [
          {
            id: 'v1',
            decision: 'reject',
            decided_at: '2026-08-18T00:00:00Z',
            review_request: { review_kind: 'proof', proof_type: 'Art proof', round: 2 },
          },
        ],
        proposals: [{ id: 'p1', version: 1, accepted_at: '2026-08-17T00:00:00Z' }],
      } as unknown as ClientOrderDetailRow;
      const events = buildEvents(packet);
      expect(events.map((e) => e.what)).toEqual(['Proposal signed', 'Changes requested']);
    });

    it('returns [] for nothing', { tags: ['edge-case'] }, () => {
      expect(buildEvents(null)).toEqual([]);
      expect(buildEvents({} as ClientOrderDetailRow)).toEqual([]);
    });
  });

  describe('decorateOrderDetail', { tags: ['smoke'] }, () => {
    it('returns null without an order', { tags: ['edge-case'] }, () => {
      expect(decorateOrderDetail(null)).toBeNull();
      expect(decorateOrderDetail({} as ClientOrderDetailRow)).toBeNull();
    });

    it('hides draft proposals and internal reviews', { tags: ['important'] }, () => {
      const packet = {
        order: {
          id: 'o1',
          order_code: 'GC-1012',
          tq_instance: {
            current_task: { tq_sub_task_definition: { name: 'Order Close' } },
            current_status: { tq_state_definition: { state: 'Closed', is_final: true } },
          },
        },
        proposals: [
          { id: 'p-draft', version: 2, status: 'draft', total_sell_micros: 999_000_000 },
          { id: 'p-sent', version: 1, status: 'accepted', total_sell_micros: 100_000_000 },
        ],
        reviews: [
          { id: 'r-deal', review_kind: 'deal_review', round: 1, status: 'approved' },
          { id: 'r-proof', review_kind: 'proof', round: 1, status: 'approved' },
        ],
      } as unknown as ClientOrderDetailRow;
      const d = decorateOrderDetail(packet)!;
      expect(d.documents.map((x) => x.id)).toEqual(['p-sent']);
      expect(d.proofs.map((x) => x.id)).toEqual(['r-proof']);
      expect(d.done).toBe(true);
    });

    it('an expired order is never also complete', { tags: ['important'] }, () => {
      const packet = {
        order: {
          id: 'o1',
          order_code: 'GC-1',
          tq_instance: {
            current_task: { tq_sub_task_definition: { name: 'Order Close' } },
            current_status: { tq_state_definition: { state: 'Expired', is_final: true } },
          },
        },
      } as unknown as ClientOrderDetailRow;
      const d = decorateOrderDetail(packet)!;
      expect(d.expired).toBe(true);
      expect(d.done).toBe(false);
    });
  });
});

describe('usableImageSrc', { tags: ['order-detail', 'important'] }, () => {
  it('accepts a data URI and an http URL', () => {
    expect(usableImageSrc('data:image/png;base64,iVBORw0K')).toBe(
      'data:image/png;base64,iVBORw0K',
    );
    expect(usableImageSrc('https://cdn.example/card.png')).toBe(
      'https://cdn.example/card.png',
    );
  });

  it('rejects an object, which is what this column actually returns', () => {
    // `artwork_preview` is {front, back, carrier} despite being declared a
    // string. Passing it straight to an <img src> rendered "[object Object]"
    // and produced a broken-image icon with no error anywhere.
    expect(usableImageSrc({ front: 'data:image/png;base64,x' })).toBeNull();
    expect(usableImageSrc(['data:image/png;base64,x'])).toBeNull();
  });

  it('rejects anything a browser cannot load', () => {
    expect(usableImageSrc(null)).toBeNull();
    expect(usableImageSrc(undefined)).toBeNull();
    expect(usableImageSrc('')).toBeNull();
    expect(usableImageSrc('   ')).toBeNull();
    expect(usableImageSrc('not-a-url')).toBeNull();
    // No javascript: or other scheme sneaking into an src.
    expect(usableImageSrc('javascript:alert(1)')).toBeNull();
  });
});

describe('deliveryHealth', { tags: ['order-detail', 'logic'] }, () => {
  const TODAY = '2026-08-17';

  it('is on track before the target date', () => {
    expect(deliveryHealth('2026-12-18', false, false, TODAY)).toEqual({
      health: 'on-track',
      healthLabel: 'On track',
    });
  });

  it('is past target once the date has gone by', () => {
    expect(deliveryHealth('2026-08-01', false, false, TODAY).health).toBe('late');
  });

  it('is on track on the target day itself', { tags: ['edge-case'] }, () => {
    expect(deliveryHealth(TODAY, false, false, TODAY).health).toBe('on-track');
  });

  it('reports delivered rather than late once complete', { tags: ['important'] }, () => {
    // A finished order must not be scolded for a date that has passed.
    expect(deliveryHealth('2026-01-01', true, false, TODAY)).toEqual({
      health: 'done',
      healthLabel: 'Delivered',
    });
  });

  it('an expired order outranks both', { tags: ['important'] }, () => {
    expect(deliveryHealth('2026-01-01', true, true, TODAY).health).toBe('expired');
  });

  it('is on track when no target date was given', { tags: ['edge-case'] }, () => {
    expect(deliveryHealth(null, false, false, TODAY).health).toBe('on-track');
  });
});

describe('buildTimeline', { tags: ['order-detail', 'important'] }, () => {
  const proof = {
    id: 'r1',
    proofType: 'Art proof',
    round: 3,
    status: 'requested',
    fileName: null,
    requestedAt: null,
    awaitingYou: true,
  };

  it('marks earlier steps done and the current one current', () => {
    const t = buildTimeline('Produce', 'GC-1013', null, false);
    const byLabel = Object.fromEntries(t.map((s) => [s.label, s.status]));
    expect(byLabel['Order placed']).toBe('done');
    expect(byLabel['Quote accepted']).toBe('done');
    expect(byLabel['In production']).toBe('current');
    expect(byLabel['Shipped']).toBe('ahead');
  });

  it('names the round the client is actually waiting on', () => {
    const t = buildTimeline('Proof', 'GC-1013', proof, false);
    const step = t.find((s) => s.label === 'Proof ready')!;
    expect(step.caption).toContain('Art proof v3');
    expect(step.caption).toContain('awaiting your approval');
  });

  it('never claims "awaiting your approval" on a settled order', { tags: ['important'] }, () => {
    // The generic caption reads "Awaiting your approval" — on an order the
    // client already signed off that is simply false.
    const t = buildTimeline('Order Close', 'GC-1013', null, true);
    const step = t.find((s) => s.label === 'Proof ready')!;
    expect(step.caption).toBe('Approved by you');
    expect(t.every((s) => s.status === 'done')).toBe(true);
  });

  it('says a proof has not been sent when the order is not there yet', { tags: ['edge-case'] }, () => {
    const t = buildTimeline('Specs', 'GC-1013', null, false);
    expect(t.find((s) => s.label === 'Proof ready')!.caption).toBe('Not sent yet');
  });

  it('stamps the order code onto the first step', () => {
    const t = buildTimeline('Order', 'GC-1013', null, false);
    expect(t[0].caption).toBe('GC-1013 created in Forge');
  });

  it('holds every step ahead when the stage is unknown', { tags: ['edge-case'] }, () => {
    const t = buildTimeline('', 'GC-1013', null, false);
    expect(t.every((s) => s.status === 'ahead')).toBe(true);
  });
});
