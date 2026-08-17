/**
 * My Orders — what this client has on the book, and where each one is.
 *
 * A client sees POSITION, never economics. The saved query deliberately omits
 * allocations, quotes and margins: those are Fiserv's buy-side numbers and
 * projecting them here would show a client what their own order costs us.
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useSavedQueryList } from '@/hooks';
import { PAGE_CONTAINER } from '@/pages/page-shell';
import { useClientSession } from '@/pages/_shared/client-session';
import { ClientSwitcher } from '@/pages/_shared/ClientSwitcher';
import type { ClientOrderListRow } from '@/types/saved-queries.generated';
import { CLIENT_STAGES, decorateClientOrders, type ClientOrderRow } from './my-orders-helpers';

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

/** The journey, in the words a client would use — not the internal stage names. */
function Journey({ row }: { row: ClientOrderRow }) {
  return (
    <div className="flex items-center gap-1.5" aria-label={`Stage ${row.clientStage}`}>
      {CLIENT_STAGES.map((stage, i) => {
        const reached = row.stageIndex >= 0 && i <= row.stageIndex;
        const isCurrent = i === row.stageIndex;
        return (
          <span
            key={stage.label}
            title={stage.label}
            className={[
              'h-1.5 w-7 rounded-full',
              row.expired
                ? 'bg-destructive/30'
                : row.done
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

export function MyOrdersPage() {
  const { clientId, clientName, isLoading: sessionLoading } = useClientSession();

  const orders = useSavedQueryList('client_order_list', {
    input: { clientId },
    enabled: Boolean(clientId),
  });

  const rows = useMemo(
    () => decorateClientOrders((orders.data ?? []) as ClientOrderListRow[]),
    [orders.data],
  );
  const live = rows.filter((r) => !r.done && !r.expired).length;

  if (sessionLoading || orders.isLoading) {
    return (
      <div className={PAGE_CONTAINER}>
        <Skeleton className="mb-4 h-10 w-64" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }

  return (
    <div className={PAGE_CONTAINER} data-testid="my-orders-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-[28px] font-extrabold tracking-[-0.02em] text-foreground">My Orders</h1>
        <ClientSwitcher />
      </div>
      <p className="mt-1 text-[15px] text-muted-foreground">
        {rows.length === 0
          ? `No orders on the book for ${clientName} yet.`
          : `${live} in progress of ${rows.length}. Updated live as your cards move through production.`}
      </p>

      {rows.length === 0 ? (
        <div
          className="mt-6 rounded-xl border border-border bg-card px-4 py-10 text-center"
          data-testid="my-orders-empty"
        >
          <p className="text-[14px] font-semibold text-foreground">Nothing here yet</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Orders appear as soon as your account team raises them.
          </p>
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-2">
          {rows.map((row) => (
            <div
              key={row.id}
              data-testid={`order-row-${row.code}`}
              data-row-key={row.code}
              className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card px-4 py-3.5"
            >
              <div className="flex min-w-0 flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to={`/my-orders/${row.id}`}
                    data-testid={`order-open-${row.code}`}
                    className="text-[13px] font-bold text-foreground underline-offset-2 hover:underline"
                  >
                    {row.code}
                  </Link>
                  {row.expired ? (
                    <Badge variant="destructive" data-testid={`order-expired-${row.code}`}>
                      Expired
                    </Badge>
                  ) : row.done ? (
                    <Badge variant="secondary">Complete</Badge>
                  ) : (
                    <Badge variant="outline">{row.clientStage}</Badge>
                  )}
                </div>
                <p className="line-clamp-1 text-[13px] text-muted-foreground">{row.brief}</p>
                <div className="flex items-center gap-3">
                  <Journey row={row} />
                  <span className="text-[11.5px] text-muted-foreground">
                    delivery {shortDate(row.requestedDelivery)}
                  </span>
                </div>
              </div>

              <div className="flex shrink-0 flex-col items-end">
                <span className="text-[12.5px] font-semibold text-foreground">
                  {row.clientStage}
                </span>
                <span className="text-[11.5px] text-muted-foreground">{row.blurb}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default MyOrdersPage;
