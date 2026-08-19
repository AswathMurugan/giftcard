/**
 * What to say when an Advance signal changed nothing.
 *
 * Four stages in this process hold behind a GUARD: the workflow wakes on the
 * signal, re-checks a count, and jumps straight back to its own wait when the
 * counterparty has not acted yet. The state legitimately does not move — so
 * the old copy, "try Refresh", was advice that could never work. Refreshing
 * cannot make a client sign.
 *
 * Observed on GC-1018 (2026-08-18): CS sent the proposal, clicked Advance, and
 * the run jumped back to `waitforsignalnode_prop_done` because
 * `proposal_accepted_count` was 0 while the proposal was still `sent`. Forge
 * reported it as a possible refresh problem; nothing was wrong.
 *
 * This is the same distinction `signal-errors.ts` draws for a FAILED signal —
 * transient vs. permanent — applied to a signal that succeeded and was then
 * deliberately ignored. Both exist because telling someone to retry something
 * that cannot succeed is worse than saying nothing.
 *
 * The UNGUARDED waits (Allocation, and the plain hand-offs) really do advance
 * on a signal, so silence there is genuinely worth a retry. That is why the
 * two cases must read differently and why this cannot be one blanket string.
 */

/**
 * States whose wait is guarded, mapped to the thing that releases them.
 *
 * Keyed by STATE name rather than stage because that is what the caller holds
 * — the status history projects the state, not its parent stage. Every state
 * here is unique to one stage in this process, so there is no ambiguity.
 *
 * Kept in step with the guards in the `quote` and `proof` workflow nodes:
 *   Quote Requested → rfe_open_count            (gotonode_collect)
 *   Deal Review     → review_approved_count     (gotonode_dealrev)
 *   Proposal        → proposal_accepted_count   (gotonode_prop)
 *   Proofing        → review_approved_count     (gotonode_proof)
 * `Allocation` is deliberately absent — its wait is unguarded, so a signal
 * there does advance and the retry wording is correct.
 */
const GUARDED_WAITS: Record<string, string> = {
  'Quote Requested': 'every invited supplier to submit a quote',
  'Deal Review': 'the deal review to be approved',
  Proposal: 'the client to accept and sign the proposal',
  Proofing: 'the proof to be approved',
};

/**
 * What the named state is waiting for, or null when its wait is not guarded.
 *
 * `hasOwnProperty` rather than `in` so an inherited key — `constructor`,
 * `toString` — cannot be mistaken for a guarded state and produce a nonsense
 * sentence from Object.prototype.
 */
export function waitingFor(state: string | null | undefined): string | null {
  if (!state) return null;
  return Object.prototype.hasOwnProperty.call(GUARDED_WAITS, state)
    ? GUARDED_WAITS[state]
    : null;
}

/** True when this state's wait holds until a counterparty acts. */
export function isGuardedWait(state: string | null | undefined): boolean {
  return waitingFor(state) !== null;
}

/**
 * The note to show beside the stage strip after an advance attempt.
 *
 * `null` means the advance visibly worked and needs no words — the strip
 * already moved.
 *
 * `state` is the state the order was sitting on WHEN the button was pressed,
 * not the current one: on a successful advance the current state has already
 * changed, and it is the stage we tried to leave that explains the wait.
 */
export function advanceNote(
  state: string | null | undefined,
  moved: boolean,
): string | null {
  if (moved) return null;

  const pending = waitingFor(state);
  if (pending) {
    return `This stage is waiting for ${pending}. It advances by itself once that happens — refreshing will not move it.`;
  }
  return 'Signal sent, but the stage has not moved yet. Give it a moment, then use Refresh.';
}
