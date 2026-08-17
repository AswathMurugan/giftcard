/**
 * Orders list — filtering and grouping.
 *
 * `order_list` is DEMAND orders only — the role filter lives in the saved
 * query, not here, so a caller cannot forget it. What remains client-side is
 * search, state and the late toggle. Kept as pure functions so the behaviour is testable without a
 * DOM: the vitest environment here is `node`.
 *
 * Every field is read defensively. These rows come off a jsonb snapshot
 * (`status`) and a linked task instance, and the generated types are codegen'd
 * from DECLARED attribute types — the backend can and does return a different
 * runtime shape, so nothing here calls a string method on an unguarded value.
 */

import { asText } from '@/lib/runtime';

export interface OrderListRow {
  id?: string;
  order_code?: string;
  order_brief?: string;
  order_kind?: string;
  order_type?: string;
  requested_delivery?: string;
  created_at?: string;
  buyer_party_id?: { id?: string; name?: string } | null;
  tq_instance?: {
    id?: string;
    current_status?: { tq_state_definition?: { state?: string } } | null;
  } | null;
}

/**
 * The order's LIVE state — the task instance is the only source.
 *
 * There used to be a fallback to an `orders.status` jsonb snapshot. That
 * column was written once at intake and never updated, so it read "Order
 * Received" on every row including Closed and Expired ones; it was dropped
 * rather than maintained, because a confidently wrong state is worse than a
 * missing one.
 *
 * `Unknown` is therefore a real signal now, not padding: every order that has
 * an instance has a populated `current_status`, so seeing it means either the
 * order never got an instance or the projection came back stripped — both
 * worth noticing rather than papering over.
 */
export function liveState(row: OrderListRow): string {
  return asText(row.tq_instance?.current_status?.tq_state_definition?.state) || 'Unknown';
}

/** Buyer name, or a dash. */
export function buyerName(row: OrderListRow): string {
  return asText(row.buyer_party_id?.name) || '—';
}

/**
 * Days until requested delivery, counted in LOCAL time.
 *
 * `new Date('2026-08-27')` parses as UTC midnight, which lands on the previous
 * day for anyone west of UTC and makes an order look a day later than it is.
 * Parsing the parts explicitly keeps the count honest.
 */
export function daysUntil(dateOnly: string | undefined | null, today: Date): number | null {
  if (!dateOnly) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateOnly);
  if (!m) return null;
  const target = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target.getTime() - start.getTime()) / 86_400_000);
}

/** States that mean the order is finished — never late, whatever the date. */
const TERMINAL = new Set(['Closed', 'Cancelled', 'Order Close']);

export function isTerminal(row: OrderListRow): boolean {
  return TERMINAL.has(liveState(row));
}

/** Late = a delivery date in the past on an order that is still running. */
export function isLate(row: OrderListRow, today: Date): boolean {
  if (isTerminal(row)) return false;
  const d = daysUntil(row.requested_delivery, today);
  return d !== null && d < 0;
}

/** Case-insensitive match across the fields a specialist would search by. */
export function matchesQuery(row: OrderListRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    row.order_code,
    row.order_brief,
    row.buyer_party_id?.name,
    liveState(row),
  ].some((v) => asText(v).toLowerCase().includes(q));
}

export interface OrderFilter {
  query: string;
  /** Live state to keep, or '' for all. */
  state: string;
  /** Only orders past their requested delivery. */
  lateOnly: boolean;
}

export function filterOrders(
  rows: OrderListRow[],
  filter: OrderFilter,
  today: Date,
): OrderListRow[] {
  return rows.filter(
    (r) =>
      matchesQuery(r, filter.query) &&
      (!filter.state || liveState(r) === filter.state) &&
      (!filter.lateOnly || isLate(r, today)),
  );
}

/** Distinct live states present, sorted, for the filter dropdown. */
export function statesPresent(rows: OrderListRow[]): string[] {
  return [...new Set(rows.map(liveState))].filter(Boolean).sort();
}

/** Newest requested delivery first, undated last. */
export function byDeliverySoonest(rows: OrderListRow[]): OrderListRow[] {
  return [...rows].sort((a, b) => {
    const av = a.requested_delivery ?? '';
    const bv = b.requested_delivery ?? '';
    if (!av && !bv) return 0;
    if (!av) return 1;
    if (!bv) return -1;
    return av.localeCompare(bv);
  });
}
