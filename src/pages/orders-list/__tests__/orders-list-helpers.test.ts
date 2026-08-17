import { describe, it, expect } from 'vitest';
import {
  buyerName,
  byDeliverySoonest,
  daysUntil,
  filterOrders,
  isLate,
  isTerminal,
  liveState,
  matchesQuery,
  statesPresent,
  type OrderListRow,
} from '@/pages/orders-list/orders-list-helpers';

const TODAY = new Date(2026, 7, 13); // 13 Aug 2026, local

function row(over: Partial<OrderListRow> = {}): OrderListRow {
  return {
    id: 'o1',
    order_code: 'GC-1000',
    order_brief: 'Thank-You cards',
    requested_delivery: '2026-08-20',
    buyer_party_id: { id: 'b1', name: 'Sephora' },
    tq_instance: { current_status: { tq_state_definition: { state: 'In Design' } } },
    ...over,
  };
}

describe('orders-list-helpers', { tags: ['orders-list', 'logic'] }, () => {
  describe('liveState', { tags: ['important'] }, () => {
    it('reads the state off the task instance', () => {
      expect(liveState(row())).toBe('In Design');
    });

    it('reports Unknown when there is no instance', { tags: ['important'] }, () => {
      // There used to be an `orders.status` jsonb fallback here, and this test
      // asserted it returned "Order Received". That column was written once at
      // intake and never updated, so it reported "Order Received" for Closed
      // and Expired orders alike — it was dropped rather than maintained.
      // Unknown is now a real signal: every order with an instance has a
      // populated current_status, so seeing it means something is actually
      // wrong and should not be papered over with a stale value.
      expect(liveState(row({ tq_instance: null }))).toBe('Unknown');
    });

    it('reports Unknown rather than throwing on an empty row', { tags: ['edge-case'] }, () => {
      expect(liveState({})).toBe('Unknown');
    });
  });

  describe('daysUntil', { tags: ['important'] }, () => {
    it('counts forward in local time', () => {
      expect(daysUntil('2026-08-20', TODAY)).toBe(7);
    });

    it('returns a negative count for a past date', () => {
      expect(daysUntil('2026-08-10', TODAY)).toBe(-3);
    });

    it('is 0 on the day itself — not -1 from a UTC shift', { tags: ['edge-case'] }, () => {
      expect(daysUntil('2026-08-13', TODAY)).toBe(0);
    });

    it('returns null for missing or unparseable input', { tags: ['edge-case'] }, () => {
      expect(daysUntil(undefined, TODAY)).toBeNull();
      expect(daysUntil('', TODAY)).toBeNull();
      expect(daysUntil('not-a-date', TODAY)).toBeNull();
    });
  });

  describe('isLate / isTerminal', { tags: ['important'] }, () => {
    it('flags a past delivery on a running order', () => {
      expect(isLate(row({ requested_delivery: '2026-08-01' }), TODAY)).toBe(true);
    });

    it('never flags a closed order, whatever the date', () => {
      const closed = row({
        requested_delivery: '2026-01-01',
        tq_instance: { current_status: { tq_state_definition: { state: 'Closed' } } },
      });
      expect(isTerminal(closed)).toBe(true);
      expect(isLate(closed, TODAY)).toBe(false);
    });

    it('is not late with no delivery date', { tags: ['edge-case'] }, () => {
      expect(isLate(row({ requested_delivery: undefined }), TODAY)).toBe(false);
    });
  });

  describe('matchesQuery', { tags: ['smoke'] }, () => {
    it('matches code, brief, buyer and live state, case-insensitively', () => {
      expect(matchesQuery(row(), 'gc-1000')).toBe(true);
      expect(matchesQuery(row(), 'thank')).toBe(true);
      expect(matchesQuery(row(), 'SEPHORA')).toBe(true);
      expect(matchesQuery(row(), 'in design')).toBe(true);
    });

    it('an empty or whitespace query matches everything', { tags: ['edge-case'] }, () => {
      expect(matchesQuery(row(), '')).toBe(true);
      expect(matchesQuery(row(), '   ')).toBe(true);
    });

    it('does not match an unrelated term', () => {
      expect(matchesQuery(row(), 'zzz')).toBe(false);
    });
  });

  describe('filterOrders', { tags: ['important'] }, () => {
    const rows = [
      row({ id: 'a', order_code: 'GC-1' }),
      row({
        id: 'b',
        order_code: 'GC-2',
        requested_delivery: '2026-08-01',
        buyer_party_id: { name: 'Williams-Sonoma' },
      }),
      row({
        id: 'c',
        order_code: 'GC-3',
        tq_instance: { current_status: { tq_state_definition: { state: 'Closed' } } },
      }),
    ];

    it('combines query, state and late filters', () => {
      expect(
        filterOrders(rows, { query: '', state: 'Closed', lateOnly: false }, TODAY).map(
          (r) => r.id,
        ),
      ).toEqual(['c']);
    });

    it('late-only excludes the closed order even when overdue', () => {
      expect(
        filterOrders(rows, { query: '', state: '', lateOnly: true }, TODAY).map((r) => r.id),
      ).toEqual(['b']);
    });

    it('returns everything with no filters set', { tags: ['smoke'] }, () => {
      expect(filterOrders(rows, { query: '', state: '', lateOnly: false }, TODAY)).toHaveLength(
        3,
      );
    });
  });

  describe('statesPresent', () => {
    it('is distinct and sorted', () => {
      expect(
        statesPresent([
          row(),
          row(),
          row({ tq_instance: { current_status: { tq_state_definition: { state: 'Closed' } } } }),
        ]),
      ).toEqual(['Closed', 'In Design']);
    });
  });

  describe('byDeliverySoonest', { tags: ['edge-case'] }, () => {
    it('sorts ascending and puts undated orders last', () => {
      const sorted = byDeliverySoonest([
        row({ id: 'late', requested_delivery: '2026-09-01' }),
        row({ id: 'none', requested_delivery: undefined }),
        row({ id: 'soon', requested_delivery: '2026-08-14' }),
      ]);
      expect(sorted.map((r) => r.id)).toEqual(['soon', 'late', 'none']);
    });

    it('does not mutate its input', () => {
      const input = [row({ id: 'b', requested_delivery: '2026-09-01' }), row({ id: 'a' })];
      byDeliverySoonest(input);
      expect(input.map((r) => r.id)).toEqual(['b', 'a']);
    });
  });

  describe('buyerName', { tags: ['edge-case'] }, () => {
    it('falls back to a dash', () => {
      expect(buyerName(row({ buyer_party_id: null }))).toBe('—');
      expect(buyerName(row())).toBe('Sephora');
    });
  });
});
