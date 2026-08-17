/**
 * One purchase order, as the supplier who has to build it sees it.
 *
 * Two things shape this file. First, the spec a supplier prices and prints
 * against does not live on the PO — it hangs off the item revision the demand
 * line was cut from, so the build parameters have to be joined back through
 * `item_rev_id`. Second, a split award means the supplier's quantity is NOT
 * the client's: they are told their own slice and, where we can tell, that a
 * slice exists at all — never the rival's name or price.
 *
 * Pure functions, no DOM — the vitest environment here is `node`.
 */
import { asText, asNumber } from '@/lib/runtime';
import type { SupplierPoDetailRow } from '@/types/saved-queries.generated';
import { PO_STAGES, NEXT_ACTION } from './po-helpers';

/** The build parameters, in the order a press operator reads them. */
export const SPEC_CHIPS: Array<[string, string]> = [
  ['shape', 'Shape'],
  ['substrate', 'Substrate'],
  ['thickness_mil', 'Thickness'],
  ['finish', 'Finish'],
  ['mag_stripe', 'Mag stripe'],
  ['mag_coercivity', 'Coercivity'],
  ['mag_tracks', 'Tracks'],
  ['sig_panel', 'Signature panel'],
  ['scratch_off', 'Scratch-off'],
  ['card_brand', 'Card brand'],
];

export interface SpecChip {
  key: string;
  label: string;
  value: string;
}

export interface PoLine {
  id: string;
  name: string;
  qty: number;
  uom: string;
  /** What Fiserv pays this supplier per unit. Theirs to see; the sell is not. */
  unitPrice: number | null;
  itemRevId: string | null;
  chips: SpecChip[];
  artworkPreview: string | null;
}

export interface PoMilestone {
  label: string;
  /** done — already happened · current — happening now · ahead — not yet. */
  status: 'done' | 'current' | 'ahead';
  date: string | null;
  note: string;
}

export interface PoDetail {
  id: string;
  code: string;
  brief: string;
  requestedDelivery: string | null;
  createdAt: string | null;
  instanceId: string | null;
  stage: string;
  state: string;
  stageIndex: number;
  done: boolean;
  next: (typeof NEXT_ACTION)[string];
  /** The Forge demand order this PO was raised from. */
  parentCode: string | null;
  parentId: string | null;
  parentBrief: string;
  clientName: string | null;
  lines: PoLine[];
  /** The supplier's own total across their lines. */
  totalQty: number;
  destinations: Array<{
    id: string;
    destination: string;
    qty: number;
    plannedDate: string | null;
    status: string;
    shippedQty: number;
    carrier: string | null;
    tracking: string | null;
    shipDate: string | null;
  }>;
  milestones: PoMilestone[];
}

/**
 * A spec value as a chip caption.
 *
 * Booleans arrive as real booleans, as the strings "true"/"false", and as
 * "Yes"/"No" depending on how the row was written — the declared type is not a
 * runtime guarantee, so branch on what is actually there rather than trusting
 * it. An absent value yields `null` so the caller can drop the chip entirely:
 * a chip reading "Coercivity —" is worse than no chip.
 */
export function chipValue(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return String(v);
  const s = String(v).trim();
  if (!s) return null;
  if (s.toLowerCase() === 'true') return 'Yes';
  if (s.toLowerCase() === 'false') return 'No';
  return s;
}

/**
 * A chip that reads on its own.
 *
 * The raw values are only meaningful next to their column name: `mag_stripe`
 * comes back "Yes", `sig_panel` comes back "White", `mag_tracks` comes back
 * "1 & 2". Rendered bare in a row of chips those are noise — a press operator
 * sees "Yes · White · No" and learns nothing. Each caption therefore carries
 * enough of its own label to stand alone, and a negative is stated rather than
 * dropped: "No mag stripe" is a build instruction, not an absence.
 */
export function chipCaption(key: string, value: string): string {
  switch (key) {
    case 'thickness_mil':
      return `${value} mil`;
    case 'mag_stripe':
      return value === 'Yes' ? 'Mag stripe' : 'No mag stripe';
    case 'mag_coercivity':
      return `${value} mag`;
    case 'mag_tracks':
      return `Tracks ${value}`;
    case 'sig_panel':
      return `${value} sig panel`;
    case 'scratch_off':
      return value === 'Yes' ? 'Scratch-off' : 'No scratch-off';
    default:
      return value;
  }
}

/**
 * Milestones for the PO, in the supplier's own three-stage lifecycle.
 *
 * The dates shown are the ones we can honestly stand behind: when the PO was
 * raised, and the delivery date the client is committed to. The middle
 * milestone has no date of its own — production start is the supplier's call,
 * not a date Fiserv set — so it is labelled by STATE rather than given a
 * fabricated schedule.
 */
export function buildMilestones(
  stageIndex: number,
  state: string,
  createdAt: string | null,
  requestedDelivery: string | null,
  shipDate: string | null,
): PoMilestone[] {
  const at = (i: number): PoMilestone['status'] =>
    stageIndex < 0 ? 'ahead' : i < stageIndex ? 'done' : i === stageIndex ? 'current' : 'ahead';

  const acknowledged = stageIndex > 0 || state === 'PO Acknowledged';
  const shipped = state === 'PO Shipped';

  return [
    {
      label: 'Order awarded',
      status: acknowledged ? 'done' : at(0),
      date: createdAt,
      note: acknowledged ? 'acknowledged' : 'awaiting your acknowledgment',
    },
    {
      label: 'Production',
      status: shipped ? 'done' : at(1),
      date: null,
      note:
        state === 'PO In Production'
          ? 'on the press'
          : state === 'PO Produced'
            ? 'made, ready to pack'
            : stageIndex > 1
              ? 'complete'
              : 'not started',
    },
    {
      label: 'Ship',
      status: shipped ? 'done' : at(2),
      date: shipped ? shipDate : requestedDelivery,
      note: shipped ? 'despatched' : 'target',
    },
  ];
}

export function decoratePoDetail(packet: SupplierPoDetailRow | null): PoDetail | null {
  const po = packet?.po;
  if (!po?.id) return null;

  const stage = asText(po.tq_instance?.current_task?.tq_sub_task_definition?.name);
  const state = asText(po.tq_instance?.current_status?.tq_state_definition?.state);
  const stageIndex = PO_STAGES.indexOf(stage as (typeof PO_STAGES)[number]);

  // Spec by item revision — the join order_card_spec uses. Last write wins,
  // which matches the studio: a revision has one live spec.
  const specByRev = new Map<string, NonNullable<SupplierPoDetailRow['specs']>[number]>();
  for (const s of packet?.specs ?? []) {
    const rev = s.item_rev_id?.id;
    if (rev) specByRev.set(rev, s);
  }

  const lines: PoLine[] = (packet?.lines ?? [])
    .filter((l) => l.id)
    .map((l) => {
      const revId = asText(l.item?.item_rev_id) || null;
      const spec = revId ? specByRev.get(revId) : undefined;
      const chips: SpecChip[] = [];
      for (const [key, label] of SPEC_CHIPS) {
        const raw = spec ? (spec as unknown as Record<string, unknown>)[key] : undefined;
        const v = chipValue(raw);
        if (v !== null) chips.push({ key, label, value: chipCaption(key, v) });
      }
      return {
        id: l.id as string,
        name: asText(l.item?.name) || 'Card',
        qty: asNumber(l.qty) ?? 0,
        uom: asText(l.uom) || 'each',
        unitPrice: asNumber(l.unit_price),
        itemRevId: revId,
        chips,
        artworkPreview: spec?.artwork_preview ?? null,
      } satisfies PoLine;
    });

  const shipmentByRecord = new Map<string, NonNullable<SupplierPoDetailRow['actuals']>[number]>();
  for (const a of packet?.actuals ?? []) {
    const rec = a.shipment_record?.id;
    if (rec) shipmentByRecord.set(rec, a);
  }

  const destinations = (packet?.records ?? [])
    .filter((r) => r.id)
    .map((r) => {
      const a = shipmentByRecord.get(r.id as string);
      return {
        id: r.id as string,
        destination: asText(r.destination) || 'Destination not named',
        qty: asNumber(r.qty) ?? 0,
        plannedDate: r.planned_date ?? null,
        status: asText(r.status) || 'planned',
        shippedQty: asNumber(a?.shipped_qty) ?? 0,
        carrier: a?.carrier ?? null,
        tracking: a?.tracking_no ?? null,
        shipDate: a?.ship_date ?? null,
      };
    });

  const rel = (packet?.parent ?? [])[0];
  const firstShip = destinations.find((d) => d.shipDate)?.shipDate ?? null;

  return {
    id: po.id as string,
    code: asText(po.order_code) || '—',
    brief: asText(po.order_brief) || 'No brief',
    requestedDelivery: po.requested_delivery ?? null,
    createdAt: po.created_at ?? null,
    instanceId: po.tq_instance?.id ?? null,
    stage: stage || '—',
    state: state || 'Unknown',
    stageIndex,
    done:
      po.tq_instance?.current_status?.tq_state_definition?.is_final === true &&
      stage === 'PO Dispatch',
    next: NEXT_ACTION[state] ?? null,
    parentCode: asText(rel?.parent_order?.order_code) || null,
    parentId: rel?.parent_order?.id ?? null,
    parentBrief: asText(rel?.parent_order?.order_brief) || '',
    clientName: asText(rel?.parent_order?.buyer_party_id?.name) || null,
    lines,
    totalQty: lines.reduce((sum, l) => sum + l.qty, 0),
    destinations,
    milestones: buildMilestones(
      stageIndex,
      state,
      po.created_at ?? null,
      po.requested_delivery ?? null,
      firstShip,
    ),
  } satisfies PoDetail;
}

/**
 * How this PO's quantity compares with the client's order.
 *
 * A supplier IS told when they hold only part of an order — it changes how
 * they plan a run, and hiding it invites them to assume the whole volume is
 * theirs. What they are never told is WHO holds the rest or at what price:
 * that is another supplier's commercial position. Returns null when the PO
 * covers the whole order, or when the parent's quantity is unknown.
 */
export function splitNote(myQty: number, parentQty: number | null): string | null {
  if (!parentQty || parentQty <= 0) return null;
  if (myQty >= parentQty) return null;
  const others = parentQty - myQty;
  return `Split order — your ${myQty.toLocaleString()} of ${parentQty.toLocaleString()}. Another supplier holds the other ${others.toLocaleString()}.`;
}

/**
 * Turn a failed signal into something a supplier can act on.
 *
 * The signal API answers with its own vocabulary, and the two failures that
 * actually happen mean very different things:
 *
 *   ERROR_SIGNAL_NO_ACTIVE_WORKFLOW / ERROR_SIGNAL_DATA_GET — nothing is
 *   waiting on this purchase order. In practice that means the PO predates
 *   the `create_supplier_order` workflow (its states were backfilled), so no
 *   button on this screen will ever move it. Telling the supplier to "try
 *   again" would be a lie; they need a person.
 *
 * Anything else is genuinely transient and worth retrying.
 */
export function explainSignalFailure(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  if (/NO_ACTIVE_WORKFLOW|SIGNAL_DATA_GET/i.test(raw)) {
    return 'This purchase order is not being tracked by the production workflow, so it cannot be advanced from here. Contact your Fiserv buyer to update it.';
  }
  return `Could not update the order: ${raw || 'unknown error'}. Please try again.`;
}
