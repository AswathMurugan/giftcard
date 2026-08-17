/**
 * Producing the certificate that a signature leaves behind.
 *
 * Shared by both signature surfaces (proposals and proofs) so the two cannot
 * drift into different evidence standards — a client who signs two documents
 * on the same order should get two records that look and read alike.
 *
 * The certificate is generated BEFORE the decision is written. If rendering or
 * storing it fails, the caller still records the decision: refusing to let a
 * client approve their artwork because a PDF service is down would be a much
 * worse failure than a missing certificate, and the decision itself is
 * recoverable evidence on its own. The caller is told the certificate is
 * missing so it can say so rather than imply a record exists.
 */
import { generatePdfFromHtml } from '@/pages/orders/order-api';
import { logger } from '@/utils/logger';
import {
  buildSignatureCertificateHtml,
  certificateFilename,
  type CertificateRef,
  type SignatureCertificateInput,
} from './signature-certificate';

export interface CertificateOutcome {
  ref: CertificateRef | null;
  /** Set when the certificate could not be produced, for the caller to relay. */
  problem: string | null;
}

/**
 * Render the certificate and store it in Jiffy Drive.
 *
 * `generatePdfFromHtml` rasterises the HTML server-side and keeps the bytes in
 * Drive, handing back only the `file_id` — which is why that id has to be
 * persisted by the caller, or the document exists but nothing points at it.
 */
export async function createSignatureCertificate(
  input: SignatureCertificateInput,
): Promise<CertificateOutcome> {
  try {
    const html = buildSignatureCertificateHtml(input);
    const filename = certificateFilename(input);
    const result = await generatePdfFromHtml(html, filename);
    if (!result?.file_id) {
      return { ref: null, problem: 'The signature certificate could not be stored.' };
    }
    return {
      ref: { fileId: result.file_id, fileName: result.output_filename || filename },
      problem: null,
    };
  } catch (error) {
    logger.error('signature-certificate: could not be generated', {
      orderCode: input.orderCode,
      kind: input.kind,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ref: null,
      problem:
        'Your decision was recorded, but the signature certificate could not be generated. Your account team can re-issue it.',
    };
  }
}

/**
 * Turn a failed workflow signal into something a CLIENT can act on.
 *
 * The signal API answers in its own vocabulary, and left raw it puts workflow
 * ids, signal names and internal timestamps on a client's screen — which tells
 * them nothing and looks broken. Worse, it buries the one fact that matters:
 * their decision WAS recorded and they must not sign again.
 *
 * `ERROR_SIGNAL_NO_ACTIVE_WORKFLOW` / `ERROR_SIGNAL_DATA_GET` mean nothing was
 * waiting for this order — the run had already moved on or its wait expired.
 * Retrying cannot fix that; a person has to.
 */
export function explainSignalFailure(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  if (/NO_ACTIVE_WORKFLOW|SIGNAL_DATA_GET|expired/i.test(raw)) {
    return 'Your approval has been recorded and you do not need to sign again. This order was not waiting on it, so your account team will need to move it on manually — they have been given the details.';
  }
  return 'Your approval has been recorded and you do not need to sign again, but your account team could not be notified automatically. Please let them know.';
}
