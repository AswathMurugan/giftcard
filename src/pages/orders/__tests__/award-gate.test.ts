/**
 * The Award gate.
 *
 * Raising a supply order is a real commitment to a supplier. Doing it after
 * the client declined the proposal buys stock for work that was refused —
 * and nothing else in the chain catches it, because the allocation is still
 * valid and the stage is still Award. These tests pin the two halves: it must
 * block on a live decline, and it must NOT block on anything else, or every
 * order that ever went round twice is stranded.
 */
import { describe, it, expect } from 'vitest';
import { awardBlockedReason } from '@/pages/orders/fulfilment-helpers';

describe('awardBlockedReason', { tags: ['award', 'important'] }, () => {
  it('allows an order with no proposal at all', { tags: ['edge-case'] }, () => {
    expect(awardBlockedReason(undefined)).toBeNull();
    expect(awardBlockedReason([])).toBeNull();
  });

  it('allows an order whose only proposal is an unissued draft', { tags: ['edge-case'] }, () => {
    // A draft has not been put to the client, so they cannot have declined it.
    expect(awardBlockedReason([{ id: 'p', version: 1, status: 'draft' }])).toBeNull();
  });

  it('allows a proposal the client signed', () => {
    expect(
      awardBlockedReason([
        { id: 'p', version: 1, status: 'accepted', accepted_at: '2026-08-17T00:00:00Z' },
      ]),
    ).toBeNull();
  });

  it('allows a proposal that is merely issued and unanswered', () => {
    // Awaiting a signature is not a refusal — production planning continues.
    expect(awardBlockedReason([{ id: 'p', version: 1, status: 'sent' }])).toBeNull();
  });

  it('blocks when the live proposal was declined', { tags: ['important'] }, () => {
    const reason = awardBlockedReason([
      { id: 'p', version: 1, status: 'rejected', comments: 'Quantity is wrong.' },
    ]);
    expect(reason).toBeTruthy();
    expect(reason).toContain('v1');
    // The client's own words, so CS knows what to change.
    expect(reason).toContain('Quantity is wrong.');
  });

  it('blocks without quoting a reason that was never given', { tags: ['edge-case'] }, () => {
    const reason = awardBlockedReason([{ id: 'p', version: 1, status: 'rejected' }]);
    expect(reason).toBeTruthy();
    expect(reason).not.toContain('""');
  });

  it(
    'does NOT block on an old rejection that has since been superseded',
    { tags: ['important'] },
    () => {
      // v1 was declined and re-priced; v2 is live and awaiting signature.
      // Blocking on v1 would strand every order that went round twice.
      expect(
        awardBlockedReason([
          { id: 'a', version: 1, status: 'rejected', comments: 'too dear' },
          { id: 'b', version: 2, status: 'sent' },
        ]),
      ).toBeNull();
    },
  );

  it('blocks when the NEWEST version is the declined one', { tags: ['important'] }, () => {
    // Order of the array must not decide the answer — version does.
    const reason = awardBlockedReason([
      { id: 'b', version: 2, status: 'rejected', comments: 'still too dear' },
      { id: 'a', version: 1, status: 'accepted' },
    ]);
    expect(reason).toContain('v2');
  });

  it('ignores drafts when picking the live version', { tags: ['edge-case'] }, () => {
    // A draft v3 sitting above a declined v2 must not unblock the award —
    // an unissued document cannot answer for the client.
    const reason = awardBlockedReason([
      { id: 'c', version: 3, status: 'draft' },
      { id: 'b', version: 2, status: 'rejected' },
    ]);
    expect(reason).toContain('v2');
  });

  it('is case-insensitive about status', { tags: ['edge-case'] }, () => {
    expect(awardBlockedReason([{ id: 'p', version: 1, status: 'REJECTED' }])).toBeTruthy();
  });
});
