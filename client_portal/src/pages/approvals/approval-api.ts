/**
 * A client signing, or declining, a proposal.
 *
 * `proposal_update` REPLACES every column it names, so a partial body silently
 * blanks the rest — the PDF pointer, the sent timestamp, the whole issue
 * record. Every write here therefore sends the row's existing values back
 * alongside the change. This is the same trap Forge's ProposalPanel documents;
 * the fix has to be repeated because the saved query is shared.
 *
 * Unlike a proof sign-off, accepting a proposal does NOT signal the workflow.
 * The order advances past Quote when Fiserv issues the document ("Send to
 * client" is the advance); the client's answer is recorded against the
 * proposal itself. Signalling here would double-advance the run.
 */
import { runSavedQueryWithBody } from '@/pages/orders/order-api';
import { createSignatureCertificate } from '@/pages/_shared/sign-with-certificate';
import { withCertificateRef } from '@/pages/_shared/signature-certificate';
import { formatUsd, type ApprovalRow } from './approval-helpers';

export type ProposalDecision = 'accepted' | 'rejected';

export interface DecisionResult {
  /** Non-null when the decision stuck but its certificate did not. */
  certificateProblem: string | null;
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

  return { certificateProblem: cert.problem };
}
