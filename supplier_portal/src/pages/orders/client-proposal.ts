/**
 * The client proposal document.
 *
 * Rendered to HTML here and turned into a PDF by the doc service
 * (`/doc/pdf/from-html/`), the same path the supplier spec sheet uses.
 *
 * ── What must NEVER appear on it ────────────────────────────────────────
 * Supplier cost, margin, and supplier identity. The whole business sits in
 * the spread between what a factory charges us and what the client pays; a
 * client who sees the cost knows the margin, and a client who sees the
 * supplier can go direct. `buildClientProposalHtml` therefore takes ONLY
 * sell-side figures — it is not given cost or margin at all, so a careless
 * edit cannot leak them. The CS-facing preview shows cost and margin; that
 * is a different artefact rendered in the panel, never in this document.
 */
import { escapeHtml } from './spec-sheet';

export interface ProposalDocLine {
  name: string;
  qty: number;
  /** Sell price per unit, in micros. */
  unitSellMicros: number | null;
  /** qty × unit, in micros. */
  extendedSellMicros: number | null;
}

export interface ClientProposalInput {
  appLabel: string;
  clientName: string;
  orderNo: string;
  /** Proposal version — a re-price is a new version, never an edit. */
  version: number;
  currency: string;
  lines: ProposalDocLine[];
  totalSellMicros: number;
  /** Quoted delivery, when the order carries one. */
  requestedDelivery?: string | null;
  /** How long these prices hold. */
  validUntil?: string | null;
  generatedAt: string;
}

function moneyOf(micros: number | null, currency: string): string {
  if (micros === null) return '—';
  return `${currency} ${(micros / 1_000_000).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function unitOf(micros: number | null, currency: string): string {
  return micros === null ? '—' : `${currency} ${(micros / 1_000_000).toFixed(4)}`;
}

/** Build the complete, self-contained client proposal document. */
export function buildClientProposalHtml(input: ClientProposalInput): string {
  const cur = input.currency || 'USD';
  const rows = input.lines
    .map(
      (l) => `<tr>
        <td class="desc">${escapeHtml(l.name)}</td>
        <td class="num">${escapeHtml(l.qty.toLocaleString())}</td>
        <td class="num">${escapeHtml(unitOf(l.unitSellMicros, cur))}</td>
        <td class="num strong">${escapeHtml(moneyOf(l.extendedSellMicros, cur))}</td>
      </tr>`,
    )
    .join('');

  return `<html>
<head>
<meta charset="utf-8" />
<style>
  @page { size: A4; margin: 18mm 16mm; }
  body { font-family: "Source Sans 3", "Helvetica Neue", Arial, sans-serif;
         color: #2B2F36; font-size: 11pt; }
  .head { border-bottom: 2px solid #CC9B3C; padding-bottom: 10px; margin-bottom: 18px; }
  .brand { font-size: 9.5pt; letter-spacing: .12em; text-transform: uppercase;
           color: #8A6A15; font-weight: 700; }
  h1 { font-size: 20pt; margin: 6px 0 2px; }
  .meta { font-size: 9.5pt; color: #5C6068; }
  .meta span { margin-right: 14px; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0 0; }
  th { text-align: left; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .08em;
       color: #5C6068; border-bottom: 1px solid #DCDFE4; padding: 6px 4px; }
  th.num, td.num { text-align: right; }
  td { padding: 8px 4px; border-bottom: 1px solid #F0F1F3; }
  td.desc { font-weight: 600; }
  td.strong { font-weight: 700; }
  .total td { border-top: 2px solid #2B2F36; border-bottom: 0; font-size: 12.5pt;
              font-weight: 700; padding-top: 10px; }
  .terms { margin-top: 22px; font-size: 9pt; color: #5C6068; line-height: 1.5; }
  .foot { margin-top: 22px; border-top: 1px solid #E7E9EC; padding-top: 8px;
          font-size: 8.5pt; color: #8A9099; }
</style>
</head>
<body>
  <div class="head">
    <div class="brand">${escapeHtml(input.appLabel)}</div>
    <h1>Proposal</h1>
    <div class="meta">
      <span>Prepared for <strong>${escapeHtml(input.clientName)}</strong></span>
      <span>Reference <strong>${escapeHtml(input.orderNo)}</strong></span>
      <span>Version <strong>${escapeHtml(String(input.version))}</strong></span>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th class="num">Quantity</th>
        <th class="num">Unit price</th>
        <th class="num">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
      <tr class="total">
        <td colspan="3">Total</td>
        <td class="num">${escapeHtml(moneyOf(input.totalSellMicros, cur))}</td>
      </tr>
    </tbody>
  </table>

  <div class="terms">
    ${
      input.requestedDelivery
        ? `<div>Requested delivery: <strong>${escapeHtml(input.requestedDelivery)}</strong></div>`
        : ''
    }
    ${
      input.validUntil
        ? `<div>Prices valid until: <strong>${escapeHtml(input.validUntil)}</strong></div>`
        : ''
    }
    <div>All prices in ${escapeHtml(cur)} and exclusive of tax unless stated otherwise.</div>
    <div>Acceptance of this proposal constitutes an order at the prices shown above.</div>
  </div>

  <div class="foot">
    ${escapeHtml(input.appLabel)} · ${escapeHtml(input.orderNo)} v${escapeHtml(
      String(input.version),
    )} · Generated ${escapeHtml(input.generatedAt)}
  </div>
</body>
</html>`;
}
