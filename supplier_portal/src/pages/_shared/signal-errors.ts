/**
 * Reading the signal API's failures.
 *
 * `POST /v1/signals/{id}/trigger` reports a precise diagnosis in the response
 * BODY and a bare 500 in the status line, so the useful information only
 * survives if the caller unwraps it (`sendStageResponse` does). What arrives
 * here is that unwrapped message.
 *
 * Two of its codes mean the same thing and are NOT transient:
 *
 *   ERROR_SIGNAL_NO_ACTIVE_WORKFLOW — nothing is currently waiting on this id.
 *   ERROR_SIGNAL_DATA_GET           — the signal target could not be resolved.
 *
 * Both mean no workflow run is parked on that instance: either the record
 * predates the workflow that would have started one (its stage rows were
 * backfilled), or the run already finished or timed out. Retrying cannot fix
 * it, so telling the user to "try again" would be a lie — they need a person.
 *
 * Everything else is genuinely transient and worth retrying.
 *
 * The classifier lives here, separate from the wording, because the same
 * condition needs different copy per surface: a supplier looking at a purchase
 * order and a supplier submitting a quote are owed different next steps.
 */

/**
 * True when the signal failed because no workflow run is waiting on the id —
 * a permanent condition for that record, not a blip.
 */
export function isWorkflowNotTracking(error: unknown): boolean {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  return /NO_ACTIVE_WORKFLOW|SIGNAL_DATA_GET/i.test(raw);
}

/** The raw message, for appending to copy that needs the detail. */
export function signalErrorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  return raw || 'unknown error';
}

/**
 * Copy for a failed signal AFTER a quote has already been written.
 *
 * The distinction matters more here than anywhere else in Relay: the supplier's
 * quote IS saved either way. What failed is only the notification that moves
 * the buyer's order forward. Saying "could not submit" would send a supplier
 * back to re-key a quote that is already in the system, so every branch leads
 * with the fact that the quote was recorded.
 */
export function describeQuoteSignalFailure(error: unknown): string {
  if (isWorkflowNotTracking(error)) {
    return 'Your quote was saved. The buyer’s order is not currently being tracked by the workflow, so it was not advanced automatically — the buyer will pick it up manually.';
  }
  return `Your quote was saved, but the buyer’s order could not be notified (${signalErrorText(error)}). No action is needed from you.`;
}
