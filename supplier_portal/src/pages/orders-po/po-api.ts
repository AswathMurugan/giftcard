/**
 * Advancing a purchase order.
 *
 * Relay fires a SIGNAL; it does not write the state itself. The
 * `create_supplier_order` workflow is parked on a wait-for-signal at each
 * stage, and it owns the TQ writes — open the sub-task, wait, close it, open
 * the next.
 *
 * That split matters. If the portal wrote the state directly the workflow
 * would still be sitting on its wait, and the 30-day expiry would eventually
 * fire on a PO the supplier had already finished — the order would go Expired
 * having actually shipped. One lifecycle, one writer.
 */
import { runSavedQueryWithParams, sendStageResponse } from '@/pages/orders/order-api';
import type { SupplierPoListRow } from '@/types/saved-queries.generated';

/**
 * Read one PO's current state, fresh.
 *
 * `useSavedQueryList`'s `refetch()` returns void, so a caller cannot read the
 * rows it just fetched — which is exactly what polling for a workflow write
 * needs. This goes straight to the saved query and returns the value.
 */
export async function fetchPoState(
  supplierId: string,
  instanceId: string,
): Promise<string | null> {
  const rows = await runSavedQueryWithParams<unknown>('supplier_po_list', { supplierId });
  const list = Array.isArray(rows)
    ? rows
    : ((rows as { data?: unknown[] } | null)?.data ?? []);
  for (const row of list as SupplierPoListRow[]) {
    if (row?.tq_instance?.id === instanceId) {
      return row.tq_instance?.current_status?.tq_state_definition?.state ?? null;
    }
  }
  return null;
}

/**
 * Tell the PO's workflow the supplier has acted.
 *
 * Delegates to Forge's `sendStageResponse` rather than posting its own
 * request. Both portals talk to the same signal endpoint, and the first
 * version here hand-rolled the URL as
 * `/workflow/internal/v1/signals/{id}/trigger` — one `/workflow/internal`
 * too many, because `apiManager.post('workflow', …)` already prefixes the
 * service. The signal silently never arrived and the PO sat at PO Raised.
 * Sharing the one implementation also inherits its error unwrapping: the
 * signal API returns a bare 500 with the real diagnosis
 * (`ERROR_SIGNAL_NO_ACTIVE_WORKFLOW`) in the body.
 */
export function signalPo(instanceId: string): Promise<unknown> {
  return sendStageResponse(instanceId, { id: instanceId });
}
