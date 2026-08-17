/**
 * The signature certificate — the document a signature actually produces.
 *
 * A typed name in a dialog is not, on its own, evidence. What makes a
 * sign-off defensible later is a fixed record of WHAT was agreed, by WHOM,
 * and WHEN — rendered once, at the moment of signing, and stored where it
 * cannot drift as the underlying order moves on. This builds that HTML;
 * `generatePdfFromHtml` rasterises it and Jiffy Drive keeps it.
 *
 * Everything is inlined (styles in a `<style>` block, no images, no external
 * fonts) because the renderer resolves nothing: it is handed the HTML with
 * `base_url: null` and cannot reach back out for an asset it has no
 * credentials for.
 *
 * Times are stamped in UTC with the offset shown. A certificate that says
 * "17 Aug 2026, 14:32" without a zone is worth very little across a dispute
 * spanning two countries.
 */
import { escapeHtml } from '@/pages/orders/spec-sheet';

export type SignatureKind = 'proposal' | 'proof';

export interface SignatureCertificateInput {
  kind: SignatureKind;
  /** The typed name, exactly as entered. */
  signedBy: string;
  /** ISO-8601 instant the signature was taken. */
  signedAt: string;
  orderCode: string;
  /** The client the signature binds. */
  partyName: string;
  /** Free-form description of the thing signed. */
  subject: string;
  /** Ordered fact rows — label/value pairs shown in the body. */
  facts: Array<[string, string]>;
  /** The action the signature authorised, in the signer's own terms. */
  effect: string;
}

/** "17 August 2026 at 14:32:07 UTC" — unambiguous, zone always stated. */
export function formatStamp(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const d = new Date(ms);
  const date = d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const time = d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  });
  return `${date} at ${time} UTC`;
}

/**
 * A stable filename.
 *
 * Includes the instant so a second round never overwrites the first — the
 * whole point of the record is that earlier versions survive.
 */
export function certificateFilename(input: SignatureCertificateInput): string {
  const stamp = input.signedAt.replace(/[:.]/g, '-');
  return `${input.orderCode}-${input.kind}-signature-${stamp}.pdf`;
}

export function buildSignatureCertificateHtml(input: SignatureCertificateInput): string {
  const title =
    input.kind === 'proposal' ? 'Certificate of Acceptance' : 'Certificate of Approval';

  const rows = input.facts
    .map(
      ([label, value]) => `
        <tr>
          <th>${escapeHtml(label)}</th>
          <td>${escapeHtml(value)}</td>
        </tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)} — ${escapeHtml(input.orderCode)}</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 48px 56px;
    font-family: "Source Sans 3", "Helvetica Neue", Arial, sans-serif;
    color: #1c1917;
    font-size: 12pt;
    line-height: 1.5;
  }
  .eyebrow {
    font-size: 9pt;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #78716c;
    margin: 0 0 4px;
  }
  h1 { font-size: 22pt; font-weight: 800; margin: 0 0 4px; letter-spacing: -0.01em; }
  .lede { margin: 0 0 28px; color: #57534e; font-size: 11pt; }
  hr { border: 0; border-top: 1px solid #e7e5e4; margin: 24px 0; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; vertical-align: top; padding: 7px 0; font-size: 11pt; }
  th {
    width: 34%;
    font-weight: 600;
    color: #78716c;
    padding-right: 16px;
  }
  td { font-weight: 500; }
  .signature-block {
    margin-top: 28px;
    border: 1px solid #d6d3d1;
    border-radius: 8px;
    padding: 20px 24px;
    background: #fafaf9;
  }
  .sig-label {
    font-size: 9pt;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #78716c;
    margin: 0 0 6px;
  }
  .sig-name {
    font-size: 20pt;
    font-weight: 600;
    font-style: italic;
    margin: 0 0 2px;
    color: #1c1917;
  }
  .sig-meta { font-size: 10.5pt; color: #57534e; margin: 0; }
  .effect {
    margin-top: 20px;
    padding: 14px 16px;
    border-left: 3px solid #a16207;
    background: #fefce8;
    font-size: 11pt;
  }
  footer {
    margin-top: 36px;
    padding-top: 14px;
    border-top: 1px solid #e7e5e4;
    font-size: 9pt;
    color: #78716c;
  }
</style>
</head>
<body>
  <p class="eyebrow">${escapeHtml(input.partyName)}</p>
  <h1>${escapeHtml(title)}</h1>
  <p class="lede">${escapeHtml(input.subject)}</p>

  <hr />

  <table>
    <tbody>
      <tr><th>Order</th><td>${escapeHtml(input.orderCode)}</td></tr>
      ${rows}
    </tbody>
  </table>

  <div class="signature-block">
    <p class="sig-label">Signed by</p>
    <p class="sig-name">${escapeHtml(input.signedBy)}</p>
    <p class="sig-meta">for ${escapeHtml(input.partyName)}</p>
    <p class="sig-meta">${escapeHtml(formatStamp(input.signedAt))}</p>
  </div>

  <p class="effect">${escapeHtml(input.effect)}</p>

  <footer>
    This certificate was generated automatically at the moment of signature and
    is retained as the record of that decision. The signature above was entered
    by the named signatory in the client portal; the timestamp is the instant
    the decision was recorded, in Coordinated Universal Time.
  </footer>
</body>
</html>`;
}

/**
 * Where the certificate's Drive id is kept.
 *
 * Neither `proposal` nor `verdict` has a column for a document pointer, and
 * adding one means a full-replace entity migration on a schema three apps
 * share — with a dry-run endpoint that is currently broken server-side, that
 * risks dropping columns to gain a field. So the reference rides in the
 * existing free-text note instead, in a delimited form that survives being
 * read back and never collides with prose a human typed.
 *
 * This is a deliberate trade, not an accident: it is reversible, it destroys
 * nothing, and it can be lifted onto a real column the moment one exists.
 */
const CERT_RE = /\[certificate:([^:\]]+):([^\]]+)\]/;

export interface CertificateRef {
  fileId: string;
  fileName: string;
}

/** Append the pointer to whatever the signer actually wrote. */
export function withCertificateRef(note: string, ref: CertificateRef | null): string {
  const body = note.trim();
  if (!ref) return body;
  return `${body}${body ? ' ' : ''}[certificate:${ref.fileId}:${ref.fileName}]`;
}

/** Pull the pointer back out; null when the note carries none. */
export function readCertificateRef(note: string | null | undefined): CertificateRef | null {
  if (!note) return null;
  const m = CERT_RE.exec(note);
  if (!m) return null;
  return { fileId: m[1], fileName: m[2] };
}

/** The note with the machine-readable part stripped, for display. */
export function certificateNoteText(note: string | null | undefined): string {
  if (!note) return '';
  return note.replace(CERT_RE, '').trim();
}
