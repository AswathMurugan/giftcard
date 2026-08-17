// AUTO-GENERATED SHAPE — hand-maintained.
// Saved query: order_activity_feed ("Order Activity Feed") — type: multi_query
//
// Four independent reads bundled into ONE call, returned as one object keyed
// by sub-query name. Use where the Activity rail is shown WITHOUT the order
// workspace's own queries already loaded; on the workspace itself pass the
// rows already in flight instead of refetching them here.
//
// Written by hand because codegen cannot reach this tenant (the `/internal/`
// route is WAF-blocked), NOT because it is exempt from the generated contract.

import { apiManager } from '@/services/api-manager';
import { getDataHeadersWithUser } from '@/config/api-config';

/**
 * Input parameters for `order_activity_feed` (read — sent as query params).
 *
 * Both are required and they are NOT interchangeable: `orderId` drives the
 * order / rfes / quotes sub-queries, while `instanceId` drives the TQ trail.
 * The trail can only be keyed by instance because the path from
 * `tq_state_instance` back to `orders` is a backlink, and backlink filters do
 * not resolve server-side.
 */
export interface OrderActivityFeedInput {
  orderId: string;
  instanceId: string;
}

/**
 * Result of `order_activity_feed`.
 *
 * Deliberately `unknown` per key. A `multi_query` is a composite the codegen
 * does not type, and a sub-query that fails server-side leaves its key missing
 * or holding an error object rather than the expected array. Claiming a
 * concrete row type here would be a lie the compiler then enforces on callers.
 * Narrow it through `activitySourcesFromFeed` in `@/pages/orders/order-activity`,
 * which checks each key is actually an array before use.
 */
export interface OrderActivityFeedResult {
  /** Single order row: id, order_code, created_at. */
  order?: unknown;
  /** TQ state trail, newest first. */
  history?: unknown;
  /** One row per quote request: id, sent_at, status, supplier. */
  rfes?: unknown;
  /** One row per supplier submission, newest first. */
  quotes?: unknown;
}

export const ORDER_ACTIVITY_FEED_NAME = 'order_activity_feed';

/** Execute the `order_activity_feed` composite. READ (single composite object). */
export async function executeOrderActivityFeed(
  input: OrderActivityFeedInput,
): Promise<OrderActivityFeedResult> {
  const headers = getDataHeadersWithUser();
  const search = new URLSearchParams({
    orderId: input.orderId,
    instanceId: input.instanceId,
  }).toString();
  const response = await apiManager.post(
    'data',
    `/saved-queries/order_activity_feed/execute?${search}`,
    {},
    headers,
  );
  return (response.data ?? {}) as OrderActivityFeedResult;
}
