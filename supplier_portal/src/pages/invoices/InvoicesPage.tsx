/**
 * Invoices — the chargeable extras raised against this supplier's POs.
 *
 * Scope note shown on the page itself, because the omission is easy to
 * misread: the cards themselves are paid on the purchase order at the unit
 * price the supplier quoted, and are not listed here. This screen is the
 * freight, additional-spec and other line items raised on top.
 */
import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useSavedQueryList } from '@/hooks';
import { PAGE_CONTAINER } from '@/pages/page-shell';
import { useSupplierSession } from '@/pages/_shared/supplier-session';
import { SupplierSwitcher } from '@/pages/_shared/SupplierSwitcher';
import type { SupplierInvoiceListRow } from '@/types/saved-queries.generated';
import { decorateInvoices, formatUsd, invoiceTotals } from './invoice-helpers';

function shortDate(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '—';
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function InvoicesPage() {
  const { supplierId, supplierName, isLoading: sessionLoading } = useSupplierSession();

  const invoices = useSavedQueryList('supplier_invoice_list', {
    input: { supplierId },
    enabled: Boolean(supplierId),
  });

  const rows = useMemo(
    () => decorateInvoices((invoices.data ?? []) as SupplierInvoiceListRow[]),
    [invoices.data],
  );
  const totals = useMemo(() => invoiceTotals(rows), [rows]);

  if (sessionLoading || invoices.isLoading) {
    return (
      <div className={PAGE_CONTAINER}>
        <Skeleton className="mb-4 h-10 w-64" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }

  return (
    <div className={PAGE_CONTAINER} data-testid="invoices-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-[28px] font-extrabold tracking-[-0.02em] text-foreground">Invoices</h1>
        <SupplierSwitcher />
      </div>
      <p className="mt-1 text-[15px] text-muted-foreground">
        Chargeable extras raised against {supplierName}&rsquo;s purchase orders. The cards
        themselves are paid on each PO at the unit price you quoted.
      </p>

      {rows.length > 0 ? (
        <div className="mt-5 flex flex-wrap gap-3">
          <div
            className="rounded-xl border border-border bg-card px-4 py-3"
            data-testid="invoice-total-billable"
          >
            <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
              Billable
            </p>
            <p className="text-[22px] font-extrabold tabular-nums text-foreground">
              {formatUsd(totals.billable)}
            </p>
          </div>
          <div className="rounded-xl border border-border bg-card px-4 py-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
              Not yet billable
            </p>
            <p className="text-[22px] font-extrabold tabular-nums text-muted-foreground">
              {formatUsd(totals.other)}
            </p>
          </div>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div
          className="mt-6 rounded-xl border border-border bg-card px-4 py-10 text-center"
          data-testid="invoices-empty"
        >
          <p className="text-[14px] font-semibold text-foreground">No extras raised</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Freight and additional-spec charges appear here once the buyer records them.
          </p>
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          {rows.map((row) => (
            <div
              key={row.id}
              data-testid={`invoice-row-${row.orderCode}-${row.category}`}
              data-row-key={row.id}
              className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card px-4 py-3.5"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-bold text-foreground">{row.orderCode}</span>
                  <span className="text-[12.5px] text-muted-foreground">{row.category}</span>
                  <Badge variant={row.status === 'billable' ? 'outline' : 'secondary'}>
                    {row.status}
                  </Badge>
                </div>
                <p className="line-clamp-1 text-[13px] text-muted-foreground">{row.description}</p>
                <p className="text-[11.5px] text-muted-foreground/80">
                  raised {shortDate(row.createdAt)}
                </p>
              </div>

              <div className="shrink-0 text-right">
                <p className="text-[15px] font-bold tabular-nums text-foreground">
                  {formatUsd(row.amount)}
                </p>
                <p className="text-[11.5px] tabular-nums text-muted-foreground">
                  {row.qty.toLocaleString()} × {formatUsd(row.unitCost)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default InvoicesPage;
