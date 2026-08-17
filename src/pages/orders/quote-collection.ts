/**
 * Reading the state of the Quote stage's supplier-collection window.
 *
 * The order's workflow parks in a loop while any RFE is still marked `sent`,
 * so "how many suppliers are we waiting on" is not a workflow question — it is
 * a count of rows. These helpers derive it from the RFE list the page already
 * has, so the screen agrees with the loop without a second query.
 *
 * `rfe.status` is the shared contract: the workflow counts it, Relay writes it
 * on submit, and Forge writes it when a buyer closes the round early.
 */

import { asText } from '@/lib/runtime';

/** RFE statuses that mean "this supplier still owes us an answer". */
const OUTSTANDING = 'sent';

/**
 * Statuses that count as a settled answer — the supplier replied, declined, or
 * the buyer closed them out. Kept explicit rather than "anything but sent" so
 * a status added later has to be classified on purpose.
 */
const SETTLED = new Set(['responded', 'returned', 'outdated', 'cancelled']);

/** The shape this module needs from an RFE row — nothing more. */
export interface RfeStatusRow {
  status?: unknown;
}

/**
 * How many suppliers have not answered yet.
 *
 * Reads `status` through `asText` because the value is typed `string` but
 * arrives from the API unguaranteed — a boolean or null here would throw on
 * `.toLowerCase()` and blank the panel through the error boundary.
 */
export function outstandingRfeCount(rows: RfeStatusRow[] | undefined): number {
  return (rows ?? []).filter((r) => asText(r.status).toLowerCase() === OUTSTANDING).length;
}

/** How many suppliers have given a final answer of any kind. */
export function settledRfeCount(rows: RfeStatusRow[] | undefined): number {
  return (rows ?? []).filter((r) => SETTLED.has(asText(r.status).toLowerCase())).length;
}

/**
 * The line shown beside the stage strip while the loop is parked.
 *
 * Returns null when there is nothing to wait for, so the caller can render
 * nothing at all rather than an empty banner. `draft` RFEs are excluded from
 * both counts by construction, so an order whose RFEs were never sent reads as
 * "no suppliers" rather than "0 of 0".
 */
export function collectionStatusLine(rows: RfeStatusRow[] | undefined): string | null {
  const outstanding = outstandingRfeCount(rows);
  if (outstanding === 0) return null;
  const settled = settledRfeCount(rows);
  const total = settled + outstanding;
  return `Waiting on ${outstanding} of ${total} supplier${total === 1 ? '' : 's'}. The order moves to Deal Review on its own once the last quote arrives.`;
}

/**
 * Whether the "proceed without them" action should be offered.
 *
 * Only worth showing when at least one supplier is outstanding AND at least one
 * has answered: closing the round with nothing in hand would advance to Deal
 * Review with no quotes to compare, which is never the intent.
 */
export function canProceedWithoutStragglers(rows: RfeStatusRow[] | undefined): boolean {
  return outstandingRfeCount(rows) > 0 && settledRfeCount(rows) > 0;
}
