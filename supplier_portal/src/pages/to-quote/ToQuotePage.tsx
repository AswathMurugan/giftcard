/**
 * To Quote — Relay's landing screen.
 *
 * Requests for estimate awaiting this supplier's costs. Everything here is
 * read from the SAME `rfe` rows Forge writes; quoting from this screen lands
 * the same `rfe_response` a CS specialist would read on the buyer side.
 *
 * Pricing itself happens on the RFE detail page, which is reached from here
 * and is also the target of the emailed link — one surface, two ways in.
 */
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useSavedQueryList } from '@/hooks';
import { PAGE_CONTAINER } from '@/pages/page-shell';
import { useSupplierSession } from '@/pages/_shared/supplier-session';
import { SupplierSwitcher } from '@/pages/_shared/SupplierSwitcher';
import type { SupplierRfeListRow } from '@/types/saved-queries.generated';
import { decorateQuotes, outstandingCount, type QuoteRow, type Urgency } from './quote-helpers';

/** Deadline colour, matching the demo's red / amber / grey read. */
const URGENCY_CLASS: Record<Urgency, string> = {
  overdue: 'text-destructive font-bold',
  soon: 'text-warning-700 font-bold',
  ontrack: 'text-muted-foreground font-semibold',
  none: 'text-muted-foreground font-semibold',
};

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

function QuoteCard({ row, onOpen }: { row: QuoteRow; onOpen: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(row.id)}
      data-testid={`quote-row-${row.orderCode}`}
      className="flex w-full items-start justify-between gap-4 rounded-xl border border-border bg-card px-4 py-3.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-bold text-foreground">{row.orderCode}</span>
          <span className="text-[13px] text-muted-foreground">·</span>
          <span className="text-[13px] font-semibold text-foreground">{row.buyer}</span>
          {row.answered ? (
            <Badge variant="secondary" data-testid={`quoted-${row.orderCode}`}>
              Quoted
            </Badge>
          ) : null}
        </div>
        <p className="line-clamp-2 text-[13px] text-muted-foreground">{row.brief}</p>
        <p className="text-[12px] text-muted-foreground/80">
          Needed by {shortDate(row.requestedDelivery)}
        </p>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className={`text-[12.5px] ${URGENCY_CLASS[row.urgency]}`}>{row.deadline}</span>
        <span className="text-[11.5px] text-muted-foreground">
          respond by {shortDate(row.respondBy)}
        </span>
      </div>
    </button>
  );
}

export function ToQuotePage() {
  const navigate = useNavigate();
  const { supplierId, supplierName, isLoading: sessionLoading } = useSupplierSession();

  const rfes = useSavedQueryList('supplier_rfe_list', {
    input: { supplierId },
    enabled: Boolean(supplierId),
  });

  // One clock for the whole screen, so two rows a millisecond apart cannot
  // disagree about whether something is overdue.
  const today = useMemo(() => new Date(), []);
  const rows = useMemo(
    () => decorateQuotes((rfes.data ?? []) as SupplierRfeListRow[], today),
    [rfes.data, today],
  );
  const outstanding = outstandingCount(rows);

  const openRfe = (id: string) => navigate(`/rfe/${id}`);

  if (sessionLoading || rfes.isLoading) {
    return (
      <div className={PAGE_CONTAINER}>
        <Skeleton className="mb-4 h-10 w-64" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }

  return (
    <div className={PAGE_CONTAINER} data-testid="to-quote-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-[28px] font-extrabold tracking-[-0.02em] text-foreground">To Quote</h1>
        <SupplierSwitcher />
      </div>
      <p className="mt-1 text-[15px] text-muted-foreground">
        {outstanding === 0
          ? `Nothing outstanding for ${supplierName}. Quoted requests stay listed below.`
          : `${outstanding} request${outstanding === 1 ? '' : 's'} awaiting your costs.`}{' '}
        Quote here and it reaches the buyer directly.
      </p>

      {rows.length === 0 ? (
        <div
          className="mt-6 rounded-xl border border-border bg-card px-4 py-10 text-center"
          data-testid="to-quote-empty"
        >
          <p className="text-[14px] font-semibold text-foreground">No requests yet</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            When {supplierName || 'your organisation'} is asked to price an order, it appears here.
          </p>
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-2">
          {rows.map((row) => (
            <QuoteCard key={row.id} row={row} onOpen={openRfe} />
          ))}
        </div>
      )}

      {rfes.error ? (
        <div className="mt-4 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3">
          <p className="text-[13px] font-semibold text-destructive">
            Could not load your requests.
          </p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            The list is read from the buyer's system — try again, and if it persists the buyer's
            team can see the same error.
          </p>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => rfes.refetch()}>
            Retry
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export default ToQuotePage;
