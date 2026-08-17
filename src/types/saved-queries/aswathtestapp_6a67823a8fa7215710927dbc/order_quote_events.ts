// AUTO-GENERATED SHAPE — hand-maintained.
// Saved query: order_quote_events ("Order Quote Events")
//
// Every supplier quote submitted against one demand order, newest first, as
// timestamped events for the order Activity feed. One row per supplier per
// RFE round, so a re-quote is its own later event rather than an overwrite.
//
// Written by hand because codegen cannot reach this tenant (the `/internal/`
// route is WAF-blocked), NOT because it is exempt from the generated contract.

import { apiManager } from '@/services/api-manager';
import { getDataHeadersWithUser } from '@/config/api-config';

/** Input parameters for `order_quote_events` (read — sent as query params). */
export interface OrderQuoteEventsInput {
  orderId: string;
}

/**
 * Row returned by `order_quote_events`.
 *
 * Every field is optional: these are Phoenix's DECLARED shapes, and a link can
 * come back null for a response whose RFE or supplier was removed.
 */
export interface OrderQuoteEventsRow {
  /** Id */
  id?: string;
  /** Round — 1 for the first quote, higher for a re-quote */
  round?: number;
  /** Status */
  status?: string;
  /** Submitted At — when the supplier sent the quote */
  submitted_at?: string;
  /** Supplier Quote No */
  supplier_quote_no?: string;
  /** RFE this response answers */
  rfe?: {
    /** Id */
    id?: string;
    /** Supplier */
    supplier?: {
      /** Id */
      id?: string;
      /** Name */
      name?: string;
    };
  };
}

export const ORDER_QUOTE_EVENTS_NAME = 'order_quote_events';

/** Execute the `order_quote_events` saved query. READ (list). */
export async function executeOrderQuoteEvents(
  input: OrderQuoteEventsInput,
): Promise<OrderQuoteEventsRow[]> {
  const headers = getDataHeadersWithUser();
  const search = new URLSearchParams({ orderId: input.orderId }).toString();
  const response = await apiManager.post(
    'data',
    `/saved-queries/order_quote_events/execute?${search}`,
    {},
    headers,
  );
  const body = response.data as { data?: OrderQuoteEventsRow[] } | OrderQuoteEventsRow[];
  return Array.isArray(body) ? body : (body?.data ?? []);
}
