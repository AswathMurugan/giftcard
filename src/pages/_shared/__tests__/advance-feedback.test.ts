/**
 * Advance-attempt copy.
 *
 * GC-1018 (2026-08-18) is the regression this file exists for. The order sat
 * at `Proposal` with its proposal still `sent`; CS pressed Advance, the signal
 * fired, and the workflow woke, read `proposal_accepted_count == 0` and jumped
 * back to its own wait. Nothing was broken — the guard was doing its job — but
 * the page said "try Refresh", which is advice that can never succeed: no
 * amount of refreshing makes a client sign a proposal.
 *
 * So the tests below care about ONE distinction above all others: a guarded
 * wait must not be described as something the reader can retry, and an
 * unguarded one must keep the retry advice it legitimately deserves.
 */
import { describe, it, expect } from 'vitest';
import {
  advanceNote,
  isGuardedWait,
  waitingFor,
} from '@/pages/_shared/advance-feedback';

/** Every state whose wait holds behind a jump-back guard. */
const GUARDED = ['Quote Requested', 'Deal Review', 'Proposal', 'Proofing'];

/**
 * States that DO advance on a signal. `Allocation` is the important one — its
 * wait is deliberately unguarded, so misclassifying it would tell a user to
 * sit and wait for a counterparty who has nothing to do.
 */
const UNGUARDED = ['Allocation', 'Order Received', 'Billing', 'Ready to Ship'];

describe('advance-feedback', { tags: ['orders', 'logic'] }, () => {
  describe('waitingFor', { tags: ['important'] }, () => {
    it('names what each guarded state is waiting for', () => {
      for (const state of GUARDED) {
        expect(waitingFor(state)).toBeTruthy();
      }
    });

    it('attributes the Proposal wait to the client', { tags: ['smoke'] }, () => {
      expect(waitingFor('Proposal')).toContain('client');
    });

    it('attributes the Quote wait to the suppliers', () => {
      expect(waitingFor('Quote Requested')).toContain('supplier');
    });

    it('returns null for a state that advances on its own', { tags: ['important'] }, () => {
      for (const state of UNGUARDED) {
        expect(waitingFor(state)).toBeNull();
      }
    });

    it('returns null for missing input', { tags: ['edge-case'] }, () => {
      expect(waitingFor(null)).toBeNull();
      expect(waitingFor(undefined)).toBeNull();
      expect(waitingFor('')).toBeNull();
    });

    /**
     * The lookup is a plain object, so `'constructor' in GUARDED_WAITS` would
     * be true and would render a sentence built from Object.prototype.
     */
    it('does not treat inherited keys as guarded states', { tags: ['edge-case'] }, () => {
      expect(waitingFor('constructor')).toBeNull();
      expect(waitingFor('toString')).toBeNull();
      expect(waitingFor('__proto__')).toBeNull();
    });
  });

  describe('isGuardedWait', { tags: ['logic'] }, () => {
    it('agrees with waitingFor', () => {
      for (const state of GUARDED) expect(isGuardedWait(state)).toBe(true);
      for (const state of UNGUARDED) expect(isGuardedWait(state)).toBe(false);
      expect(isGuardedWait(null)).toBe(false);
    });
  });

  describe('advanceNote', { tags: ['important'] }, () => {
    it('says nothing when the stage moved', { tags: ['smoke'] }, () => {
      // The strip already re-rendered; words would be noise.
      expect(advanceNote('Proposal', true)).toBeNull();
      expect(advanceNote('Allocation', true)).toBeNull();
      expect(advanceNote(null, true)).toBeNull();
    });

    /** The GC-1018 case, stated exactly. */
    it('does not offer a retry when a guard is holding the stage', () => {
      const note = advanceNote('Proposal', false);
      expect(note).toBeTruthy();
      expect(note).toContain('advances by itself');
      expect(note).not.toContain('Give it a moment');
    });

    it('explains the wait for every guarded state', () => {
      for (const state of GUARDED) {
        const note = advanceNote(state, false);
        expect(note).toContain('waiting for');
        expect(note).not.toContain('Give it a moment');
      }
    });

    it('keeps the retry advice where a signal really does advance', () => {
      for (const state of UNGUARDED) {
        const note = advanceNote(state, false);
        expect(note).toContain('Give it a moment');
        expect(note).not.toContain('waiting for');
      }
    });

    it('falls back to the retry advice when the state is unknown', { tags: ['edge-case'] }, () => {
      // Better to suggest a harmless retry than to invent a counterparty.
      expect(advanceNote(null, false)).toContain('Give it a moment');
      expect(advanceNote(undefined, false)).toContain('Give it a moment');
      expect(advanceNote('Some Future Stage', false)).toContain('Give it a moment');
    });
  });
});
