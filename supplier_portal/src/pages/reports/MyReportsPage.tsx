/**
 * My Reports — this supplier's own performance, from their own records.
 *
 * Composed from the three queries the other screens already use rather than a
 * bespoke aggregate, so a number here can always be traced to a row the
 * supplier can open. Nothing is benchmarked against other suppliers.
 */
import { useMemo } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { useSavedQueryList, useSavedQuerySingle } from '@/hooks';
import { PAGE_CONTAINER } from '@/pages/page-shell';
import { useSupplierSession } from '@/pages/_shared/supplier-session';
import { SupplierSwitcher } from '@/pages/_shared/SupplierSwitcher';
import { decoratePos } from '@/pages/orders-po/po-helpers';
import { decorateShipments } from '@/pages/shipments/shipment-helpers';
import { decorateInvoices, formatUsd } from '@/pages/invoices/invoice-helpers';
import type {
  SupplierInvoiceListRow,
  SupplierPoListRow,
  SupplierShipmentListRow,
} from '@/types/saved-queries.generated';
import { buildScorecard } from './report-helpers';

function Stat({
  label,
  value,
  note,
  testId,
}: {
  label: string;
  value: string;
  note: string;
  testId: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3.5" data-testid={testId}>
      <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 text-[26px] font-extrabold tabular-nums leading-tight text-foreground">
        {value}
      </p>
      <p className="text-[11.5px] text-muted-foreground">{note}</p>
    </div>
  );
}

export function MyReportsPage() {
  const { supplierId, supplierName, isLoading: sessionLoading } = useSupplierSession();

  const pos = useSavedQueryList('supplier_po_list', {
    input: { supplierId },
    enabled: Boolean(supplierId),
  });
  const shipPacket = useSavedQuerySingle('supplier_shipment_list', {
    input: { supplierId },
    enabled: Boolean(supplierId),
  });
  const invoices = useSavedQueryList('supplier_invoice_list', {
    input: { supplierId },
    enabled: Boolean(supplierId),
  });

  const loading =
    sessionLoading || pos.isLoading || shipPacket.isLoading || invoices.isLoading;

  const card = useMemo(() => {
    // One instant for the whole render, so two rows cannot be judged late
    // against different days if the clock ticks mid-pass.
    const today = new Date().toISOString().slice(0, 10);
    return buildScorecard(
      decoratePos((pos.data ?? []) as SupplierPoListRow[]),
      decorateShipments((shipPacket.data ?? null) as SupplierShipmentListRow | null),
      decorateInvoices((invoices.data ?? []) as SupplierInvoiceListRow[]),
      today,
    );
  }, [pos.data, shipPacket.data, invoices.data]);

  if (loading) {
    return (
      <div className={PAGE_CONTAINER}>
        <Skeleton className="mb-4 h-10 w-64" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }

  return (
    <div className={PAGE_CONTAINER} data-testid="my-reports-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-[28px] font-extrabold tracking-[-0.02em] text-foreground">
          My Reports
        </h1>
        <SupplierSwitcher />
      </div>
      <p className="mt-1 text-[15px] text-muted-foreground">
        {supplierName}&rsquo;s record on this account. Every figure comes from your own orders,
        destinations and charges.
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          testId="stat-open-orders"
          label="Needs you"
          value={String(card.openOrders)}
          note={`of ${card.totalOrders} purchase order${card.totalOrders === 1 ? '' : 's'}`}
        />
        <Stat
          testId="stat-completed"
          label="Completed"
          value={String(card.completedOrders)}
          note="seen through to despatch"
        />
        <Stat
          testId="stat-fulfilment"
          label="Destinations shipped"
          value={`${card.fulfilmentPct}%`}
          note={`${card.shippedUnits.toLocaleString()} of ${card.plannedUnits.toLocaleString()} units`}
        />
        <Stat
          testId="stat-late"
          label="Past planned date"
          value={String(card.lateDestinations)}
          note={card.lateDestinations === 0 ? 'nothing overdue' : 'destinations not yet despatched'}
        />
      </div>

      <div className="mt-3 rounded-xl border border-border bg-card px-4 py-3.5">
        <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
          Billable extras
        </p>
        <p className="mt-0.5 text-[26px] font-extrabold tabular-nums text-foreground">
          {formatUsd(card.billableExtras)}
        </p>
        <p className="text-[11.5px] text-muted-foreground">
          Freight and additional-spec charges marked billable. The cards themselves are paid on
          each purchase order at your quoted unit price.
        </p>
      </div>

      {card.totalOrders === 0 ? (
        <div
          className="mt-3 rounded-xl border border-border bg-card px-4 py-10 text-center"
          data-testid="reports-empty"
        >
          <p className="text-[14px] font-semibold text-foreground">Nothing to report yet</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Win a quote and your first purchase order will appear here.
          </p>
        </div>
      ) : null}
    </div>
  );
}

export default MyReportsPage;
