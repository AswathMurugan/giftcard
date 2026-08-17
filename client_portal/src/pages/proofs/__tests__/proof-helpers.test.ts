/**
 * Proof conversations and their history.
 *
 * The grouping is the load-bearing part: a three-round proof is ONE piece of
 * outstanding work, and listing each round separately made a single job look
 * like three. The privacy filter matters just as much — `deal_review` rows are
 * Fiserv's internal margin sign-off on the same entity.
 */
import { describe, it, expect } from 'vitest';
import {
  decorateProofs,
  historyDate,
  versionCaption,
  waitingCount,
} from '@/pages/proofs/proof-helpers';
import type {
  ClientProofListRow,
  ClientProofRound,
  ClientProofVerdict,
} from '@/types/saved-queries.generated';

const TODAY = '2026-08-17';

function round(over: Partial<ClientProofRound>): ClientProofRound {
  return {
    id: `r${over.round ?? 1}`,
    review_kind: 'proof',
    proof_type: 'Art proof',
    round: 1,
    status: 'requested',
    requested_at: '2026-08-17T00:00:00Z',
    subject_order: {
      id: 'ord-1',
      order_code: 'GC-1003',
      order_brief: '100 Card',
      tq_instance: { id: 'tq-1' },
    },
    ...over,
  } as ClientProofRound;
}

describe('proof-helpers', { tags: ['proofs', 'logic'] }, () => {
  describe('historyDate', { tags: ['edge-case'] }, () => {
    it('says Today for today', () => {
      expect(historyDate('2026-08-17T09:00:00Z', TODAY)).toBe('Today');
    });

    it('gives a short date otherwise', () => {
      expect(historyDate('2026-06-19T09:00:00Z', TODAY)).toBe('Jun 19');
    });

    it('tolerates nothing and nonsense', () => {
      expect(historyDate(null, TODAY)).toBe('—');
      expect(historyDate('not-a-date', TODAY)).toBe('—');
    });
  });

  describe('versionCaption', { tags: ['important'] }, () => {
    it('phrases a rejection from the client side', () => {
      // "rejected" is our word; the person reading this made the decision.
      const v = { decision: 'reject', decided_at: '2026-06-19T00:00:00Z' } as ClientProofVerdict;
      expect(versionCaption(round({ round: 1 }), v, false, TODAY)).toBe(
        'Jun 19 · you requested changes',
      );
    });

    it('names an approval', () => {
      const v = { decision: 'approve', decided_at: '2026-08-17T00:00:00Z' } as ClientProofVerdict;
      expect(versionCaption(round({ round: 2 }), v, false, TODAY)).toBe(
        'Today · approved by you',
      );
    });

    it('the current round awaiting a decision says so', () => {
      expect(versionCaption(round({ round: 2 }), undefined, true, TODAY)).toBe(
        'Today · awaiting your approval',
      );
    });

    it('falls back to the status when no verdict was recorded', { tags: ['edge-case'] }, () => {
      // Rounds decided before the audit trail existed have no verdict row.
      expect(versionCaption(round({ round: 2, status: 'rejected' }), undefined, false, TODAY)).toBe(
        'Today · you requested changes',
      );
    });

    it('calls an undecided first round a first draft', { tags: ['edge-case'] }, () => {
      expect(versionCaption(round({ round: 1, status: '' }), undefined, false, TODAY)).toBe(
        'Today · first draft',
      );
    });
  });

  describe('decorateProofs', { tags: ['important'] }, () => {
    it('returns [] for nothing', { tags: ['edge-case'] }, () => {
      expect(decorateProofs(null)).toEqual([]);
      expect(decorateProofs({} as ClientProofListRow)).toEqual([]);
      expect(decorateProofs({ proofs: [], verdicts: [] })).toEqual([]);
    });

    it('never surfaces an internal deal review', () => {
      const packet = {
        proofs: [round({ round: 1, review_kind: 'deal_review' })],
        verdicts: [],
      } as ClientProofListRow;
      expect(decorateProofs(packet)).toEqual([]);
    });

    it('collapses three rounds into ONE row with three versions', () => {
      const packet = {
        proofs: [round({ round: 1 }), round({ round: 3 }), round({ round: 2 })],
        verdicts: [],
      } as ClientProofListRow;
      const rows = decorateProofs(packet);
      expect(rows).toHaveLength(1);
      // The live round is the highest, not the first in the array.
      expect(rows[0].round).toBe(3);
      expect(rows[0].versions.map((v) => v.round)).toEqual([3, 2, 1]);
      expect(rows[0].versions[0].state).toBe('current');
      expect(rows[0].versions[1].state).toBe('superseded');
    });

    it('keeps different proof types as separate conversations', { tags: ['important'] }, () => {
      // An art proof and a data proof are two jobs, not two rounds of one.
      const packet = {
        proofs: [
          round({ id: 'a', round: 1, proof_type: 'Art proof' }),
          round({ id: 'b', round: 1, proof_type: 'Data proof' }),
        ],
        verdicts: [],
      } as ClientProofListRow;
      expect(decorateProofs(packet)).toHaveLength(2);
    });

    it('keeps the same proof type on different orders separate', { tags: ['important'] }, () => {
      const packet = {
        proofs: [
          round({ id: 'a', round: 1 }),
          round({
            id: 'b',
            round: 1,
            subject_order: { id: 'ord-2', order_code: 'GC-1004', tq_instance: { id: 't2' } },
          }),
        ],
        verdicts: [],
      } as unknown as ClientProofListRow;
      expect(decorateProofs(packet)).toHaveLength(2);
    });

    it('captions a superseded round from its verdict', () => {
      const packet = {
        proofs: [round({ id: 'r1', round: 1, status: 'rejected' }), round({ id: 'r2', round: 2 })],
        verdicts: [
          {
            id: 'v1',
            decision: 'reject',
            decided_at: '2026-06-19T00:00:00Z',
            decided_by: 'Dana Whitfield',
            review_request: { id: 'r1', round: 1, review_kind: 'proof' },
          },
        ],
      } as unknown as ClientProofListRow;
      const [row] = decorateProofs(packet);
      const v1 = row.versions.find((v) => v.round === 1)!;
      expect(v1.caption).toBe('Jun 19 · you requested changes');
      expect(v1.decidedBy).toBe('Dana Whitfield');
    });

    it('an undecided live round is awaiting the client', () => {
      const packet = { proofs: [round({ round: 1 })], verdicts: [] } as ClientProofListRow;
      const [row] = decorateProofs(packet);
      expect(row.awaitingYou).toBe(true);
      expect(row.label).toBe('Awaiting your sign-off');
      expect(waitingCount([row])).toBe(1);
    });

    it('a decided live round is not', () => {
      const packet = {
        proofs: [round({ round: 1, status: 'approved' })],
        verdicts: [],
      } as ClientProofListRow;
      const [row] = decorateProofs(packet);
      expect(row.awaitingYou).toBe(false);
      expect(row.label).toBe('Approved');
      expect(waitingCount([row])).toBe(0);
    });

    it('puts outstanding conversations above settled ones', { tags: ['smoke'] }, () => {
      const packet = {
        proofs: [
          round({
            id: 'done',
            round: 1,
            status: 'approved',
            requested_at: '2026-08-17T09:00:00Z',
          }),
          round({
            id: 'todo',
            round: 1,
            proof_type: 'Data proof',
            requested_at: '2026-08-15T09:00:00Z',
          }),
        ],
        verdicts: [],
      } as ClientProofListRow;
      const rows = decorateProofs(packet);
      // Older but outstanding wins over newer and settled.
      expect(rows[0].proofType).toBe('Data proof');
    });

    it('carries the document id so the viewer can offer it', () => {
      const packet = {
        proofs: [round({ round: 1, proof_file_id: 'F1', proof_file_name: 'art-v1.pdf' })],
        verdicts: [],
      } as ClientProofListRow;
      const [row] = decorateProofs(packet);
      expect(row.fileId).toBe('F1');
      expect(row.fileName).toBe('art-v1.pdf');
    });
  });
});
