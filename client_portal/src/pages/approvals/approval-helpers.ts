/**
 * The documents a client signs.
 *
 * A proposal is versioned, and supersession is a change order rather than an
 * in-place edit — so an order can carry several. Only ONE of them is ever the
 * live document: the highest version that has actually been issued. Older
 * versions stay listed as history, and drafts must never appear at all.
 *
 * Pure functions, no DOM — the vitest environment here is `node`.
 */
import { asText, asNumber } from '@/lib/runtime';
import type { ClientProposalListRow } from '@/types/saved-queries.generated';

export const MICROS = 1_000_000;

export function fromMicros(v: number | null | undefined): number {
  const n = asNumber(v);
  return n === null ? 0 : n / MICROS;
}

export function formatUsd(dollars: number): string {
  return dollars.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * A draft is Fiserv's unissued working version.
 *
 * It carries real pricing that has not been put to the client, so showing one
 * would quote a number nobody committed to. Filtered out before anything else.
 */
export const CLIENT_VISIBLE_STATUSES = new Set(['sent', 'accepted', 'rejected', 'superseded']);

export interface ApprovalRow {
  id: string;
  orderId: string;
  orderCode: string;
  brief: string;
  version: number;
  status: string;
  totalSell: number;
  currency: string;
  pdfFileId: string | null;
  pdfName: string | null;
  sentAt: string | null;
  acceptedAt: string | null;
  requestedDelivery: string | null;
  /** Carries the signature-certificate pointer; see signature-certificate.ts. */
  comments: string | null;
  /** True when this is the live version AND the client has not answered. */
  awaitingYou: boolean;
  label: string;
}

function labelFor(status: string, awaiting: boolean): string {
  if (awaiting) return 'Awaiting your signature';
  switch (status) {
    case 'accepted':
      return 'Signed';
    case 'rejected':
      return 'Declined';
    case 'superseded':
      return 'Superseded';
    case 'sent':
      return 'Issued';
    default:
      return status || 'In progress';
  }
}

export function decorateApprovals(rows: ClientProposalListRow[] | undefined): ApprovalRow[] {
  const visible = (rows ?? []).filter(
    (r) => r.id && CLIENT_VISIBLE_STATUSES.has(asText(r.status).toLowerCase()),
  );

  // The live version per order — the highest one that was issued. Anything
  // below it is history even if the backend never marked it superseded.
  const liveVersion = new Map<string, number>();
  for (const r of visible) {
    const orderId = r.order_ref?.id;
    if (!orderId) continue;
    const v = asNumber(r.version) ?? 0;
    if (v > (liveVersion.get(orderId) ?? -1)) liveVersion.set(orderId, v);
  }

  return visible
    .map((r) => {
      const orderId = r.order_ref?.id ?? '';
      const version = asNumber(r.version) ?? 0;
      const status = asText(r.status).toLowerCase();
      const isLive = liveVersion.get(orderId) === version;
      // Only the live, issued, unanswered version is actionable. Signing a
      // superseded version would accept pricing that has been replaced.
      const awaitingYou = isLive && status === 'sent' && !r.accepted_at;
      return {
        id: r.id as string,
        orderId,
        orderCode: asText(r.order_ref?.order_code) || '—',
        brief: asText(r.order_ref?.order_brief) || 'No description',
        version,
        status,
        totalSell: fromMicros(r.total_sell_micros),
        currency: asText(r.currency) || 'USD',
        pdfFileId: r.pdf_file_id ?? null,
        pdfName: r.pdf_name ?? null,
        sentAt: r.sent_at ?? null,
        acceptedAt: r.accepted_at ?? null,
        requestedDelivery: r.order_ref?.requested_delivery ?? null,
        comments: r.comments ?? null,
        awaitingYou,
        label: labelFor(status, awaitingYou),
      } satisfies ApprovalRow;
    })
    .sort((a, b) => {
      if (a.awaitingYou !== b.awaitingYou) return a.awaitingYou ? -1 : 1;
      if (a.orderCode !== b.orderCode) return b.orderCode.localeCompare(a.orderCode);
      return b.version - a.version;
    });
}

/** How many documents are waiting on the client right now. */
export function waitingCount(rows: ApprovalRow[]): number {
  return rows.filter((r) => r.awaitingYou).length;
}
