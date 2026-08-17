/**
 * Proof rounds, from the supplier's side of the glass.
 *
 * A proof belongs to the CLIENT's order, not to the purchase order — so a
 * supplier can only be shown one by way of a demand order they hold a PO
 * against. That is why this screen is master-detail: `supplier_po_parents`
 * establishes which demand orders are legitimately theirs, and only then are
 * that order's rounds fetched. Reading every proof and filtering in the
 * browser would put other clients' artwork on the wire.
 *
 * Pure functions, no DOM — the vitest environment here is `node`.
 */
import { asText, asNumber } from '@/lib/runtime';
import type { SupplierPoParentsRow } from '@/types/saved-queries.generated';

/**
 * `review_request` also carries Fiserv's internal margin check.
 *
 * `deal_review` rows are the buy-side sign-off on the deal — the same entity,
 * a different conversation. Showing one to a supplier would tell them their
 * own quote had been reviewed for margin.
 */
export const SUPPLIER_VISIBLE_KIND = 'proof';

/** Rounds the supplier is expected to act on: artwork not yet uploaded. */
const AWAITING_UPLOAD = new Set(['requested', 'awaiting_upload', 'not_requested', '']);

export interface ParentOrderOption {
  orderId: string;
  orderCode: string;
  poCode: string;
  brief: string;
  clientName: string;
}

/**
 * The demand orders this supplier may see proofs for, one per order.
 *
 * A supplier can hold several POs against one order (a carve-out plus the card
 * body); collapsing to the order keeps the picker one row per conversation.
 */
export function parentOptions(rows: SupplierPoParentsRow[] | undefined): ParentOrderOption[] {
  const out = new Map<string, ParentOrderOption>();
  for (const r of rows ?? []) {
    const orderId = r.parent_order?.id;
    if (!orderId || out.has(orderId)) continue;
    out.set(orderId, {
      orderId,
      orderCode: asText(r.parent_order?.order_code) || '—',
      poCode: asText(r.child_order?.order_code) || '—',
      brief: asText(r.parent_order?.order_brief) || 'No brief',
      clientName: asText(r.parent_order?.buyer_party_id?.name) || 'Client',
    });
  }
  return [...out.values()].sort((a, b) => b.orderCode.localeCompare(a.orderCode));
}

export interface SupplierProofRow {
  id: string;
  proofType: string;
  round: number;
  status: string;
  requestedAt: string | null;
  fileName: string | null;
  uploadedAt: string | null;
  /** True when the artwork is still owed by the supplier. */
  awaitingUpload: boolean;
  label: string;
}

function labelFor(status: string, awaiting: boolean): string {
  if (awaiting) return 'Upload artwork';
  switch (status) {
    case 'approved':
      return 'Approved by client';
    case 'rejected':
      return 'Changes requested';
    case 'cancelled':
      return 'Withdrawn';
    case 'uploaded':
    case 'in_review':
      return 'With client';
    default:
      return status || 'In progress';
  }
}

/** Rows come from `order_reviews`, whose shape the registry types loosely. */
export interface RawReview {
  id?: string;
  review_kind?: string | null;
  proof_type?: string | null;
  round?: number | null;
  status?: string | null;
  requested_at?: string | null;
  proof_file_name?: string | null;
  proof_uploaded_at?: string | null;
}

export function decorateSupplierProofs(rows: RawReview[] | undefined): SupplierProofRow[] {
  return (rows ?? [])
    .filter((r) => r.id && asText(r.review_kind) === SUPPLIER_VISIBLE_KIND)
    .map((r) => {
      const status = asText(r.status).toLowerCase();
      // An uploaded file settles it regardless of what the status column says:
      // the artwork is demonstrably no longer owed.
      const awaitingUpload = !r.proof_file_name && AWAITING_UPLOAD.has(status);
      return {
        id: r.id as string,
        proofType: asText(r.proof_type) || 'Proof',
        round: asNumber(r.round) ?? 1,
        status,
        requestedAt: r.requested_at ?? null,
        fileName: r.proof_file_name ?? null,
        uploadedAt: r.proof_uploaded_at ?? null,
        awaitingUpload,
        label: labelFor(status, awaitingUpload),
      } satisfies SupplierProofRow;
    })
    .sort((a, b) => {
      if (a.awaitingUpload !== b.awaitingUpload) return a.awaitingUpload ? -1 : 1;
      return b.round - a.round;
    });
}
