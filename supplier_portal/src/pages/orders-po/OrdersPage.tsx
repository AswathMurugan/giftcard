/**
 * Orders — the POs this supplier owes us, and the one action each needs next.
 *
 * Acting here fires a SIGNAL at the PO's `create_supplier_order` workflow; the
 * workflow owns every TQ write. Writing the state directly from the portal
 * would leave the run still parked on its wait, and the 30-day expiry would
 * eventually mark a PO Expired that the supplier had actually shipped. One
 * lifecycle, one writer — whichever side is acting.
 */
import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { useSavedQueryList } from '@/hooks';
import { PAGE_CONTAINER } from '@/pages/page-shell';
import { useSupplierSession } from '@/pages/_shared/supplier-session';
import { SupplierSwitcher } from '@/pages/_shared/SupplierSwitcher';
import type { SupplierPoListRow } from '@/types/saved-queries.generated';
import { fetchPoState, signalPo } from './po-api';
import { decoratePos, openCount, PO_STAGES, type PoRow } from './po-helpers';

function shortDate(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.parse(iso.slice(0, 10) + 'T00:00:00Z');
  if (Number.isNaN(ms)) return '—';
  return new Date(ms).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** Three pips — where this PO sits in its own lifecycle. */
function PoProgress({ row }: { row: PoRow }) {
  return (
    <div className="flex items-center gap-1.5" aria-label={`Stage ${row.stage}`}>
      {PO_STAGES.map((stage, i) => {
        const reached = row.stageIndex >= 0 && i <= row.stageIndex;
        const isCurrent = i === row.stageIndex;
        return (
          <span
            key={stage}
            title={stage.replace('PO ', '')}
            className={[
              'h-1.5 w-8 rounded-full',
              row.done
                ? 'bg-success-500'
                : isCurrent
                  ? 'bg-primary-500'
                  : reached
                    ? 'bg-primary-500/40'
                    : 'bg-border',
            ].join(' ')}
          />
        );
      })}
    </div>
  );
}

export function OrdersPage() {
  const { supplierId, supplierName, isLoading: sessionLoading } = useSupplierSession();
  const [busyId, setBusyId] = useState<string | null>(null);

  const pos = useSavedQueryList('supplier_po_list', {
    input: { supplierId },
    enabled: Boolean(supplierId),
  });

  /**
   * Wait for the workflow to actually write the new state.
   *
   * Bounded: eight tries at 400ms is a little over three seconds, which is
   * comfortably longer than the signal round-trip has taken in practice. When
   * it runs out we still report success — the signal WAS delivered, and
   * claiming failure would be the wrong answer — but the toast says "sent"
   * rather than naming a state we have not seen land.
   */
  const pollForState = useCallback(
    async (instanceId: string, expected: string): Promise<boolean> => {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        if ((await fetchPoState(supplierId, instanceId)) === expected) {
          pos.refetch();
          return true;
        }
      }
      pos.refetch();
      return false;
    },
    [pos, supplierId],
  );

  const rows = useMemo(
    () => decoratePos((pos.data ?? []) as SupplierPoListRow[]),
    [pos.data],
  );
  const open = openCount(rows);

  /**
   * `useCallback` because this is handed to a row-level button: a fresh
   * closure per render would defeat memoization on a list that can grow.
   */
  const handleAdvance = useCallback(
    async (row: PoRow) => {
      if (!row.next || !row.instanceId) return;
      setBusyId(row.id);
      try {
        await signalPo(row.instanceId);
        /**
         * The workflow writes the state, not us, so the row is only correct
         * once the run has processed the signal. A single immediate refetch
         * races it and shows the stale state; poll for the actual change
         * instead of guessing a fixed delay.
         */
        const landed = await pollForState(row.instanceId, row.next.toState);
        if (landed) {
          toast.success(`${row.code} — ${row.next.toState}`, {
            testId: 'toast-po-advance',
          });
        } else {
          toast.success(`${row.code} — sent`, { testId: 'toast-po-advance' });
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : 'Could not update the order',
          { testId: 'toast-po-error' },
        );
      } finally {
        setBusyId(null);
      }
    },
    [pollForState],
  );

  if (sessionLoading || pos.isLoading) {
    return (
      <div className={PAGE_CONTAINER}>
        <Skeleton className="mb-4 h-10 w-64" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }

  return (
    <div className={PAGE_CONTAINER} data-testid="po-orders-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-[28px] font-extrabold tracking-[-0.02em] text-foreground">Orders</h1>
        <SupplierSwitcher />
      </div>
      <p className="mt-1 text-[15px] text-muted-foreground">
        {rows.length === 0
          ? `No purchase orders for ${supplierName} yet.`
          : `${open} of ${rows.length} need something from you. Every update here is visible to the buyer immediately.`}
      </p>

      {rows.length === 0 ? (
        <div
          className="mt-6 rounded-xl border border-border bg-card px-4 py-10 text-center"
          data-testid="po-orders-empty"
        >
          <p className="text-[14px] font-semibold text-foreground">Nothing raised yet</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            When a quote is awarded, the purchase order appears here.
          </p>
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-2">
          {rows.map((row) => (
            <div
              key={row.id}
              data-testid={`po-row-${row.code}`}
              data-row-key={row.code}
              className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card px-4 py-3.5"
            >
              <div className="flex min-w-0 flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to={`/orders/${row.id}`}
                    data-testid={`po-open-${row.code}`}
                    className="text-[13px] font-bold text-foreground underline-offset-2 hover:underline"
                  >
                    {row.code}
                  </Link>
                  <span className="text-[12.5px] text-muted-foreground">
                    for {row.parentCode}
                  </span>
                  {row.done ? (
                    <Badge variant="secondary" data-testid={`po-done-${row.code}`}>
                      Shipped
                    </Badge>
                  ) : (
                    <Badge variant="outline">{row.state}</Badge>
                  )}
                </div>
                <p className="line-clamp-1 text-[13px] text-muted-foreground">{row.brief}</p>
                <div className="flex items-center gap-3">
                  <PoProgress row={row} />
                  <span className="text-[11.5px] text-muted-foreground">
                    due {shortDate(row.requestedDelivery)}
                  </span>
                </div>
              </div>

              <div className="flex shrink-0 flex-col items-end gap-1">
                {row.next ? (
                  <>
                    <Button
                      size="sm"
                      data-testid={`po-advance-${row.code}`}
                      aria-busy={busyId === row.id}
                      disabled={busyId !== null}
                      onClick={() => handleAdvance(row)}
                    >
                      {row.next.label}
                    </Button>
                    <span className="text-[11.5px] text-muted-foreground">{row.next.blurb}</span>
                  </>
                ) : (
                  <span className="text-[12.5px] font-semibold text-success-700">
                    Nothing outstanding
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default OrdersPage;
