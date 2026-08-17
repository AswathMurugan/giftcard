/**
 * The client's decision on a proof.
 *
 * Four steps, and the order matters:
 *
 *   1. generate the signature certificate (approval only),
 *   2. record the decision on `review_request` (a column),
 *   3. record a VERDICT — who decided, what, and when, and
 *   4. on APPROVAL only, signal the order's workflow so Forge's Proof stage
 *      can proceed.
 *
 * Step 3 was missing originally, and its absence was a real audit gap: the
 * artwork showed "approved" but nothing anywhere said who approved it or when.
 * Forge's own proof decisions write a verdict; a client approval — the one
 * that actually releases production — has to as well, or the decision log on
 * the client's own order detail has nothing to show.
 *
 * Approval releases production, so it must reach the workflow — writing only
 * the column would leave the run parked on its wait and the 30-day expiry
 * would eventually mark an order Expired that the client had signed off.
 *
 * Rejection deliberately does NOT signal. A rejected proof means the order
 * stays exactly where it is until a new round is uploaded, so the wait must
 * keep waiting — signalling here would advance the order on the strength of
 * the client saying no.
 */
import { runSavedQueryWithBody, sendStageResponse } from '@/pages/orders/order-api';
import { logger } from '@/utils/logger';
import { createSignatureCertificate } from '@/pages/_shared/sign-with-certificate';
import { withCertificateRef } from '@/pages/_shared/signature-certificate';
import type { ProofRow } from './proof-helpers';

export type ProofDecision = 'approved' | 'rejected';

export interface ProofDecisionResult {
  /** Non-null when the decision stuck but its certificate did not. */
  certificateProblem: string | null;
}

export async function decideProof(
  row: ProofRow,
  decision: ProofDecision,
  signedBy: string,
  partyName: string,
  note: string,
): Promise<ProofDecisionResult> {
  const now = new Date().toISOString();

  const cert =
    decision === 'approved'
      ? await createSignatureCertificate({
          kind: 'proof',
          signedBy,
          signedAt: now,
          orderCode: row.orderCode,
          partyName,
          subject: row.brief,
          facts: [
            ['Document', `${row.proofType}, round ${row.round}`],
            ['Artwork', row.fileName ?? 'Not attached'],
            ['Requested', row.requestedAt ? row.requestedAt.slice(0, 10) : '—'],
          ],
          effect:
            'By signing, the named signatory approves this artwork on behalf of the client and releases it for production. Changes after this point are handled as a new proof round.',
        })
      : { ref: null, problem: null };

  await runSavedQueryWithBody('client_proof_decide', {
    reviewId: row.id,
    status: decision,
  });

  /**
   * The audit entry. Written even when the certificate failed — the decision
   * and its timestamp are the evidence that matters most, and losing them
   * because a PDF service was down would be the worse outcome.
   */
  try {
    await runSavedQueryWithBody('verdict_record', {
      reviewId: row.id,
      decision: decision === 'approved' ? 'approve' : 'reject',
      reasonCode: decision === 'approved' ? 'client_approved' : 'client_changes_requested',
      comment: withCertificateRef(note, cert.ref) || null,
      // Free text on the entity, and the typed name IS the signature.
      decidedBy: signedBy,
      decidedAt: now,
    });
  } catch (error) {
    logger.error('decideProof: verdict not recorded', {
      reviewId: row.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (decision !== 'approved') return { certificateProblem: cert.problem };
  if (!row.instanceId) return { certificateProblem: cert.problem };

  /**
   * A failed signal must not look like a failed approval — the decision is
   * already recorded and re-clicking would not undo it. It surfaces as its own
   * problem so the client is told the buyer has not been notified, rather
   * than being invited to approve twice.
   */
  await sendStageResponse(row.instanceId, { id: row.instanceId });
  return { certificateProblem: cert.problem };
}
