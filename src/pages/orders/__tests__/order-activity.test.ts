import { describe, it, expect } from 'vitest';
import {
  buildActivity,
  relativeTime,
  activitySourcesFromFeed,
  signatoryFrom,
} from '@/pages/orders/order-activity';

const T = (iso: string) => iso;

describe('order-activity', { tags: ['order-activity', 'logic'] }, () => {
  describe('buildActivity', { tags: ['important'] }, () => {
    it('merges every source newest-first', { tags: ['smoke'] }, () => {
      const entries = buildActivity({
        order: { created_at: T('2026-08-10T09:00:00Z') },
        history: [
          {
            id: 'h1',
            created_at: T('2026-08-11T09:00:00Z'),
            tq_state_definition: { state: 'Approved' },
            tq_sub_task_instance: { tq_sub_task_definition: { name: 'Specs' } },
          },
        ],
        rfes: [{ id: 'r1', sent_at: T('2026-08-12T09:00:00Z'), supplier: { name: 'Thales' } }],
        quotes: [
          {
            id: 'q1',
            round: 1,
            submitted_at: T('2026-08-13T09:00:00Z'),
            supplier_quote_no: 'THL-9',
            rfe: { supplier: { name: 'Thales' } },
          },
        ],
      });

      expect(entries.map((e) => e.kind)).toEqual([
        'quote_received',
        'rfe_sent',
        'stage',
        'created',
      ]);
      expect(entries[0].title).toBe('Thales quote received — THL-9');
      expect(entries[1].title).toBe('Quote request sent to Thales');
    });

    it('phrases known states and falls back to the raw name', () => {
      const [approved] = buildActivity({
        history: [
          {
            id: 'a',
            created_at: T('2026-08-11T09:00:00Z'),
            tq_state_definition: { state: 'Approved' },
            tq_sub_task_instance: { tq_sub_task_definition: { name: 'Specs' } },
          },
        ],
      });
      expect(approved.title).toBe('Specifications validated');

      const [unknownState] = buildActivity({
        history: [
          {
            id: 'b',
            created_at: T('2026-08-11T09:00:00Z'),
            tq_state_definition: { state: 'Brand New State' },
            tq_sub_task_instance: { tq_sub_task_definition: { name: 'Ship' } },
          },
        ],
      });
      // Falls through rather than vanishing — an unmapped state must still be
      // auditable.
      expect(unknownState.title).toBe('Ship — Brand New State');
    });

    it('mentions the round only on a re-quote', { tags: ['edge-case'] }, () => {
      const [first] = buildActivity({
        quotes: [
          {
            id: 'q1',
            round: 1,
            submitted_at: T('2026-08-13T09:00:00Z'),
            rfe: { supplier: { name: 'CPI' } },
          },
        ],
      });
      expect(first.title).toBe('CPI quote received');

      const [second] = buildActivity({
        quotes: [
          {
            id: 'q2',
            round: 2,
            submitted_at: T('2026-08-14T09:00:00Z'),
            rfe: { supplier: { name: 'CPI' } },
          },
        ],
      });
      expect(second.title).toBe('CPI quote received (round 2)');
    });

    /**
     * An undated line still implies a position in the sequence, which is worse
     * than omitting it from an audit trail.
     */
    it('drops entries with no parseable timestamp', { tags: ['important', 'edge-case'] }, () => {
      const entries = buildActivity({
        order: { created_at: null },
        rfes: [
          { id: 'r1', sent_at: '', supplier: { name: 'A' } },
          { id: 'r2', sent_at: 'not-a-date', supplier: { name: 'B' } },
          { id: 'r3', sent_at: T('2026-08-12T09:00:00Z'), supplier: { name: 'C' } },
        ],
      });
      expect(entries).toHaveLength(1);
      expect(entries[0].title).toBe('Quote request sent to C');
    });

    it('survives non-string values from the API', { tags: ['edge-case', 'error-boundary'] }, () => {
      expect(() =>
        buildActivity({
          order: { created_at: 42 as unknown as string },
          history: [{ id: null, created_at: true as unknown as string }],
          rfes: [{ id: 7 as unknown as string, sent_at: null, supplier: null }],
          quotes: [{ id: null, submitted_at: undefined, rfe: null }],
        }),
      ).not.toThrow();
    });

    it('names an unnamed supplier without printing undefined', { tags: ['edge-case'] }, () => {
      const [entry] = buildActivity({
        rfes: [{ id: 'r1', sent_at: T('2026-08-12T09:00:00Z'), supplier: { name: null } }],
      });
      expect(entry.title).toBe('Quote request sent to a supplier');
    });

    it('returns an empty list for empty sources', { tags: ['edge-case'] }, () => {
      expect(buildActivity({})).toEqual([]);
    });
  });

  describe('signatoryFrom', { tags: ['important'] }, () => {
    it('strips the certificate pointer and the leading verb', () => {
      expect(
        signatoryFrom('Signed by Dana Whitfield [certificate:01M08H:GC-1017-sig.pdf]'),
      ).toBe('Dana Whitfield');
      expect(signatoryFrom('Approved by Dana Whitfield [certificate:abc:x.pdf]')).toBe(
        'Dana Whitfield',
      );
    });

    it('keeps a bare name with no verb', { tags: ['edge-case'] }, () => {
      expect(signatoryFrom('Dana Whitfield')).toBe('Dana Whitfield');
    });

    /**
     * A line that invents a signatory is worse in an audit trail than one that
     * does not claim one at all.
     */
    it('returns null when there is no name to report', { tags: ['edge-case'] }, () => {
      expect(signatoryFrom('[certificate:abc:x.pdf]')).toBeNull();
      expect(signatoryFrom('')).toBeNull();
      expect(signatoryFrom(null)).toBeNull();
      expect(signatoryFrom(42)).toBeNull();
    });
  });

  describe('client and signatory attribution', { tags: ['important'] }, () => {
    const order = {
      created_at: T('2026-08-10T09:00:00Z'),
      buyer_party_id: { name: 'Sephora' },
    };

    it('names the client on a proposal, and the signatory on acceptance', () => {
      const entries = buildActivity({
        order,
        proposals: [
          {
            id: 'p1',
            version: 1,
            status: 'accepted',
            sent_at: T('2026-08-12T09:00:00Z'),
            accepted_at: T('2026-08-13T09:00:00Z'),
            comments: 'Signed by Dana Whitfield [certificate:abc:sig.pdf]',
          },
        ],
      });
      const titles = entries.map((e) => e.title);
      expect(titles).toContain('Proposal v1 sent to Sephora');
      expect(titles).toContain('Sephora accepted Proposal v1 — signed by Dana Whitfield');
    });

    it('falls back to "the client" when the buyer is unnamed', { tags: ['edge-case'] }, () => {
      const [entry] = buildActivity({
        proposals: [{ id: 'p1', version: 2, sent_at: T('2026-08-12T09:00:00Z') }],
      });
      expect(entry.title).toBe('Proposal v2 sent to the client');
    });

    it('reports a decline without claiming an acceptance', { tags: ['edge-case'] }, () => {
      // A decline stamps no accepted_at, so it has no date and is dropped
      // rather than shown at the wrong point in the sequence.
      const entries = buildActivity({
        order,
        proposals: [
          { id: 'p1', version: 1, status: 'rejected', loss_reason: 'client_declined' },
        ],
      });
      expect(entries.every((e) => !e.title.includes('accepted'))).toBe(true);
    });

    it('narrates proof request, upload and the client decision', () => {
      const entries = buildActivity({
        reviews: [
          {
            id: 'r1',
            review_kind: 'proof',
            proof_type: 'Art proof',
            round: 1,
            requested_at: T('2026-08-14T09:00:00Z'),
            proof_uploaded_at: T('2026-08-15T09:00:00Z'),
            proof_file_name: 'gc-1017-art-v1.pdf',
          },
        ],
        verdicts: [
          {
            id: 'v1',
            decision: 'approve',
            decided_at: T('2026-08-16T09:00:00Z'),
            decided_by: 'Dana Whitfield',
            comment: 'Approved by Dana Whitfield [certificate:abc:p.pdf]',
            review_request: { review_kind: 'proof', proof_type: 'Art proof', round: 1 },
          },
        ],
      });
      const titles = entries.map((e) => e.title);
      expect(titles).toContain('Art proof v1 requested from the supplier');
      expect(titles).toContain('Art proof v1 uploaded — gc-1017-art-v1.pdf');
      expect(titles).toContain('Dana Whitfield approved Art proof v1');
    });

    /**
     * The Quote stage's own states already narrate the deal review; repeating
     * it from review_request/verdict would double every one of them.
     */
    it('excludes internal deal-review reviews and verdicts', { tags: ['important'] }, () => {
      const entries = buildActivity({
        reviews: [
          { id: 'r1', review_kind: 'deal_review', round: 1, requested_at: T('2026-08-14T09:00:00Z') },
        ],
        verdicts: [
          {
            id: 'v1',
            decision: 'approve',
            decided_at: T('2026-08-14T10:00:00Z'),
            decided_by: 'cf9c0a43-001b-4d83-bc90-bc20c41470b8',
            review_request: { review_kind: 'deal_review', round: 1 },
          },
        ],
      });
      expect(entries).toEqual([]);
    });

    it('reports a rejected proof as changes requested', { tags: ['edge-case'] }, () => {
      const [entry] = buildActivity({
        verdicts: [
          {
            id: 'v1',
            decision: 'reject',
            decided_at: T('2026-08-16T09:00:00Z'),
            decided_by: 'Dana Whitfield',
            review_request: { review_kind: 'proof', proof_type: 'Art proof', round: 1 },
          },
        ],
      });
      expect(entry.title).toBe('Dana Whitfield requested changes to Art proof v1');
    });
  });

  describe('activitySourcesFromFeed', { tags: ['important'] }, () => {
    it('unpacks the composite into the four sources', { tags: ['smoke'] }, () => {
      const sources = activitySourcesFromFeed({
        order: { id: 'o1', created_at: T('2026-08-10T09:00:00Z') },
        history: [{ id: 'h1' }],
        rfes: [{ id: 'r1' }, { id: 'r2' }],
        quotes: [{ id: 'q1' }],
      });
      expect(sources.order).toEqual({ id: 'o1', created_at: '2026-08-10T09:00:00Z' });
      expect(sources.history).toHaveLength(1);
      expect(sources.rfes).toHaveLength(2);
      expect(sources.quotes).toHaveLength(1);
    });

    /**
     * A sub-query that fails server-side leaves its key missing or holding an
     * error object. Passing that straight through would throw on `.filter`
     * inside a render and blank the page via the error boundary.
     */
    it('degrades a broken sub-query to an empty list', { tags: ['error-boundary'] }, () => {
      const sources = activitySourcesFromFeed({
        order: { id: 'o1' },
        history: { error: 'boom' },
        quotes: null,
      });
      expect(sources.history).toEqual([]);
      expect(sources.rfes).toEqual([]);
      expect(sources.quotes).toEqual([]);
      // The half that worked still survives.
      expect(sources.order).toEqual({ id: 'o1' });
      expect(() => buildActivity(sources)).not.toThrow();
    });

    it('returns empty sources for a non-object response', { tags: ['edge-case'] }, () => {
      expect(activitySourcesFromFeed(null)).toEqual({});
      expect(activitySourcesFromFeed(undefined)).toEqual({});
      expect(activitySourcesFromFeed('nope')).toEqual({});
      expect(activitySourcesFromFeed(42)).toEqual({});
    });

    it('feeds buildActivity end to end', () => {
      const entries = buildActivity(
        activitySourcesFromFeed({
          order: { created_at: T('2026-08-10T09:00:00Z') },
          history: [],
          rfes: [{ id: 'r1', sent_at: T('2026-08-12T09:00:00Z'), supplier: { name: 'Thales' } }],
          quotes: [
            {
              id: 'q1',
              round: 1,
              submitted_at: T('2026-08-13T09:00:00Z'),
              rfe: { supplier: { name: 'Thales' } },
            },
          ],
        }),
      );
      expect(entries.map((e) => e.kind)).toEqual(['quote_received', 'rfe_sent', 'created']);
    });
  });

  describe('relativeTime', { tags: ['logic'] }, () => {
    const now = Date.parse('2026-08-17T12:00:00Z');

    it('scales through the units', () => {
      expect(relativeTime('2026-08-17T11:59:30Z', now)).toBe('just now');
      expect(relativeTime('2026-08-17T11:30:00Z', now)).toBe('30m ago');
      expect(relativeTime('2026-08-17T09:00:00Z', now)).toBe('3h ago');
      expect(relativeTime('2026-08-15T12:00:00Z', now)).toBe('2d ago');
      expect(relativeTime('2026-06-17T12:00:00Z', now)).toBe('2mo ago');
      expect(relativeTime('2024-08-17T12:00:00Z', now)).toBe('2y ago');
    });

    it('returns empty string for an unparseable date', { tags: ['edge-case'] }, () => {
      expect(relativeTime('nope', now)).toBe('');
    });
  });
});
