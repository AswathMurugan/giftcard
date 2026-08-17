/**
 * To Quote — what a supplier still owes the buyer.
 *
 * Pure functions so the bucketing is testable without a DOM (the vitest
 * environment here is `node`). Every field is read defensively: these rows
 * come off saved queries whose generated types are codegen'd from DECLARED
 * attribute types, and this tenant's backend does return other shapes.
 */
import { asText } from '@/lib/runtime';
import type { SupplierRfeListRow } from '@/types/saved-queries.generated';

/**
 * RFE statuses that mean the supplier has already answered.
 *
 * Read off real data rather than guessed: the tenant's rfe rows carry
 * `responded` once a quote is submitted. Anything else is still open work.
 */
const ANSWERED = new Set(['responded', 'closed', 'cancelled', 'awarded']);

export function isAnswered(row: SupplierRfeListRow): boolean {
  return ANSWERED.has(asText(row.status).toLowerCase());
}

/** Whole days from today to `respond_by`; null when undated or unparseable. */
export function daysToRespond(
  dateOnly: string | null | undefined,
  today: Date,
): number | null {
  if (!dateOnly) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateOnly);
  if (!m) return null;
  // Parsed as LOCAL parts, not `new Date(str)` — that reads as UTC midnight
  // and lands a day early for anyone west of UTC, which would show a deadline
  // as overdue on the morning it is actually due.
  const target = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target.getTime() - start.getTime()) / 86_400_000);
}

export type Urgency = 'overdue' | 'soon' | 'ontrack' | 'none';

/** Answered work is never urgent, however old the deadline. */
export function urgencyOf(days: number | null, answered: boolean): Urgency {
  if (answered) return 'ontrack';
  if (days === null) return 'none';
  if (days < 0) return 'overdue';
  if (days <= 3) return 'soon';
  return 'ontrack';
}

export function deadlineLabel(days: number | null, answered: boolean): string {
  if (answered) return 'Quoted';
  if (days === null) return 'No deadline';
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`;
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  return `${days} days left`;
}

export interface QuoteRow {
  id: string;
  orderCode: string;
  buyer: string;
  brief: string;
  respondBy: string | null;
  requestedDelivery: string | null;
  answered: boolean;
  days: number | null;
  urgency: Urgency;
  deadline: string;
}

/** Decorate and sort: the soonest unanswered deadline first, quoted work last. */
export function decorateQuotes(
  rows: SupplierRfeListRow[] | undefined,
  today: Date,
): QuoteRow[] {
  return (rows ?? [])
    .filter((r) => r.id)
    .map((r) => {
      const answered = isAnswered(r);
      const days = daysToRespond(r.respond_by, today);
      return {
        id: r.id as string,
        orderCode: asText(r.demand_order?.order_code) || '—',
        buyer: asText(r.demand_order?.buyer_party_id?.name) || '—',
        brief: asText(r.demand_order?.order_brief) || asText(r.setup_instructions) || 'No brief',
        respondBy: r.respond_by ?? null,
        requestedDelivery: r.demand_order?.requested_delivery ?? null,
        answered,
        days,
        urgency: urgencyOf(days, answered),
        deadline: deadlineLabel(days, answered),
      } satisfies QuoteRow;
    })
    .sort((a, b) => {
      // Outstanding work first, then by deadline. Undated sorts last within
      // its group rather than pretending to be urgent.
      if (a.answered !== b.answered) return a.answered ? 1 : -1;
      if (a.days === null && b.days === null) return 0;
      if (a.days === null) return 1;
      if (b.days === null) return -1;
      return a.days - b.days;
    });
}

/** How many still need a price — the number the header badge shows. */
export function outstandingCount(rows: QuoteRow[]): number {
  return rows.filter((r) => !r.answered).length;
}
