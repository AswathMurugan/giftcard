/**
 * Which proposal a client can sign.
 *
 * Two rules carry real money: a DRAFT must never reach the client (it is
 * pricing nobody put to them), and only the LIVE version is signable (signing
 * a superseded one accepts a price that has been replaced).
 */
import { describe, it, expect } from 'vitest';
import {
  decorateApprovals,
  formatUsd,
  fromMicros,
  waitingCount,
} from '@/pages/approvals/approval-helpers';
import type { ClientProposalListRow } from '@/types/saved-queries.generated';

function prop(over: Partial<Record<string, unknown>>): ClientProposalListRow {
  return {
    id: 'p1',
    version: 1,
    currency: 'USD',
    status: 'sent',
    total_sell_micros: 3_187_370_000,
    sent_at: '2026-08-17T00:00:00Z',
    accepted_at: null,
    order_ref: { id: 'ord-1', order_code: 'GC-1011', order_brief: 'brief' },
    ...over,
  } as unknown as ClientProposalListRow;
}

describe('approval-helpers', { tags: ['approvals', 'logic'] }, () => {
  describe('fromMicros', { tags: ['edge-case'] }, () => {
    it('converts and tolerates nothing', () => {
      expect(fromMicros(3_187_370_000)).toBeCloseTo(3187.37, 2);
      expect(fromMicros(null)).toBe(0);
      expect(fromMicros(undefined)).toBe(0);
      expect(fromMicros(0)).toBe(0);
    });
  });

  describe('formatUsd', { tags: ['smoke'] }, () => {
    it('always shows cents', () => {
      expect(formatUsd(3187.37)).toBe('$3,187.37');
      expect(formatUsd(0)).toBe('$0.00');
    });
  });

  describe('decorateApprovals', { tags: ['important'] }, () => {
    it('returns [] for undefined and empty input', { tags: ['edge-case'] }, () => {
      expect(decorateApprovals(undefined)).toEqual([]);
      expect(decorateApprovals([])).toEqual([]);
    });

    it('never shows a draft', { tags: ['important'] }, () => {
      const rows = decorateApprovals([prop({ status: 'draft' })]);
      expect(rows).toEqual([]);
    });

    it('marks the live issued version as awaiting signature', () => {
      const [row] = decorateApprovals([prop({})]);
      expect(row.awaitingYou).toBe(true);
      expect(row.label).toBe('Awaiting your signature');
      expect(row.totalSell).toBeCloseTo(3187.37, 2);
    });

    it('only the highest version is signable', { tags: ['important'] }, () => {
      const rows = decorateApprovals([
        prop({ id: 'v1', version: 1, status: 'sent' }),
        prop({ id: 'v2', version: 2, status: 'sent' }),
      ]);
      const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
      expect(byId.v2.awaitingYou).toBe(true);
      // v1 is history even though the backend still calls it 'sent'.
      expect(byId.v1.awaitingYou).toBe(false);
      expect(waitingCount(rows)).toBe(1);
    });

    it('an accepted proposal is not awaiting anyone', () => {
      const [row] = decorateApprovals([
        prop({ status: 'accepted', accepted_at: '2026-08-18T00:00:00Z' }),
      ]);
      expect(row.awaitingYou).toBe(false);
      expect(row.label).toBe('Signed');
    });

    it('a sent row with an acceptance date is already answered', { tags: ['edge-case'] }, () => {
      // Status and timestamp can disagree; the timestamp is the fact.
      const [row] = decorateApprovals([
        prop({ status: 'sent', accepted_at: '2026-08-18T00:00:00Z' }),
      ]);
      expect(row.awaitingYou).toBe(false);
    });

    it('scopes the live version per order, not globally', { tags: ['important'] }, () => {
      const rows = decorateApprovals([
        prop({ id: 'a', version: 3, order_ref: { id: 'ord-A', order_code: 'GC-1' } }),
        prop({ id: 'b', version: 1, order_ref: { id: 'ord-B', order_code: 'GC-2' } }),
      ]);
      // Order B's v1 is its own live version, despite being lower than A's v3.
      expect(rows.every((r) => r.awaitingYou)).toBe(true);
      expect(waitingCount(rows)).toBe(2);
    });

    it('puts what needs signing first', { tags: ['smoke'] }, () => {
      const rows = decorateApprovals([
        prop({ id: 'old', version: 1, status: 'accepted', accepted_at: '2026-01-01T00:00:00Z' }),
        prop({ id: 'new', version: 2, status: 'sent' }),
      ]);
      expect(rows[0].id).toBe('new');
    });
  });
});
