/**
 * Which proof rounds the supplier is shown as owing.
 *
 * This file exists because of a real miss: `review_request_create` opens a
 * round with status **`open`**, and Relay's allowlist of "awaiting" statuses
 * did not include it. Forge showed the identical row as "awaiting upload, with
 * Supplier"; Relay said "nothing waiting on your artwork". A supplier was
 * never shown a freshly requested proof.
 *
 * The regression test is therefore `open`, and the design test is that an
 * UNKNOWN status errs towards owed — being wrong in that direction only wastes
 * a glance, while the other direction hides work.
 */
import { describe, it, expect } from 'vitest';
import { decorateSupplierProofs, type RawReview } from '@/pages/proofs/supplier-proof-helpers';

const row = (over: Partial<RawReview> = {}): RawReview => ({
  id: 'r1',
  review_kind: 'proof',
  proof_type: 'Art proof',
  round: 1,
  status: 'open',
  ...over,
});

const first = (r: RawReview) => decorateSupplierProofs([r])[0];

describe('decorateSupplierProofs', { tags: ['proofing', 'important'] }, () => {
  /** The bug this file was written for. */
  it('treats a freshly requested round (status "open") as owed', { tags: ['smoke'] }, () => {
    expect(first(row({ status: 'open' })).awaitingUpload).toBe(true);
  });

  it('still recognises the older wordings', () => {
    for (const status of ['requested', 'awaiting_upload', 'not_requested', '']) {
      expect(first(row({ status })).awaitingUpload).toBe(true);
    }
  });

  it('errs towards owed on a status it has never seen', { tags: ['important'] }, () => {
    expect(first(row({ status: 'some_future_status' })).awaitingUpload).toBe(true);
  });

  it('does not chase a round that is settled', () => {
    for (const status of ['approved', 'in_review', 'awaiting_sign']) {
      expect(first(row({ status })).awaitingUpload).toBe(false);
    }
  });

  /** Rejection opens a NEW round; the rejected one no longer carries the work. */
  it('does not chase the rejected round itself', { tags: ['edge-case'] }, () => {
    expect(first(row({ status: 'changes_requested' })).awaitingUpload).toBe(false);
  });

  /** An uploaded file settles it whatever the status column says. */
  it('stops asking once a file is attached', { tags: ['important'] }, () => {
    expect(first(row({ status: 'open', proof_file_name: 'art-v1.pdf' })).awaitingUpload).toBe(false);
  });

  it('is case-insensitive about the stored status', { tags: ['edge-case'] }, () => {
    expect(first(row({ status: 'APPROVED' })).awaitingUpload).toBe(false);
    expect(first(row({ status: 'Open' })).awaitingUpload).toBe(true);
  });

  it('ignores rounds that are not proofs', { tags: ['edge-case'] }, () => {
    expect(decorateSupplierProofs([row({ review_kind: 'deal_review' })])).toHaveLength(0);
  });

  it('sorts what is owed to the top', { tags: ['logic'] }, () => {
    const rows = decorateSupplierProofs([
      row({ id: 'a', status: 'approved', round: 2 }),
      row({ id: 'b', status: 'open', round: 1 }),
    ]);
    expect(rows[0].id).toBe('b');
  });
});
