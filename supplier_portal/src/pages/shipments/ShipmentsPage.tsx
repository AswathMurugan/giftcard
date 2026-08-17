/**
 * Shipments — every destination across this supplier's purchase orders.
 *
 * Read-only. Despatches are recorded by Fiserv against the client's order
 * (that is where the freight cost and the client's delivery commitment live),
 * so this screen reports rather than edits: what is still owed, what left, and
 * on whose tracking number.
 */
import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useSavedQuerySingle } from '@/hooks';
import { PAGE_CONTAINER } from '@/pages/page-shell';
import { useSupplierSession } from '@/pages/_shared/supplier-session';
import { SupplierSwitcher } from '@/pages/_shared/SupplierSwitcher';
import type { SupplierShipmentListRow } from '@/types/saved-queries.generated';
import { decorateShipments, outstandingCount } from './shipment-helpers';

function shortDate(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.parse(iso.length <= 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(ms)) return '—';
  return new Date(ms).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function ShipmentsPage() {
  const { supplierId, supplierName, isLoading: sessionLoading } = useSupplierSession();

  const packet = useSavedQuerySingle('supplier_shipment_list', {
    input: { supplierId },
    enabled: Boolean(supplierId),
  });

  const rows = useMemo(
    () => decorateShipments((packet.data ?? null) as SupplierShipmentListRow | null),
    [packet.data],
  );
  const outstanding = outstandingCount(rows);

  if (sessionLoading || packet.isLoading) {
    return (
      <div className={PAGE_CONTAINER}>
        <Skeleton className="mb-4 h-10 w-64" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }

  return (
    <div className={PAGE_CONTAINER} data-testid="shipments-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-[28px] font-extrabold tracking-[-0.02em] text-foreground">Shipments</h1>
        <SupplierSwitcher />
      </div>
      <p className="mt-1 text-[15px] text-muted-foreground">
        {rows.length === 0
          ? `No destinations planned on ${supplierName}'s orders yet.`
          : outstanding === 0
            ? 'Everything planned has shipped.'
            : `${outstanding} destination${outstanding === 1 ? '' : 's'} still to despatch.`}
      </p>

      {rows.length === 0 ? (
        <div
          className="mt-6 rounded-xl border border-border bg-card px-4 py-10 text-center"
          data-testid="shipments-empty"
        >
          <p className="text-[14px] font-semibold text-foreground">Nothing to ship yet</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Destinations appear once the buyer plans delivery on a purchase order.
          </p>
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-2">
          {rows.map((row) => (
            <div
              key={row.id}
              data-testid={`shipment-row-${row.orderCode}-${row.destination}`}
              data-row-key={`${row.orderCode}-${row.destination}`}
              className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card px-4 py-3.5"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-bold text-foreground">{row.orderCode}</span>
                  <Badge variant={row.state === 'shipped' ? 'secondary' : 'outline'}>
                    {row.label}
                  </Badge>
                </div>
                <p className="text-[13px] text-muted-foreground">{row.destination}</p>
                <p className="text-[11.5px] text-muted-foreground/80">
                  {row.tracking
                    ? `${row.carrier ?? 'Carrier'} ${row.tracking} · shipped ${shortDate(row.shipDate)}`
                    : `planned ${shortDate(row.plannedDate)}`}
                </p>
              </div>

              <div className="shrink-0 text-right">
                <p className="text-[15px] font-bold tabular-nums text-foreground">
                  {row.shippedQty.toLocaleString()} / {row.plannedQty.toLocaleString()}
                </p>
                <p className="text-[11.5px] text-muted-foreground">units despatched</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default ShipmentsPage;
