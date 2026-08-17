/**
 * One order, as its client sees it.
 *
 * The same translation the list does — nine internal stages down to five — but
 * with the supporting detail: what was ordered, what it costs them, which
 * documents exist, and every decision they have already made. The decisions
 * matter most: a client asking "did I approve that?" should be able to see
 * the answer with a date against it.
 *
 * Pure functions, no DOM — the vitest environment here is `node`.
 */
import { asText, asNumber } from '@/lib/runtime';
import type { ClientOrderDetailRow } from '@/types/saved-queries.generated';
import { CLIENT_STAGES, clientStageIndexOf, EXPIRED_STATE } from './my-orders-helpers';
import {
  certificateNoteText,
  readCertificateRef,
  type CertificateRef,
} from '@/pages/_shared/signature-certificate';

export const MICROS = 1_000_000;

export function fromMicros(v: number | null | undefined): number {
  const n = asNumber(v);
  return n === null ? 0 : n / MICROS;
}

export interface DetailLine {
  id: string;
  name: string;
  /** The revision the line was cut from — the join key for its artwork. */
  itemRevId: string | null;
  qty: number;
  uom: string;
  unitPrice: number | null;
  /** qty × unit price, or null when the line is not priced yet. */
  amount: number | null;
}

export interface DetailDocument {
  id: string;
  version: number;
  status: string;
  totalSell: number;
  pdfName: string | null;
  sentAt: string | null;
  acceptedAt: string | null;
}

export interface DetailProof {
  id: string;
  proofType: string;
  round: number;
  status: string;
  fileName: string | null;
  requestedAt: string | null;
  awaitingYou: boolean;
}

export interface DetailEvent {
  id: string;
  what: string;
  when: string | null;
  detail: string;
  /** The typed name on the decision, when one was captured. */
  signedBy: string | null;
  /** The stored certificate, when the decision produced one. */
  certificate: CertificateRef | null;
}

export interface OrderDetail {
  id: string;
  code: string;
  brief: string;
  requestedDelivery: string | null;
  createdAt: string | null;
  instanceId: string | null;
  clientStage: string;
  blurb: string;
  stageIndex: number;
  done: boolean;
  expired: boolean;
  lines: DetailLine[];
  totalQty: number;
  /** What the order is worth to the client. Null when nothing is priced yet. */
  orderValue: number | null;
  /** Where `orderValue` came from, so the page can say which it is. */
  valueSource: 'lines' | 'proposal' | null;
  documents: DetailDocument[];
  proofs: DetailProof[];
  events: DetailEvent[];
  supplyOrderIds: string[];
  /** The card's own name — the reference titles the page with this, not the code. */
  cardName: string;
  /** The client's own artwork, for the header thumbnail. */
  artworkPreview: string | null;
  /** Delivery health, shown beside the target date. */
  health: 'on-track' | 'late' | 'done' | 'expired';
  healthLabel: string;
  /** The named steps of the reference's STATUS TIMELINE. */
  timeline: TimelineStep[];
}

export interface TimelineStep {
  label: string;
  caption: string;
  status: 'done' | 'current' | 'ahead';
}

/**
 * The status timeline, in the client's language.
 *
 * The reference names six steps with a caption each — it is a narrative, not a
 * progress bar, so each row has to say what actually happened rather than
 * repeat the step name. Captions are filled from the order's own record where
 * there is one (the proof round awaiting them, the code the order was created
 * under) and stay generic where there is not.
 *
 * `Quote accepted` is shown deliberately: naming the step does not reveal what
 * we paid for the work, and hiding it left the client with a silent gap
 * between design and production that generated support calls.
 */
const TIMELINE: Array<{ label: string; caption: string; from: string[] }> = [
  { label: 'Order placed', caption: 'Received by your account team', from: ['Order'] },
  { label: 'Spec confirmed', caption: 'Stock, finish & data mapped', from: ['Specs'] },
  { label: 'Quote accepted', caption: 'Price locked', from: ['Quote', 'Award'] },
  { label: 'In production', caption: 'Printing & personalisation', from: ['Produce'] },
  { label: 'Proof ready', caption: 'Awaiting your approval', from: ['Proof'] },
  { label: 'Shipped', caption: 'Handed to carrier', from: ['Ship', 'Bill', 'Order Close'] },
];

export function buildTimeline(
  internalStage: string,
  orderCode: string,
  openProof: DetailProof | null,
  done: boolean,
): TimelineStep[] {
  const at = TIMELINE.findIndex((t) => t.from.includes(internalStage));
  return TIMELINE.map((t, i) => {
    const status: TimelineStep['status'] =
      done || (at >= 0 && i < at) ? 'done' : at === i ? 'current' : 'ahead';
    let caption = t.caption;
    if (t.label === 'Order placed') caption = `${orderCode} created in Forge`;
    if (t.label === 'Proof ready') {
      // The generic caption reads "Awaiting your approval", which is a lie on
      // an order the client already signed off — state what happened instead.
      caption = openProof
        ? `${openProof.proofType} v${openProof.round} — awaiting your approval`
        : status === 'ahead'
          ? 'Not sent yet'
          : 'Approved by you';
    }
    return { label: t.label, caption, status };
  });
}

/**
 * Whether the order is running to time.
 *
 * Compared against the requested delivery date, not a promised ship date —
 * that is the date the client is committed to and the only one they recognise.
 * `today` is injected so the judgement is testable and one render cannot
 * straddle midnight.
 */
export function deliveryHealth(
  requestedDelivery: string | null,
  done: boolean,
  expired: boolean,
  today: string,
): { health: OrderDetail['health']; healthLabel: string } {
  if (expired) return { health: 'expired', healthLabel: 'Lapsed' };
  if (done) return { health: 'done', healthLabel: 'Delivered' };
  if (!requestedDelivery) return { health: 'on-track', healthLabel: 'On track' };
  const late = requestedDelivery.slice(0, 10) < today.slice(0, 10);
  return late
    ? { health: 'late', healthLabel: 'Past target' }
    : { health: 'on-track', healthLabel: 'On track' };
}

/** Statuses that mean the client has already answered a proof round. */
const DECIDED = new Set(['approved', 'rejected', 'cancelled']);

/** Documents a client was never shown must not be listed back to them. */
const VISIBLE_PROPOSAL = new Set(['sent', 'accepted', 'rejected', 'superseded']);

/** The only review kind a client is party to. */
const CLIENT_PROOF_KIND = 'proof';

/**
 * What the order is worth to the client, and where that number came from.
 *
 * A demand line often carries no `unit_price`: pricing on this system happens
 * on the PROPOSAL, not the line, so reading the lines alone reports "not
 * priced yet" on an order whose signed proposal says $3,187.37. That reads as
 * a contradiction on the client's own screen. So: use the lines when they are
 * priced, otherwise fall back to the live proposal, and say which it is.
 *
 * Only an ISSUED proposal counts — a document the client never saw is not a
 * price they can be quoted. `documents` is already filtered to visible
 * statuses and sorted newest-version-first by the caller.
 */
export function orderValueOf(
  pricedLines: DetailLine[],
  documents: DetailDocument[],
): { orderValue: number | null; valueSource: OrderDetail['valueSource'] } {
  if (pricedLines.length > 0) {
    return {
      orderValue: pricedLines.reduce((s, l) => s + (l.amount ?? 0), 0),
      valueSource: 'lines',
    };
  }
  // Prefer what the client actually signed; fall back to the latest issued.
  const signed = documents.find((d) => d.acceptedAt);
  const live = signed ?? documents[0];
  if (!live) return { orderValue: null, valueSource: null };
  return { orderValue: live.totalSell, valueSource: 'proposal' };
}

/**
 * The card's artwork, joined through the item revision.
 *
 * Same join `order_card_spec` uses. Returns null rather than a placeholder when
 * there is no spec yet — an empty thumbnail frame reads as "still being
 * designed", which is the truth, whereas a stock image would not be.
 */
export function artworkFor(
  packet: ClientOrderDetailRow | null,
  itemRevId: string | null,
): string | null {
  if (!itemRevId) return null;
  for (const spec of packet?.specs ?? []) {
    if (spec.item_rev_id?.id !== itemRevId) continue;
    // `artwork_preview` holds the three card faces, not one image. The FRONT
    // is the thumbnail; a card mid-design may have none of them yet.
    return usableImageSrc(spec.artwork_preview?.front);
  }
  return null;
}

/**
 * Only a value a browser can actually load.
 *
 * The declared type is not a runtime guarantee here — this column has already
 * shipped an object where a string was declared, which rendered
 * "[object Object]" into an `<img src>` and produced a broken-image icon with
 * no error anywhere. Anything that is not plainly a data: or http(s): URL is
 * treated as absent, so the page falls back to its honest empty frame.
 */
export function usableImageSrc(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!s) return null;
  return /^(data:image\/|https?:\/\/)/i.test(s) ? s : null;
}

export function decorateOrderDetail(packet: ClientOrderDetailRow | null): OrderDetail | null {
  const order = packet?.order;
  if (!order?.id) return null;

  const internal = asText(order.tq_instance?.current_task?.tq_sub_task_definition?.name);
  const state = asText(order.tq_instance?.current_status?.tq_state_definition?.state);
  const expired = state === EXPIRED_STATE;
  const index = clientStageIndexOf(internal);
  const stage = index >= 0 ? CLIENT_STAGES[index] : null;

  const lines: DetailLine[] = (packet?.lines ?? [])
    .filter((l) => l.id)
    .map((l) => {
      const qty = asNumber(l.qty) ?? 0;
      const unitPrice = asNumber(l.unit_price);
      return {
        id: l.id as string,
        name: asText(l.item?.name) || 'Card',
        itemRevId: asText(l.item?.item_rev_id) || null,
        qty,
        uom: asText(l.uom) || 'each',
        unitPrice,
        // Null, not zero: "not priced yet" and "free" are different answers.
        amount: unitPrice === null ? null : qty * unitPrice,
      } satisfies DetailLine;
    });

  const priced = lines.filter((l) => l.amount !== null);

  const documents: DetailDocument[] = (packet?.proposals ?? [])
    .filter((p) => p.id && VISIBLE_PROPOSAL.has(asText(p.status).toLowerCase()))
    .map((p) => ({
      id: p.id as string,
      version: asNumber(p.version) ?? 0,
      status: asText(p.status).toLowerCase(),
      totalSell: fromMicros(p.total_sell_micros),
      pdfName: p.pdf_name ?? null,
      sentAt: p.sent_at ?? null,
      acceptedAt: p.accepted_at ?? null,
    }))
    .sort((a, b) => b.version - a.version);

  const proofs: DetailProof[] = (packet?.reviews ?? [])
    .filter((r) => r.id && asText(r.review_kind) === CLIENT_PROOF_KIND)
    .map((r) => {
      const status = asText(r.status).toLowerCase();
      return {
        id: r.id as string,
        proofType: asText(r.proof_type) || 'Proof',
        round: asNumber(r.round) ?? 1,
        status,
        fileName: r.proof_file_name ?? null,
        requestedAt: r.requested_at ?? null,
        awaitingYou: !DECIDED.has(status),
      } satisfies DetailProof;
    })
    .sort((a, b) => b.round - a.round);

  const isDone =
    !expired &&
    internal === 'Order Close' &&
    order.tq_instance?.current_status?.tq_state_definition?.is_final === true;
  const openProof = proofs.find((p) => p.awaitingYou) ?? null;
  // One instant for the whole pass, so two fields cannot straddle midnight.
  const today = new Date().toISOString().slice(0, 10);

  return {
    id: order.id as string,
    code: asText(order.order_code) || '—',
    brief: asText(order.order_brief) || 'No description',
    requestedDelivery: order.requested_delivery ?? null,
    createdAt: order.created_at ?? null,
    instanceId: order.tq_instance?.id ?? null,
    clientStage: expired ? 'Expired' : (stage?.label ?? 'In progress'),
    blurb: expired
      ? 'This order lapsed — raise a new one'
      : (stage?.blurb ?? 'With your account team'),
    stageIndex: index,
    done: isDone,
    expired,
    lines,
    totalQty: lines.reduce((sum, l) => sum + l.qty, 0),
    ...orderValueOf(priced, documents),
    documents,
    proofs,
    events: buildEvents(packet),
    supplyOrderIds: (packet?.relations ?? [])
      .map((r) => r.child_order?.id)
      .filter((id): id is string => Boolean(id)),
    cardName: lines[0]?.name || asText(order.order_code) || 'Order',
    artworkPreview: artworkFor(packet, lines[0]?.itemRevId ?? null),
    ...deliveryHealth(order.requested_delivery ?? null, isDone, expired, today),
    timeline: buildTimeline(internal, asText(order.order_code) || '—', openProof, isDone),
  } satisfies OrderDetail;
}

/**
 * The client's own decision history, oldest first.
 *
 * Only their decisions: `deal_review` verdicts are Fiserv's internal margin
 * sign-off on the same entity, and listing one here would show a client that
 * their deal was reviewed for profitability. Proposal acceptances come from
 * the proposal rows because they are not recorded as verdicts.
 */
export function buildEvents(packet: ClientOrderDetailRow | null): DetailEvent[] {
  const events: DetailEvent[] = [];

  for (const v of packet?.verdicts ?? []) {
    if (!v.id) continue;
    if (asText(v.review_request?.review_kind) !== CLIENT_PROOF_KIND) continue;
    const decision = asText(v.decision).toLowerCase();
    const note = certificateNoteText(asText(v.comment));
    events.push({
      id: v.id as string,
      what: decision === 'approve' ? 'Proof approved' : 'Changes requested',
      when: v.decided_at ?? null,
      detail: `${asText(v.review_request?.proof_type) || 'Proof'} round ${
        asNumber(v.review_request?.round) ?? 1
      }${note ? ` — ${note}` : ''}`,
      signedBy: asText(v.decided_by) || null,
      certificate: readCertificateRef(asText(v.comment)),
    });
  }

  for (const p of packet?.proposals ?? []) {
    if (!p.id || !p.accepted_at) continue;
    events.push({
      id: `${p.id}-accepted`,
      what: 'Proposal signed',
      when: p.accepted_at,
      detail: `Version ${asNumber(p.version) ?? 0}`,
      signedBy: null,
      certificate: readCertificateRef(asText(p.comments)),
    });
  }

  return events.sort((a, b) => (a.when ?? '').localeCompare(b.when ?? ''));
}
