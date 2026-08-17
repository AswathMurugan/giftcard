import { describe, it, expect } from 'vitest';
import {
  outstandingRfeCount,
  settledRfeCount,
  collectionStatusLine,
  canProceedWithoutStragglers,
} from '@/pages/orders/quote-collection';

describe('quote-collection', { tags: ['order-quote', 'logic'] }, () => {
  describe('outstandingRfeCount', { tags: ['important'] }, () => {
    it('counts only RFEs still awaiting an answer', () => {
      expect(
        outstandingRfeCount([
          { status: 'sent' },
          { status: 'responded' },
          { status: 'sent' },
          { status: 'outdated' },
        ]),
      ).toBe(2);
    });

    it('treats draft RFEs as not yet outstanding', { tags: ['edge-case'] }, () => {
      expect(outstandingRfeCount([{ status: 'draft' }, { status: 'draft' }])).toBe(0);
    });

    it('is case-insensitive', { tags: ['edge-case'] }, () => {
      expect(outstandingRfeCount([{ status: 'SENT' }, { status: 'Sent' }])).toBe(2);
    });

    it('returns 0 for empty and undefined input', { tags: ['edge-case'] }, () => {
      expect(outstandingRfeCount([])).toBe(0);
      expect(outstandingRfeCount(undefined)).toBe(0);
    });

    /**
     * The declared type is `string`, but Phoenix returns what it returns. A
     * boolean or null reaching `.toLowerCase()` would throw inside a render
     * and blank the page, so the coercion is the point of the test.
     */
    it('survives non-string statuses', { tags: ['edge-case', 'error-boundary'] }, () => {
      expect(() =>
        outstandingRfeCount([
          { status: null },
          { status: undefined },
          { status: true as unknown as string },
          { status: 42 as unknown as string },
          {},
        ]),
      ).not.toThrow();
      expect(
        outstandingRfeCount([{ status: null }, { status: true as unknown as string }]),
      ).toBe(0);
    });
  });

  describe('settledRfeCount', { tags: ['logic'] }, () => {
    it('counts every terminal status', () => {
      expect(
        settledRfeCount([
          { status: 'responded' },
          { status: 'returned' },
          { status: 'outdated' },
          { status: 'cancelled' },
        ]),
      ).toBe(4);
    });

    it('excludes sent and draft', { tags: ['edge-case'] }, () => {
      expect(settledRfeCount([{ status: 'sent' }, { status: 'draft' }])).toBe(0);
    });
  });

  describe('collectionStatusLine', { tags: ['smoke'] }, () => {
    it('reports the split while suppliers are outstanding', () => {
      const line = collectionStatusLine([
        { status: 'responded' },
        { status: 'sent' },
        { status: 'sent' },
      ]);
      expect(line).toContain('Waiting on 2 of 3 suppliers');
    });

    it('returns null once nothing is outstanding', { tags: ['important'] }, () => {
      expect(collectionStatusLine([{ status: 'responded' }, { status: 'outdated' }])).toBeNull();
      expect(collectionStatusLine([])).toBeNull();
    });

    it('singularises a lone supplier', { tags: ['edge-case'] }, () => {
      expect(collectionStatusLine([{ status: 'sent' }])).toContain('1 of 1 supplier.');
    });
  });

  describe('canProceedWithoutStragglers', { tags: ['important'] }, () => {
    it('offers the escape hatch once some quotes are in', () => {
      expect(canProceedWithoutStragglers([{ status: 'responded' }, { status: 'sent' }])).toBe(true);
    });

    /**
     * Closing the round with nothing in hand would advance to Deal Review with
     * no quotes to compare — never the intent, so the action stays hidden.
     */
    it('withholds it when no supplier has answered', { tags: ['edge-case'] }, () => {
      expect(canProceedWithoutStragglers([{ status: 'sent' }, { status: 'sent' }])).toBe(false);
    });

    it('withholds it when nothing is outstanding', { tags: ['edge-case'] }, () => {
      expect(canProceedWithoutStragglers([{ status: 'responded' }])).toBe(false);
    });
  });
});
