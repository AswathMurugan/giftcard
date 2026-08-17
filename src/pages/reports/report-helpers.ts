/**
 * Reports — the seven views, computed from what the tenant actually holds.
 *
 * The demo defines the shape: seven reports, their columns, a scope toggle and
 * Save/Schedule/Export. It does NOT define the arithmetic — every figure in it
 * is a hard-coded string. So the definitions live here, and each one is stated
 * in the function that computes it rather than left to the reader of a table.
 *
 * Two rules run through all of them:
 *
 *   A demand order is one that is not somebody's supply order. `order_kind` is
 *   not trustworthy — seventeen early orders carry 'merchant' there, the party
 *   kind having been written into the order kind — so demand is derived from
 *   `order_relation`: anything appearing as a child is a supply order.
 *
 *   Nothing is invented to fill a column. Where the tenant cannot answer a
 *   question the demo asks (delivery confirmation, for one), the report says so
 *   instead of showing a plausible number.
 */
import { asNumber, asText } from '@/lib/runtime';
import { stageOfState, type StageDefinition } from '@/pages/orders/stage-helpers';

/* ── Rows as `report_board` returns them ──────────────────────────────── */

export interface ReportOrderRow {
  id?: string;
  order_code?: string;
  order_kind?: string;
  order_type?: string;
  requested_delivery?: string | null;
  created_at?: string | null;
  order_brief?: string | null;
  created_by?: { id?: string; full_name?: string | null } | null;
  buyer_party_id?: { id?: string; name?: string } | null;
  tq_instance?: {
    id?: string;
    current_status?: { tq_state_definition?: { state?: string } | null } | null;
  } | null;
}

export interface ReportRelationRow {
  kind?: string;
  parent_order?: { id?: string } | null;
  child_order?: {
    id?: string;
    order_code?: string;
    seller_party_id?: { name?: string } | null;
  } | null;
}

export interface ReportAllocationRow {
  kind?: string;
  qty?: number;
  unit_cost_micros?: number;
  component_role?: string | null;
  order_ref?: { id?: string } | null;
  supplier?: { name?: string } | null;
}

export interface ReportPlanItemRow {
  milestone_type?: string;
  target_date?: string | null;
  actual_date?: string | null;
  owner_role?: string | null;
  plan?: { id?: string; status?: string; subject_order?: { id?: string } | null } | null;
}

export interface ReportRfeRow {
  id?: string;
  status?: string;
  sent_at?: string | null;
  respond_by?: string | null;
  supplier?: { name?: string } | null;
  demand_order?: { id?: string } | null;
}

export interface ReportResponseRow {
  id?: string;
  status?: string;
  round?: number;
  lead_time_weeks?: number | null;
  submitted_at?: string | null;
  rfe?: { id?: string } | null;
}

export interface ReportReviewRow {
  id?: string;
  review_kind?: string;
  proof_type?: string | null;
  round?: number;
  status?: string;
  requested_at?: string | null;
  subject_order?: { id?: string } | null;
}

export interface ReportShipmentRecordRow {
  id?: string;
  destination?: string | null;
  qty?: number;
  status?: string;
  planned_date?: string | null;
  supply_order?: { id?: string } | null;
}

export interface ReportShipmentRow {
  shipped_qty?: number;
  ship_date?: string | null;
  carrier?: string | null;
  shipping_cost_micros?: number;
  shipment_record?: { id?: string } | null;
}

export interface ReportStateEntryRow {
  created_at?: string | null;
  tq_state_definition?: { state?: string } | null;
  tq_sub_task_instance?: { id?: string; tq_instance?: { id?: string } | null } | null;
}

export interface ReportBoard {
  orders?: ReportOrderRow[];
  relations?: ReportRelationRow[];
  allocations?: ReportAllocationRow[];
  plan_items?: ReportPlanItemRow[];
  rfes?: ReportRfeRow[];
  responses?: ReportResponseRow[];
  reviews?: ReportReviewRow[];
  shipment_records?: ReportShipmentRecordRow[];
  shipments?: ReportShipmentRow[];
  state_entries?: ReportStateEntryRow[];
}

/* ── The report catalogue, in the demo's order ────────────────────────── */

export const REPORTS = [
  // `icon_-Tb_filter` rather than the demo's funnel: Nucleo carries no funnel
  // glyph, and a class it does not define renders as blank space with no error.
  { id: 'pipeline', icon: 'icon_-Tb_filter', title: 'Pipeline', sub: 'Open orders by stage and awarded cost' },
  { id: 'atrisk', icon: 'icon_-Tb_alert_triangle', title: 'At-Risk This Week', sub: 'Flagged orders and why' },
  { id: 'milestones', icon: 'icon_-Tb_flag', title: 'Milestone Performance', sub: 'Target vs actual, stamped from events' },
  { id: 'activity', icon: 'icon_-Tb_arrows_exchange', title: 'RFE & Supplier Activity', sub: 'RFEs, quotes, win rate, SO status' },
  { id: 'proofing', icon: 'icon_-Tb_checkup_list', title: 'Proofing Status', sub: 'Proof rounds by state' },
  { id: 'shipping', icon: 'icon_-Tb_truck_delivery', title: 'Shipping Status', sub: 'Planned against despatched' },
  { id: 'aging', icon: 'icon_-Tb_hourglass', title: 'Order Aging & Cycle Time', sub: 'Time in stage — spot the stuck' },
  { id: 'expired', icon: 'icon_-Tb_clock_x', title: 'Expired Orders', sub: 'Lapsed on no response — and what was already committed' },
] as const;

export type ReportId = (typeof REPORTS)[number]['id'];

/**
 * The state an order lands in when a stage's wait for a response runs out.
 *
 * Terminal, and equivalent to Closed for every "is this still live" question:
 * the run is over and it cannot be resumed — a replacement is raised as a new
 * order.
 */
export const EXPIRED_STATE = 'Expired';

/**
 * A finished order is not pipeline. These are the states that end one.
 *
 * `Expired` belongs here for the same reason `Closed` does. Without it an
 * order that lapsed months ago keeps counting as open: it sits in Pipeline,
 * shows up At-Risk, and accrues "days late" against a delivery date nobody is
 * working towards — the reports would carry dead work forever.
 */
const CLOSED_STATES = new Set(['Closed', 'Cancelled', EXPIRED_STATE]);

/* ── Shared derivations ───────────────────────────────────────────────── */

export interface OrderFacts {
  id: string;
  code: string;
  client: string;
  clientId: string;
  /** Live TQ state, falling back to the status jsonb snapshot. */
  state: string;
  stage: string;
  requestedDelivery: string | null;
  createdAt: string | null;
  owner: string;
  /** Sum of the committed allocations — cost, not the client's price. */
  awardedCostMicros: number;
  suppliers: string[];
  open: boolean;
  /** Whole days past the requested delivery date; 0 when not late. */
  daysLate: number;
  /** When the order entered the state it is in, if the workflow recorded it. */
  stageEnteredAt: string | null;
}

/**
 * Resolve every order once, so the seven reports agree with each other.
 *
 * `today` is passed in rather than read from the clock: a report that computes
 * "days late" from `new Date()` cannot be tested, and two panels rendering a
 * millisecond apart could disagree about whether something is overdue.
 */
export function orderFacts(
  board: ReportBoard | null | undefined,
  stages: StageDefinition[] | undefined,
  today: string,
): OrderFacts[] {
  const relations = board?.relations ?? [];
  const supplyIds = new Set(
    relations.map((r) => r.child_order?.id).filter(Boolean) as string[],
  );

  const costByOrder = new Map<string, number>();
  const suppliersByOrder = new Map<string, Set<string>>();
  for (const a of board?.allocations ?? []) {
    const id = a.order_ref?.id;
    if (!id) continue;
    costByOrder.set(
      id,
      (costByOrder.get(id) ?? 0) + (asNumber(a.unit_cost_micros) ?? 0) * (asNumber(a.qty) ?? 0),
    );
    const name = asText(a.supplier?.name);
    if (name) suppliersByOrder.set(id, (suppliersByOrder.get(id) ?? new Set()).add(name));
  }

  // The latest current-state row per workflow instance is when the order
  // arrived where it is. Every stage keeps its own current row, so the newest
  // one is the live stage rather than the first stage it ever entered.
  const enteredByInstance = new Map<string, string>();
  for (const e of board?.state_entries ?? []) {
    const instance = e.tq_sub_task_instance?.tq_instance?.id;
    const at = e.created_at;
    if (!instance || !at) continue;
    const held = enteredByInstance.get(instance);
    if (!held || at > held) enteredByInstance.set(instance, at);
  }

  return (board?.orders ?? [])
    .filter((o) => o.id && !supplyIds.has(o.id))
    .map((o) => {
      const id = o.id as string;
      // The task instance is the only source of state. The `orders.status`
      // jsonb fallback that used to sit here was a stale intake snapshot —
      // it reported "Order Received" for Closed and Expired orders, which
      // silently mis-bucketed every report that reads `open`.
      const state =
        asText(o.tq_instance?.current_status?.tq_state_definition?.state) || 'Pending';
      const delivery = o.requested_delivery ?? null;
      const open = !CLOSED_STATES.has(state);
      return {
        id,
        code: asText(o.order_code) || '—',
        client: asText(o.buyer_party_id?.name) || '—',
        clientId: asText(o.buyer_party_id?.id),
        state,
        stage: stageOfState(stages, state) ?? '—',
        requestedDelivery: delivery,
        createdAt: o.created_at ?? null,
        owner: asText(o.created_by?.full_name) || '—',
        awardedCostMicros: costByOrder.get(id) ?? 0,
        suppliers: [...(suppliersByOrder.get(id) ?? [])].sort(),
        open,
        daysLate: delivery && open ? Math.max(0, daysBetween(delivery, today)) : 0,
        stageEnteredAt: o.tq_instance?.id
          ? (enteredByInstance.get(o.tq_instance.id) ?? null)
          : null,
      } satisfies OrderFacts;
    });
}

/** Whole days from `from` to `to`, both `YYYY-MM-DD` or ISO. UTC, no drift. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(from.slice(0, 10) + 'T00:00:00Z');
  const b = Date.parse(to.slice(0, 10) + 'T00:00:00Z');
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

export function money(micros: number): string {
  return `$${(micros / 1_000_000).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * The figure that sits under a pipeline bar, in as few characters as possible.
 *
 * The demo prints `$0.6M` because its numbers are invented millions. This
 * tenant's awarded totals are four and five figures, so a fixed `M` scale would
 * render every bar as `$0.0M`. Compact notation picks the unit from the number
 * — `$19.2K`, `$1.4M` — which reads the same way without lying about the size.
 */
export function compactMoney(micros: number): string {
  const dollars = micros / 1_000_000;
  if (dollars === 0) return '$0';
  return `$${dollars.toLocaleString(undefined, {
    notation: 'compact',
    maximumFractionDigits: 1,
  })}`;
}

/** `2026-07-29` → `Jul 29`. Parsed as UTC so the day cannot shift westward. */
export function shortDate(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.parse(iso.slice(0, 10) + 'T00:00:00Z');
  if (Number.isNaN(ms)) return '—';
  return new Date(ms).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export type SlaTone = 'over' | 'watch' | 'ontrack' | 'none';

export interface Sla {
  label: string;
  tone: SlaTone;
}

/** An order this close to its requested delivery is worth watching, not chasing. */
export const WATCH_WITHIN_DAYS = 7;

/**
 * How an open order is tracking against its requested delivery.
 *
 * The demo hard-codes four tones — over / watch / on track / done — and never
 * says what separates them, so the thresholds are decided here. `done` is not
 * among them: Pipeline shows open orders only, and an order that reached `done`
 * has left the pipeline by definition. An order with no requested delivery
 * reports `none` rather than `on track`, because having no date is not the same
 * as being comfortably inside one.
 */
export function slaOf(order: OrderFacts, today: string): Sla {
  if (order.daysLate > 0) return { label: `${order.daysLate}d over`, tone: 'over' };
  if (!order.requestedDelivery) return { label: 'no date', tone: 'none' };
  const left = daysBetween(today, order.requestedDelivery);
  if (left <= WATCH_WITHIN_DAYS) return { label: left === 0 ? 'due today' : `${left}d left`, tone: 'watch' };
  return { label: 'on track', tone: 'ontrack' };
}

/* ── 1. Pipeline ──────────────────────────────────────────────────────── */

export interface PipelineStage {
  stage: string;
  count: number;
  costMicros: number;
}

export interface PipelineReport {
  stages: PipelineStage[];
  rows: OrderFacts[];
  summary: string;
}

/**
 * Open orders by stage.
 *
 * "Value" in the demo is the awarded COST here, not the client's price: the
 * sell side only exists once a proposal is priced, so showing it as value
 * would leave every pre-award order at zero and flatter the ones past it.
 */
export function pipelineReport(facts: OrderFacts[], order: string[]): PipelineReport {
  const open = facts.filter((f) => f.open);
  const byStage = new Map<string, PipelineStage>();
  /**
   * Seed EVERY lifecycle stage at zero before counting.
   *
   * A chart built only from the stages that happen to hold work changes shape
   * as the book moves: the same picture showed one bar today and six last
   * week, and an empty stage — nothing in Proof, nothing in Ship — simply
   * vanished rather than reading as the zero it is. Where the work is NOT is
   * as much of the answer as where it is, so the row is the process, and the
   * bars are what sits on it.
   */
  for (const stage of order) {
    byStage.set(stage, { stage, count: 0, costMicros: 0 });
  }
  for (const f of open) {
    const held = byStage.get(f.stage) ?? { stage: f.stage, count: 0, costMicros: 0 };
    held.count += 1;
    held.costMicros += f.awardedCostMicros;
    byStage.set(f.stage, held);
  }
  const stages = [...byStage.values()].sort(
    (a, b) => indexOfStage(order, a.stage) - indexOfStage(order, b.stage),
  );
  const total = open.reduce((n, f) => n + f.awardedCostMicros, 0);
  return {
    stages,
    rows: [...open].sort((a, b) => (a.requestedDelivery ?? '').localeCompare(b.requestedDelivery ?? '')),
    summary: `${open.length} open order${open.length === 1 ? '' : 's'} · ${money(total)} awarded so far.`,
  };
}

function indexOfStage(order: string[], stage: string): number {
  const i = order.indexOf(stage);
  return i < 0 ? order.length : i;
}

/* ── 2. At-Risk ───────────────────────────────────────────────────────── */

export interface AtRiskRow {
  order: OrderFacts;
  why: string;
  days: number;
}

export interface AtRiskReport {
  rows: AtRiskRow[];
  summary: string;
}

/**
 * Orders that will not land on time unless something changes.
 *
 * Two independent reasons, both read from data rather than a flag: the order
 * is past its requested delivery, or a milestone it has already published is
 * overdue with no actual stamped against it. An order can be flagged by the
 * second before it is late by the first, which is the entire point — that is
 * the week's warning rather than the post-mortem.
 */
export function atRiskReport(
  facts: OrderFacts[],
  plans: ReportPlanItemRow[],
  today: string,
): AtRiskReport {
  const overdueByOrder = new Map<string, { type: string; days: number }>();
  for (const p of plans) {
    const id = p.plan?.subject_order?.id;
    if (!id || p.actual_date || !p.target_date) continue;
    const late = daysBetween(p.target_date, today);
    if (late <= 0) continue;
    const held = overdueByOrder.get(id);
    if (!held || late > held.days) {
      overdueByOrder.set(id, { type: asText(p.milestone_type) || 'A milestone', days: late });
    }
  }

  const rows: AtRiskRow[] = [];
  for (const f of facts) {
    if (!f.open) continue;
    const milestone = overdueByOrder.get(f.id);
    if (f.daysLate > 0) {
      rows.push({
        order: f,
        why: milestone
          ? `${f.daysLate}d past requested delivery · ${milestone.type} overdue`
          : `${f.daysLate}d past requested delivery`,
        days: f.daysLate,
      });
    } else if (milestone) {
      rows.push({
        order: f,
        why: `${milestone.type} overdue by ${milestone.days}d`,
        days: milestone.days,
      });
    }
  }
  rows.sort((a, b) => b.days - a.days);

  const late = rows.filter((r) => r.order.daysLate > 0).length;
  const milestoneOnly = rows.length - late;
  return {
    rows,
    summary:
      rows.length === 0
        ? 'Nothing at risk — every open order is inside its dates.'
        : `${rows.length} order${rows.length === 1 ? '' : 's'} at risk · ${late} past delivery, ${milestoneOnly} on a slipped milestone.`,
  };
}

/* ── 3. Milestone performance ─────────────────────────────────────────── */

export type MilestoneState = 'Met' | 'Late' | 'Overdue' | 'Pending';

export interface MilestoneRow {
  code: string;
  client: string;
  milestone: string;
  target: string;
  actual: string;
  state: MilestoneState;
  owner: string;
}

export interface MilestoneReport {
  rows: MilestoneRow[];
  onTimePct: number | null;
  summary: string;
}

/**
 * Target against actual, for milestones that have a target.
 *
 * On-time is measured over milestones that actually happened — a pending one
 * is not yet a failure, and counting it as one would drag the percentage down
 * every time a plan is published. Late and Overdue are kept apart because they
 * ask for different things: Late is a post-mortem, Overdue is a job today.
 */
export function milestoneReport(
  facts: OrderFacts[],
  plans: ReportPlanItemRow[],
  today: string,
): MilestoneReport {
  const byId = new Map(facts.map((f) => [f.id, f]));
  const rows: MilestoneRow[] = [];

  for (const p of plans) {
    const order = byId.get(asText(p.plan?.subject_order?.id));
    if (!order || !p.target_date) continue;
    const actual = p.actual_date ?? null;
    const state: MilestoneState = actual
      ? daysBetween(p.target_date, actual) > 0
        ? 'Late'
        : 'Met'
      : daysBetween(p.target_date, today) > 0
        ? 'Overdue'
        : 'Pending';
    rows.push({
      code: order.code,
      client: order.client,
      milestone: asText(p.milestone_type) || '—',
      target: p.target_date,
      actual: actual ?? '—',
      state,
      owner: asText(p.owner_role) || '—',
    });
  }

  rows.sort((a, b) => a.target.localeCompare(b.target) || a.code.localeCompare(b.code));

  const done = rows.filter((r) => r.state === 'Met' || r.state === 'Late');
  const met = done.filter((r) => r.state === 'Met').length;
  const onTimePct = done.length === 0 ? null : Math.round((met / done.length) * 100);
  const overdue = rows.filter((r) => r.state === 'Overdue').length;

  return {
    rows,
    onTimePct,
    summary:
      done.length === 0
        ? 'No milestone has come due yet.'
        : `${met} of ${done.length} met on time${overdue > 0 ? ` · ${overdue} overdue now` : ''}.`,
  };
}

/* ── 4. RFE & supplier activity ───────────────────────────────────────── */

export interface RfeRow {
  supplier: string;
  code: string;
  sent: string;
  status: string;
  leadWeeks: number | null;
  /** Sent, still unanswered, and older than the nudge threshold. */
  stalled: boolean;
}

export interface SupplyOrderRow {
  code: string;
  supplier: string;
  parentCode: string;
}

export interface ActivityReport {
  rows: RfeRow[];
  supplyOrders: SupplyOrderRow[];
  rfesOut: number;
  quotesIn: number;
  /** Share of quoting suppliers that went on to win work. Null if none quoted. */
  winRatePct: number | null;
  summary: string;
}

/** An RFE unanswered for this long is worth chasing — the demo's "nudge". */
export const STALLED_AFTER_DAYS = 2;

/**
 * What is out with suppliers, and how often asking turns into awarding.
 *
 * Win rate is deliberately supplier-and-order specific: of the quotes that
 * came back, the share whose supplier ended up holding an allocation on that
 * same order. Counting won ORDERS instead would read as 100% the moment every
 * order was awarded to somebody, which says nothing about the quoting.
 */
export function activityReport(
  facts: OrderFacts[],
  board: ReportBoard | null | undefined,
  today: string,
): ActivityReport {
  const byId = new Map(facts.map((f) => [f.id, f]));
  const responsesByRfe = new Map<string, ReportResponseRow>();
  for (const r of board?.responses ?? []) {
    const id = r.rfe?.id;
    if (!id) continue;
    const held = responsesByRfe.get(id);
    if (!held || (asNumber(r.round) ?? 0) >= (asNumber(held.round) ?? 0)) {
      responsesByRfe.set(id, r);
    }
  }

  const rows: RfeRow[] = [];
  let won = 0;
  let quoted = 0;

  for (const rfe of board?.rfes ?? []) {
    const order = byId.get(asText(rfe.demand_order?.id));
    const supplier = asText(rfe.supplier?.name) || '—';
    const response = rfe.id ? responsesByRfe.get(rfe.id) : undefined;
    const sent = rfe.sent_at ?? null;
    const answered = Boolean(response);

    if (answered && order) {
      quoted += 1;
      if (order.suppliers.includes(supplier)) won += 1;
    }

    rows.push({
      supplier,
      code: order?.code ?? '—',
      sent: sent ? sent.slice(0, 10) : '—',
      status: answered ? 'Quoted' : (asText(rfe.status) || 'sent'),
      leadWeeks: asNumber(response?.lead_time_weeks),
      stalled: !answered && Boolean(sent) && daysBetween(sent as string, today) > STALLED_AFTER_DAYS,
    });
  }
  rows.sort((a, b) => b.sent.localeCompare(a.sent));

  const supplyOrders: SupplyOrderRow[] = (board?.relations ?? [])
    .filter((r) => r.kind === 'supply' && r.child_order?.order_code)
    .map((r) => ({
      code: asText(r.child_order?.order_code),
      supplier: asText(r.child_order?.seller_party_id?.name) || '—',
      parentCode: byId.get(asText(r.parent_order?.id))?.code ?? '—',
    }))
    .sort((a, b) => a.code.localeCompare(b.code));

  const stalled = rows.filter((r) => r.stalled).length;
  return {
    rows,
    supplyOrders,
    rfesOut: rows.length,
    quotesIn: quoted,
    winRatePct: quoted === 0 ? null : Math.round((won / quoted) * 100),
    summary:
      stalled === 0
        ? `${rows.length} RFE${rows.length === 1 ? '' : 's'} out · ${quoted} quoted.`
        : `${stalled} RFE${stalled === 1 ? '' : 's'} unanswered beyond ${STALLED_AFTER_DAYS} days — worth a nudge.`,
  };
}

/* ── 5. Proofing ──────────────────────────────────────────────────────── */

export interface ProofRow {
  code: string;
  client: string;
  proof: string;
  round: number;
  state: string;
}

export interface ProofingReport {
  rows: ProofRow[];
  summary: string;
}

/** Proof rounds only — a deal review is a review_request too, and is not a proof. */
export function proofingReport(facts: OrderFacts[], reviews: ReportReviewRow[]): ProofingReport {
  const byId = new Map(facts.map((f) => [f.id, f]));
  const rows = reviews
    .filter((r) => r.review_kind === 'proof')
    .map((r) => {
      const order = byId.get(asText(r.subject_order?.id));
      return {
        code: order?.code ?? '—',
        client: order?.client ?? '—',
        proof: asText(r.proof_type) || 'Proof',
        round: asNumber(r.round) ?? 1,
        state: asText(r.status) || '—',
      } satisfies ProofRow;
    })
    .sort((a, b) => a.code.localeCompare(b.code) || a.proof.localeCompare(b.proof));

  const open = rows.filter((r) => r.state !== 'approved').length;
  return {
    rows,
    summary:
      rows.length === 0
        ? 'No proof has been requested yet.'
        : `${rows.length} proof round${rows.length === 1 ? '' : 's'} · ${open} still open.`,
  };
}

/* ── 6. Shipping ──────────────────────────────────────────────────────── */

export interface ShippingRow {
  code: string;
  client: string;
  planned: number;
  despatched: number;
  outstanding: number;
  destinations: number;
}

export interface ShippingReport {
  rows: ShippingRow[];
  planned: number;
  despatched: number;
  summary: string;
  /**
   * The demo has a Delivered column. Nothing in this tenant records a delivery
   * — a shipment carries a despatch date and a tracking number and stops there
   * — so the column is reported as unavailable rather than filled with the
   * despatched figure under a different heading.
   */
  deliveryTracked: false;
}

export function shippingReport(
  facts: OrderFacts[],
  board: ReportBoard | null | undefined,
): ShippingReport {
  const byId = new Map(facts.map((f) => [f.id, f]));
  // Shipments hang off the SUPPLY order, so walk back to the demand order.
  const parentOfSupply = new Map<string, string>();
  for (const r of board?.relations ?? []) {
    const child = r.child_order?.id;
    const parent = r.parent_order?.id;
    if (child && parent) parentOfSupply.set(child, parent);
  }
  const shippedByRecord = new Map<string, number>();
  for (const s of board?.shipments ?? []) {
    const id = s.shipment_record?.id;
    if (!id) continue;
    shippedByRecord.set(id, (shippedByRecord.get(id) ?? 0) + (asNumber(s.shipped_qty) ?? 0));
  }

  const acc = new Map<string, ShippingRow>();
  for (const rec of board?.shipment_records ?? []) {
    const demandId = parentOfSupply.get(asText(rec.supply_order?.id));
    const order = demandId ? byId.get(demandId) : undefined;
    if (!order) continue;
    const held =
      acc.get(order.id) ??
      ({
        code: order.code,
        client: order.client,
        planned: 0,
        despatched: 0,
        outstanding: 0,
        destinations: 0,
      } satisfies ShippingRow);
    held.planned += asNumber(rec.qty) ?? 0;
    held.despatched += rec.id ? (shippedByRecord.get(rec.id) ?? 0) : 0;
    held.destinations += 1;
    held.outstanding = Math.max(0, held.planned - held.despatched);
    acc.set(order.id, held);
  }

  const rows = [...acc.values()].sort((a, b) => a.code.localeCompare(b.code));
  const planned = rows.reduce((n, r) => n + r.planned, 0);
  const despatched = rows.reduce((n, r) => n + r.despatched, 0);
  const short = rows.filter((r) => r.outstanding > 0).length;

  return {
    rows,
    planned,
    despatched,
    deliveryTracked: false,
    summary:
      rows.length === 0
        ? 'Nothing planned for despatch yet.'
        : `${despatched.toLocaleString()} of ${planned.toLocaleString()} units despatched · ${short} order${
            short === 1 ? '' : 's'
          } still short.`,
  };
}

/* ── 7. Aging & cycle time ────────────────────────────────────────────── */

export interface AgingRow {
  code: string;
  client: string;
  stage: string;
  /** Days in the current stage, or null when the workflow recorded no entry. */
  inStage: number | null;
  totalAge: number;
  stuck: boolean;
}

export interface AgingReport {
  rows: AgingRow[];
  avgAgeDays: number | null;
  summary: string;
}

/** Longer than this in one stage and the order is worth a look. */
export const STUCK_AFTER_DAYS = 7;

/**
 * How long orders have been running, and how long they have sat where they are.
 *
 * In-stage comes from the workflow's own current-state rows, not from a guess:
 * an order whose instance recorded nothing reports null rather than zero,
 * because zero would read as "arrived today" and hide exactly the stalls this
 * report exists to surface.
 */
export function agingReport(facts: OrderFacts[], today: string): AgingReport {
  const open = facts.filter((f) => f.open);
  const rows = open
    .map((f) => {
      const inStage = f.stageEnteredAt ? daysBetween(f.stageEnteredAt, today) : null;
      return {
        code: f.code,
        client: f.client,
        stage: f.stage,
        inStage,
        totalAge: f.createdAt ? daysBetween(f.createdAt, today) : 0,
        stuck: inStage !== null && inStage > STUCK_AFTER_DAYS,
      } satisfies AgingRow;
    })
    .sort((a, b) => (b.inStage ?? -1) - (a.inStage ?? -1));

  const avg =
    rows.length === 0
      ? null
      : Math.round((rows.reduce((n, r) => n + r.totalAge, 0) / rows.length) * 10) / 10;
  const stuck = rows.filter((r) => r.stuck).length;

  return {
    rows,
    avgAgeDays: avg,
    summary:
      rows.length === 0
        ? 'No open orders.'
        : `Average age ${avg} days${stuck > 0 ? ` · ${stuck} beyond ${STUCK_AFTER_DAYS} days in one stage` : ''}.`,
  };
}

/* ── Expired orders ───────────────────────────────────────────────────── */

export interface ExpiredRow {
  code: string;
  client: string;
  owner: string;
  /** When the order entered Expired, i.e. when the wait ran out. */
  expiredOn: string | null;
  /** Days from raised to expired, or null without both dates. */
  livedDays: number | null;
  requestedDelivery: string | null;
  /** Cost already committed to suppliers when it lapsed. */
  committedMicros: number;
  suppliers: string[];
}

export interface ExpiredReport {
  rows: ExpiredRow[];
  /** Committed cost across every expired order — the money that went nowhere. */
  committedMicros: number;
  summary: string;
}

/**
 * Orders that lapsed because nobody answered a stage in time.
 *
 * Worth its own report rather than a line in Aging: an expired order is not
 * slow, it is over, and the question changes from "who should chase this" to
 * "what did we already commit before it died". Hence committed cost and the
 * suppliers behind it — an order can expire after an award, and that spend is
 * the part somebody has to unwind.
 *
 * Newest first: the recent lapses are the ones still worth a conversation.
 *
 * Note this cannot yet say WHICH stage ran out. `report_board` selects only
 * `is_current` state rows and `tq_sub_task_add` clears that flag on every
 * earlier row, so the trail behind the expiry is not in the payload — the
 * board would have to carry full history to recover it.
 */
export function expiredReport(facts: OrderFacts[]): ExpiredReport {
  const rows = facts
    .filter((f) => f.state === EXPIRED_STATE)
    .map(
      (f) =>
        ({
          code: f.code,
          client: f.client,
          owner: f.owner,
          expiredOn: f.stageEnteredAt,
          livedDays:
            f.createdAt && f.stageEnteredAt ? daysBetween(f.createdAt, f.stageEnteredAt) : null,
          requestedDelivery: f.requestedDelivery,
          committedMicros: f.awardedCostMicros,
          suppliers: f.suppliers,
        }) satisfies ExpiredRow,
    )
    .sort((a, b) => (b.expiredOn ?? '').localeCompare(a.expiredOn ?? ''));

  const committed = rows.reduce((n, r) => n + r.committedMicros, 0);
  const withSpend = rows.filter((r) => r.committedMicros > 0).length;

  return {
    rows,
    committedMicros: committed,
    summary:
      rows.length === 0
        ? 'Nothing has expired.'
        : `${rows.length} expired${
            withSpend > 0 ? ` · ${withSpend} after committing ${money(committed)}` : ''
          }.`,
  };
}

/* ── Export ───────────────────────────────────────────────────────────── */

/**
 * A CSV of whatever the report is showing.
 *
 * Quotes everything and doubles inner quotes, so a client called
 * "Williams-Sonoma, Inc." cannot split itself across two columns.
 */
export function toCsv(headers: string[], rows: Array<Array<string | number | null>>): string {
  const cell = (v: string | number | null) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [headers.map(cell).join(','), ...rows.map((r) => r.map(cell).join(','))].join('\n');
}
