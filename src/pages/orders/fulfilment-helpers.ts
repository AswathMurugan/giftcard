/**
 * Award → Produce → Proof → Ship → Bill.
 *
 * `order_fulfilment_grid` returns six unjoined lists; the joins live here so
 * they can be tested without a browser, the same split `quote-helpers` uses.
 *
 * The awkward one is that shipment records, shipments and expenses hang off
 * the SUPPLY order, not the demand order, and DynQL cannot filter through a
 * grandparent. So they come back unfiltered and are narrowed here to the
 * supply orders belonging to this order — never assume the server did it.
 */
import { asNumber, asText } from '@/lib/runtime';

export interface SupplyOrderRow {
  id?: string;
  kind?: string;
  created_at?: string;
  child_order?: {
    id?: string;
    order_code?: string;
    order_kind?: string;
    requested_delivery?: string;
    /** On a supply order this is US — the domain model's role binding. */
    buyer_party_id?: { id?: string; name?: string } | null;
    /** The supplier we are buying from. */
    seller_party_id?: { id?: string; name?: string } | null;
  } | null;
}

export interface FulfilmentAllocation {
  id?: string;
  kind?: string;
  qty?: number;
  unit_cost_micros?: number;
  component_role?: string | null;
  supplier?: { id?: string; name?: string } | null;
  assembler?: { id?: string; name?: string } | null;
  /** The DEMAND line this fulfils, with the snapshot the supply line copies. */
  order_line_ref?: { id?: string; item?: unknown; qty?: number; uom?: string } | null;
  /** The SUPPLY line raised for it — null until the award is raised. */
  supply_line?: { id?: string; qty?: number; unit_price?: number } | null;
  award_record?: { id?: string; awarded_at?: string } | null;
}

export interface ProofRow {
  id?: string;
  review_kind?: string;
  proof_type?: string;
  round?: number;
  status?: string;
  requested_at?: string;
  due_at?: string | null;
  order_line?: { id?: string } | null;
}

export interface ShipmentRecordRow {
  id?: string;
  shipment_type?: string;
  destination?: string;
  qty?: number;
  planned_date?: string | null;
  status?: string;
  supply_order?: { id?: string; order_code?: string } | null;
  order_line?: { id?: string } | null;
}

export interface ShipmentRow {
  id?: string;
  tracking_no?: string;
  carrier?: string;
  ship_date?: string | null;
  shipped_qty?: number;
  shipping_cost_micros?: number;
  shipment_record?: { id?: string } | null;
}

export interface ExpenseRow {
  id?: string;
  category?: string;
  description?: string;
  qty?: number;
  unit_cost_micros?: number;
  unit_price_micros?: number;
  status?: string;
  created_at?: string;
  supply_order?: { id?: string; order_code?: string } | null;
  bill_to_party?: { id?: string; name?: string } | null;
}

/** An approve/reject decision on a review round — a dated, attributed event. */
export interface VerdictRow {
  id?: string;
  decision?: string;
  reason_code?: string;
  comment?: string;
  decided_by?: string;
  decided_at?: string;
  review_request?: {
    id?: string;
    review_kind?: string;
    proof_type?: string;
    round?: number;
  } | null;
}

export interface FulfilmentGrid {
  relations?: SupplyOrderRow[];
  allocations?: FulfilmentAllocation[];
  reviews?: ProofRow[];
  /** Every decision taken on this order's reviews, oldest first. */
  verdicts?: VerdictRow[];
  shipment_records?: ShipmentRecordRow[];
  shipments?: ShipmentRow[];
  expenses?: ExpenseRow[];
}

/** What each supplier is owed an order for, derived from the award split. */
export interface SupplierWorkload {
  supplierId: string;
  supplierName: string;
  /** Quantity shares (kind `line`). */
  units: number;
  /** Materials carved out to this supplier. */
  carveOuts: Array<{ componentRole: string; qty: number; assemblerName: string | null }>;
  lines: number;
  costMicros: number;
  /** True once a supply order exists for this supplier. */
  ordered: boolean;
  /**
   * The allocation rows this supplier's order is built from.
   *
   * Carried through so raising the award can write one SUPPLY LINE per
   * allocation and point the allocation back at it — the domain model's
   * line-to-line Allocation, which is what a short delivery attaches to.
   */
  allocations: Array<{
    allocationId: string;
    qty: number;
    unitCostMicros: number;
    item: unknown;
    uom: string;
  }>;
}

/**
 * Group the committed allocations into one workload per supplier.
 *
 * Built from `line_allocation`, never from anything on screen: the supply
 * orders must match what was actually awarded, and the allocation rows are
 * the only record of that.
 */
export function supplierWorkloads(
  grid: FulfilmentGrid | null,
  supplyOrders: SupplyOrderRow[],
): SupplierWorkload[] {
  // The SELLER is the supplier: on a supply order we are the buyer.
  const orderedIds = new Set(
    supplyOrders.map((r) => r.child_order?.seller_party_id?.id).filter(Boolean) as string[],
  );
  const out = new Map<string, SupplierWorkload>();

  for (const a of grid?.allocations ?? []) {
    const id = a.supplier?.id;
    if (!id) continue;
    const held =
      out.get(id) ??
      ({
        supplierId: id,
        supplierName: asText(a.supplier?.name) || 'Unknown supplier',
        units: 0,
        carveOuts: [],
        lines: 0,
        costMicros: 0,
        ordered: orderedIds.has(id),
        allocations: [],
      } satisfies SupplierWorkload);

    const qty = asNumber(a.qty) ?? 0;
    const unit = asNumber(a.unit_cost_micros) ?? 0;
    held.costMicros += unit * qty;
    held.allocations.push({
      allocationId: asText(a.id),
      qty,
      unitCostMicros: unit,
      // The demand line's own item snapshot — the supply line carries the same
      // revision, so both sides of the trade name the same thing.
      item: a.order_line_ref?.item ?? null,
      uom: asText(a.order_line_ref?.uom) || 'each',
    });

    if (a.kind === 'carve_out') {
      held.carveOuts.push({
        componentRole: asText(a.component_role) || 'material',
        qty,
        assemblerName: a.assembler?.name ?? null,
      });
    } else {
      held.units += qty;
      held.lines += 1;
    }
    out.set(id, held);
  }

  // Most work first — the biggest supply order is the one to check.
  return [...out.values()].sort((a, b) => b.costMicros - a.costMicros);
}

/** Supply orders raised against this demand order. */
export function supplyOrders(grid: FulfilmentGrid | null): SupplyOrderRow[] {
  return (grid?.relations ?? []).filter((r) => r.kind === 'supply' && r.child_order?.id);
}

/**
 * Narrow rows that hang off a supply order down to THIS order's supply orders.
 *
 * The query cannot do it — these tables reference the supply order, which
 * references the demand order only through `order_relation` — so skipping this
 * would show another order's shipments and expenses as if they were ours.
 */
export function forThisOrder<T extends { supply_order?: { id?: string } | null }>(
  rows: T[] | undefined,
  supplyOrderIds: Set<string>,
): T[] {
  return (rows ?? []).filter((r) => r.supply_order?.id && supplyOrderIds.has(r.supply_order.id));
}

/** Planned vs actually shipped, per planned destination. */
export interface ShipProgress {
  record: ShipmentRecordRow;
  shipped: number;
  planned: number;
  remaining: number;
  /** planned · partial · complete — derived, never read off a status column. */
  state: 'planned' | 'partial' | 'complete';
  despatches: ShipmentRow[];
  costMicros: number;
}

export function shipProgress(
  records: ShipmentRecordRow[],
  shipments: ShipmentRow[],
): ShipProgress[] {
  return records.map((record) => {
    const despatches = shipments.filter((s) => s.shipment_record?.id === record.id);
    const shipped = despatches.reduce((n, s) => n + (asNumber(s.shipped_qty) ?? 0), 0);
    const planned = asNumber(record.qty) ?? 0;
    return {
      record,
      shipped,
      planned,
      remaining: planned - shipped,
      // Derived from the despatches rather than the stored status: the status
      // column is set once at planning and would still read "planned" after a
      // partial despatch.
      state: shipped === 0 ? 'planned' : shipped >= planned ? 'complete' : 'partial',
      despatches,
      costMicros: despatches.reduce((n, s) => n + (asNumber(s.shipping_cost_micros) ?? 0), 0),
    };
  });
}

/** Proof rounds grouped by type, newest round first. */
export function proofsByType(reviews: ProofRow[]): Array<{
  proofType: string;
  rounds: ProofRow[];
  latest: ProofRow;
}> {
  const out = new Map<string, ProofRow[]>();
  for (const r of reviews) {
    if (r.review_kind !== 'proof') continue;
    const type = asText(r.proof_type) || 'Proof';
    out.set(type, [...(out.get(type) ?? []), r]);
  }
  return [...out.entries()].map(([proofType, rounds]) => {
    const sorted = [...rounds].sort((a, b) => (asNumber(b.round) ?? 0) - (asNumber(a.round) ?? 0));
    return { proofType, rounds: sorted, latest: sorted[0] };
  });
}

/**
 * Awarded finished goods with nowhere to go yet.
 *
 * Per supply order: its supplier's quantity share minus whatever destinations
 * have already been planned against it. Carve-outs are excluded — they are
 * components of the same cards, not extra units.
 */
export function unplannedUnits(
  orders: SupplyOrderRow[],
  workloads: SupplierWorkload[],
  records: ShipmentRecordRow[],
): number {
  let total = 0;
  for (const o of orders) {
    const id = o.child_order?.id;
    const supplierId = o.child_order?.seller_party_id?.id;
    if (!id || !supplierId) continue;
    const awarded = workloads.find((w) => w.supplierId === supplierId)?.units ?? 0;
    total += Math.max(0, awarded - plannedForSupplyOrder(records, id));
  }
  return total;
}

/**
 * Whether a stage may be signalled complete.
 *
 * The workflow will accept a signal at ANY point — it has no idea whether the
 * supply orders were raised or the proofs came back. Without this the operator
 * can walk an order to Order Close having shipped nothing, and the record then
 * claims work that never happened. Each rule is the stage's own definition of
 * done, read from the data rather than from a checkbox:
 *
 *   Award    every supplier that was allocated work has a supply order
 *   Proof    every requested proof is approved, and the client-facing art
 *            proof was actually requested — an order cannot leave proofing
 *            without the client having signed the art
 *   Ship     something was planned, and every planned destination is complete
 *   Order Close  the same, re-checked: this is the signal that files the order
 *            as finished, and it is the last chance to refuse one that never
 *            actually despatched
 *
 * Produce and Bill have no data-backed exit condition (production progress is
 * not tracked here, and billable extras are optional), so they are open.
 */
export function stageGate(
  stage: string,
  input: {
    workloads: SupplierWorkload[];
    proofs: Array<{ type: string; status: string; clientFacing: boolean }>;
    progress: ShipProgress[];
    /** Awarded finished goods with no destination planned for them yet. */
    unplannedUnits?: number;
  },
): { blocked: boolean; reason: string } {
  const open = { blocked: false, reason: '' };

  if (stage === 'Award') {
    if (input.workloads.length === 0) {
      return { blocked: true, reason: 'Nothing is allocated — there is nothing to award.' };
    }
    const missing = input.workloads.filter((w) => !w.ordered);
    if (missing.length > 0) {
      return {
        blocked: true,
        reason: `No supply order yet for ${missing.map((w) => w.supplierName).join(', ')}.`,
      };
    }
    return open;
  }

  if (stage === 'Proof') {
    const requested = input.proofs.filter((p) => p.status !== 'not_requested');
    if (requested.length === 0) {
      return { blocked: true, reason: 'No proof has been requested.' };
    }
    const clientFacing = input.proofs.filter((p) => p.clientFacing);
    const unrequestedClientFacing = clientFacing.filter((p) => p.status === 'not_requested');
    if (unrequestedClientFacing.length > 0) {
      return {
        blocked: true,
        reason: `${unrequestedClientFacing[0].type} has not been requested — the client has to sign the art.`,
      };
    }
    const outstanding = requested.filter((p) => p.status !== 'approved');
    if (outstanding.length > 0) {
      return {
        blocked: true,
        reason: `${outstanding.map((p) => p.type).join(', ')} not approved yet.`,
      };
    }
    return open;
  }

  if (stage === 'Ship') {
    if (input.progress.length === 0) {
      return { blocked: true, reason: 'No destination has been planned.' };
    }
    const short = input.progress.filter((p) => p.state !== 'complete');
    if (short.length > 0) {
      return {
        blocked: true,
        reason: `${short.length} destination${short.length === 1 ? '' : 's'} still short: ${short
          .map((p) => `${p.record.destination} ${p.shipped}/${p.planned}`)
          .join(', ')}.`,
      };
    }
    // Every planned destination being complete is not the same as the ORDER
    // being shipped: with a split award, one supplier's half can be delivered
    // while the other's was never planned at all.
    if ((input.unplannedUnits ?? 0) > 0) {
      return {
        blocked: true,
        reason: `${input.unplannedUnits?.toLocaleString()} awarded units have no destination planned.`,
      };
    }
    return open;
  }

  if (stage === 'Order Close') {
    // Ship enforced this on the way past, but the workflow accepts a signal
    // from wherever the order happens to be: closing one that never despatched
    // files it as delivered work nobody sent, and closing is not reversible.
    if (input.progress.length === 0) {
      return { blocked: true, reason: 'Nothing was despatched — there is nothing to close.' };
    }
    const short = input.progress.filter((p) => p.state !== 'complete');
    if (short.length > 0) {
      return {
        blocked: true,
        reason: `${short.length} destination${short.length === 1 ? '' : 's'} never completed.`,
      };
    }
    return open;
  }

  return open;
}

/**
 * How much of a supply order's award is already planned for despatch.
 *
 * Planning more than was awarded means someone is shipping stock the supplier
 * was never asked to make, so the Ship stage needs this before it accepts a
 * destination — the quantity is the commitment, not a note.
 */
export function plannedForSupplyOrder(
  records: ShipmentRecordRow[],
  supplyOrderId: string,
): number {
  return records
    .filter((r) => r.supply_order?.id === supplyOrderId)
    .reduce((n, r) => n + (asNumber(r.qty) ?? 0), 0);
}

/** Cost, price and margin across the billable extras. */
export function expenseTotals(expenses: ExpenseRow[]): {
  costMicros: number;
  priceMicros: number;
  marginMicros: number;
  billable: number;
} {
  const cost = expenses.reduce(
    (n, e) => n + (asNumber(e.unit_cost_micros) ?? 0) * (asNumber(e.qty) ?? 0),
    0,
  );
  const price = expenses.reduce(
    (n, e) => n + (asNumber(e.unit_price_micros) ?? 0) * (asNumber(e.qty) ?? 0),
    0,
  );
  return {
    costMicros: cost,
    priceMicros: price,
    marginMicros: price - cost,
    billable: expenses.filter((e) => e.status === 'billable').length,
  };
}

/** A proposal row as `order_proposals` returns it. */
export interface ProposalStateRow {
  id?: string;
  version?: number | null;
  status?: string | null;
  accepted_at?: string | null;
  comments?: string | null;
}

/**
 * Why raising supplier orders must not proceed — or null when it may.
 *
 * A purchase order is a real commitment to a supplier. Raising one after the
 * client has DECLINED the proposal buys stock for work that was refused, and
 * nothing else in the chain catches it: the allocation is still valid, the
 * stage is still Award, and the Raise button reads as the obvious next step.
 * The client's answer lives on the proposal, so the Award gate has to look at
 * it rather than assume that reaching Award means the deal is on.
 *
 * Only the LIVE version counts — the highest one issued. An older rejected
 * version that has since been superseded is history, and blocking on it would
 * strand every order that ever went round twice.
 */
export function awardBlockedReason(
  proposals: ProposalStateRow[] | undefined,
): string | null {
  const issued = (proposals ?? []).filter((p) => {
    const s = asText(p.status).toLowerCase();
    return s && s !== 'draft';
  });
  if (issued.length === 0) return null;

  const live = issued.reduce((best, p) =>
    (asNumber(p.version) ?? 0) > (asNumber(best.version) ?? 0) ? p : best,
  );
  const status = asText(live.status).toLowerCase();
  if (status !== 'rejected') return null;

  const note = asText(live.comments);
  return `The client declined proposal v${asNumber(live.version) ?? 0}${
    note ? ` — "${note}"` : ''
  }. Re-price and issue a new version before raising supplier orders.`;
}
