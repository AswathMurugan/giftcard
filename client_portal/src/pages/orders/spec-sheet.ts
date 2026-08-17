/**
 * The supplier spec sheet — the HTML that `POST /doc/pdf/from-html/` renders.
 *
 * This is the document that leaves the building, so it is built from the same
 * `buildSpecGroups` the studio's parameter list uses. Deriving both from one
 * source is the point: a spec sheet that could drift from what the operator
 * approved on screen is worse than no spec sheet at all.
 *
 * Everything is inlined — styles in a `<style>` block, both card faces as
 * `data:` URIs. The renderer is sent `base_url: null` and so cannot fetch a
 * relative asset (and could not authenticate for one anyway), which means an
 * external reference would silently come out blank in the PDF.
 */

import type { SpecGroup } from './spec-helpers';
import { CARD_TYPES, resolveCardType } from './card-geometry';

/** Escape a value for HTML text/attribute context. */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Only `data:image/*` sources are allowed through.
 *
 * The faces come from the Fabric board as data URIs. Anything else — an
 * `http(s)` URL the renderer can't authenticate for, or a `javascript:`
 * string — is dropped rather than embedded, so a stored value that isn't
 * what we expect can't reach the document.
 */
export function safeImageSrc(value: unknown): string | null {
  return typeof value === 'string' && /^data:image\/[a-z+]+;base64,/i.test(value)
    ? value
    : null;
}

export interface SpecSheetInput {
  /** Product name shown as the document's issuer. */
  appLabel: string;
  orderNo: string;
  cardName: string;
  qty: number | null;
  /** `card_spec.shape`, used for the printed trim dimensions. */
  shape: string | null | undefined;
  groups: SpecGroup[];
  previewFront?: unknown;
  previewBack?: unknown;
  /**
   * The carrier the card is affixed to — printed from this same spec, so the
   * supplier quoting it needs to see it here. Its trim differs from the
   * card's, which is why its caption carries its own dimensions.
   */
  previewCarrier?: unknown;
  /** ISO timestamp — passed in rather than read here so the output is pure. */
  generatedAt: string;
}

function faceBlock(label: string, src: string | null, note?: string): string {
  const body = src
    ? `<img class="face-img" src="${escapeHtml(src)}" alt="${escapeHtml(label)}" />`
    : `<div class="face-empty">Not designed</div>`;
  const caption = note ? ` <span class="face-note">${escapeHtml(note)}</span>` : '';
  return `<div class="face"><div class="face-label">${escapeHtml(label)}${caption}</div>${body}</div>`;
}

function groupBlock(group: SpecGroup): string {
  const rows = group.params
    .map(
      (p) => `<tr>
        <th>${escapeHtml(p.label)}</th>
        <td class="${p.value === null ? 'unset' : ''}">${
          p.value === null ? 'Not set' : escapeHtml(p.value)
        }</td>
      </tr>`,
    )
    .join('');
  return `<section class="group">
    <h2>${escapeHtml(group.name)}</h2>
    <table>${rows}</table>
  </section>`;
}

/** Build the complete, self-contained spec-sheet document. */
export function buildSpecSheetHtml(input: SpecSheetInput): string {
  const type = resolveCardType(input.shape);
  const front = safeImageSrc(input.previewFront);
  const back = safeImageSrc(input.previewBack);
  const carrier = safeImageSrc(input.previewCarrier);
  const carrierType = CARD_TYPES.CARRIER;
  const total = input.groups.reduce((n, g) => n + g.params.length, 0);
  const set = input.groups.reduce(
    (n, g) => n + g.params.filter((p) => p.value !== null).length,
    0,
  );

  return `<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(input.cardName)} — card specification</title>
<style>
  @page { size: A4; margin: 14mm; }
  body { font-family: "Source Sans 3", "Helvetica Neue", Arial, sans-serif;
         color: #1C1C1C; font-size: 11pt; line-height: 1.45; }
  .head { border-bottom: 2px solid #9E7B19; padding-bottom: 8px; margin-bottom: 16px; }
  .brand { font-size: 9pt; letter-spacing: .14em; text-transform: uppercase; color: #9E7B19;
           font-weight: 700; }
  h1 { font-size: 19pt; margin: 4px 0 2px; }
  .meta { font-size: 9.5pt; color: #5C6068; }
  .meta span { margin-right: 14px; }
  .faces { display: flex; gap: 14px; margin: 0 0 18px; }
  .face { flex: 1; border: 1px solid #DCDFE4; border-radius: 6px; padding: 8px; }
  .face-label { font-size: 8.5pt; text-transform: uppercase; letter-spacing: .1em;
                color: #5C6068; margin-bottom: 6px; font-weight: 600; }
  .face-note { font-weight: 400; letter-spacing: 0; text-transform: none; color: #8A9099; }
  .face-img { width: 100%; height: auto; display: block; border-radius: 4px; }
  .face-empty { padding: 30px 0; text-align: center; color: #8A9099; font-size: 9.5pt;
                background: #F5F6F7; border-radius: 4px; }
  .group { margin-bottom: 14px; }
  h2 { font-size: 10pt; text-transform: uppercase; letter-spacing: .1em; color: #5C6068;
       margin: 0 0 5px; border-bottom: 1px solid #E7E9EC; padding-bottom: 3px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-weight: 400; color: #5C6068; width: 40%; padding: 3px 0;
       vertical-align: top; }
  td { padding: 3px 0; font-weight: 600; }
  td.unset { font-weight: 400; color: #8A9099; font-style: italic; }
  .foot { margin-top: 18px; border-top: 1px solid #E7E9EC; padding-top: 7px;
          font-size: 8.5pt; color: #8A9099; }
</style>
</head>
<body>
  <div class="head">
    <div class="brand">${escapeHtml(input.appLabel)} · Card specification</div>
    <h1>${escapeHtml(input.cardName)}</h1>
    <div class="meta">
      <span>Order <strong>${escapeHtml(input.orderNo)}</strong></span>
      <span>Quantity <strong>${
        typeof input.qty === 'number' ? escapeHtml(input.qty.toLocaleString()) : '—'
      }</strong></span>
      <span>Format <strong>${escapeHtml(type.label)} · ${type.widthMm} × ${
        type.heightMm
      } mm</strong></span>
    </div>
  </div>

  <div class="faces">
    ${faceBlock('Front', front)}
    ${faceBlock('Back', back)}
  </div>
  ${
    /* Its own row, not a third column: the carrier is a different, wider
       format, and squeezing it beside two card faces would print it at a
       size no one can read the artwork from. Omitted entirely when the card
       has no carrier design — the sheet reports what the record holds, and a
       "Not designed" block on every card-only order is noise. */
    carrier
      ? `<div class="faces">${faceBlock(
          'Carrier',
          carrier,
          `${carrierType.widthMm} × ${carrierType.heightMm} mm`,
        )}</div>`
      : ''
  }

  ${input.groups.map(groupBlock).join('\n  ')}

  <div class="foot">
    ${set} of ${total} parameters specified · Generated ${escapeHtml(input.generatedAt)}
  </div>
</body>
</html>`;
}
