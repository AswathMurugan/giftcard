/**
 * A client signing, or declining, a proposal.
 *
 * `proposal_update` REPLACES every column it names, so a partial body silently
 * blanks the rest — the PDF pointer, the sent timestamp, the whole issue
 * record. Every write here therefore sends the row's existing values back
 * alongside the change. This is the same trap Forge's ProposalPanel documents;
 * the fix has to be repeated because the saved query is shared.
 *
 * Accepting a proposal SIGNALS the workflow, and that signal is what moves the
 * order past Quote.
 *
 * This reverses the portal's previous contract, where "Send to client" was the
 * advance and the client's answer was only recorded against the proposal. That
 * was unsound: the order advanced the moment the document went out, so a
 * DECLINE still left it at Award, ready to raise supplier orders against a
 * price the client had refused. The Quote stage's proposal wait is now guarded
 * — it re-reads the database on every signal and only proceeds when an
 * accepted proposal exists — so issuing the document no longer advances
 * anything, and the client's acceptance has to be what does.
 *
 * A decline deliberately does NOT signal: it would wake the workflow only for
 * the guard to find no acceptance and park again. The order stays at Proposal
 * until CS issues a version the client accepts, which is the intended state.
 *
 * Signalling more than once is harmless under the guard — every wake re-reads
 * the database and re-decides, so a duplicate is a no-op rather than a
 * double-advance.
 */
import { runSavedQueryWithBody, runSavedQueryWithParams, sendStageResponse } from '@/pages/orders/order-api';
import { logger } from '@/utils/logger';
import { createSignatureCertificate } from '@/pages/_shared/sign-with-certificate';
import { withCertificateRef } from '@/pages/_shared/signature-certificate';
import { formatUsd, type ApprovalRow } from './approval-helpers';

export type ProposalDecision = 'accepted' | 'rejected';

export interface DecisionResult {
  /** Non-null when the decision stuck but its certificate did not. */
  certificateProblem: string | null;
  /**
   * Non-null when the acceptance was written but the order could not be woken.
   * The signature stands either way — only the hand-off to production stalled.
   */
  signalProblem: string | null;
}

/**
 * Dig the order's tq_instance id out of the `order_tq_instance` response.
 *
 * Written against `unknown`: the value is two links deep and comes back null
 * for an order never wired to a workflow. Reading it optimistically would
 * throw AFTER the client's signature is already committed.
 */
function readInstanceId(row: unknown): string | null {
  if (!row || typeof row !== 'object') return null;
  const instance = (row as { tq_instance?: unknown }).tq_instance;
  if (!instance || typeof instance !== 'object') return null;
  const id = (instance as { id?: unknown }).id;
  return typeof id === 'string' && id.trim() ? id : null;
}

/**
 * Wake the order after an acceptance.
 *
 * Returns a message rather than throwing: the signature and the status change
 * are already durable by the time this runs, so failing the whole action would
 * tell a client their signature did not land when it did.
 */
async function notifyOrderOfAcceptance(orderId: string): Promise<string | null> {
  try {
    const row = await runSavedQueryWithParams<unknown>('order_tq_instance', { orderId });
    const instanceId = readInstanceId(row);
    if (!instanceId) {
      return 'Your acceptance was recorded. This order is not tracked by the production workflow, so your supplier will be notified manually.';
    }
    await sendStageResponse(instanceId, { id: instanceId });
    return null;
  } catch (error) {
    logger.warn('Proposal accepted but the order signal failed', { orderId, error });
    return 'Your acceptance was recorded and your signature is on file. Notifying production did not go through — your account team will pick it up.';
  }
}

export async function decideProposal(
  row: ApprovalRow,
  decision: ProposalDecision,
  comments: string,
  signedBy: string,
  partyName: string,
): Promise<DecisionResult> {
  const now = new Date().toISOString();

  /**
   * Only an ACCEPTANCE produces a certificate.
   *
   * A decline is a request to re-price, not an agreement to anything — issuing
   * a "Certificate of Acceptance" for it would be actively misleading if it
   * ever surfaced on its own.
   */
  const cert =
    decision === 'accepted'
      ? await createSignatureCertificate({
          kind: 'proposal',
          signedBy,
          signedAt: now,
          orderCode: row.orderCode,
          partyName,
          subject: row.brief,
          facts: [
            ['Document', `Proposal version ${row.version}`],
            ['Total accepted', `${formatUsd(row.totalSell)} ${row.currency}`],
            ['Issued', row.sentAt ? row.sentAt.slice(0, 10) : '—'],
          ],
          effect:
            'By signing, the named signatory accepts this proposal and its pricing on behalf of the client. This authorises production to be scheduled against the order.',
        })
      : { ref: null, problem: null };

  await runSavedQueryWithBody('proposal_update', {
    proposalId: row.id,
    status: decision,
    // Carried forward, not re-derived — see the note above.
    pdfFileId: row.pdfFileId,
    pdfName: row.pdfName,
    pdfAt: null,
    sentAt: row.sentAt,
    sentBy: 'cs',
    // Only an acceptance stamps acceptedAt; a decline leaves it null so the
    // document cannot later read as signed.
    acceptedAt: decision === 'accepted' ? now : null,
    lossReason: decision === 'rejected' ? 'client_declined' : null,
    comments: withCertificateRef(comments, cert.ref) || null,
  });

  /**
   * Last, and only on acceptance.
   *
   * The status flip above has to have landed before the workflow is woken: the
   * guard re-reads `proposal.status`, so signalling first would find nothing
   * accepted and park again.
   */
  const signalProblem =
    decision === 'accepted' ? await notifyOrderOfAcceptance(row.orderId) : null;

  return { certificateProblem: cert.problem, signalProblem };
}
