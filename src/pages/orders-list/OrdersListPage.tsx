/**
 * Orders — every order on the book.
 *
 * `order_list` takes no parameters and returns the lot (51 today), so search
 * and filtering happen client-side against the full set rather than round-
 * tripping per keystroke.
 *
 * The state column shows the LIVE state from the task instance, not the
 * `status` jsonb on the order: that snapshot is written at intake and never
 * updated, so it reports "Order Received" for an order in production.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSavedQueryList } from '@/hooks';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { PAGE_CONTAINER } from '@/pages/page-shell';
import {
  buyerName,
  byDeliverySoonest,
  daysUntil,
  filterOrders,
  isLate,
  isTerminal,
  liveState,
  statesPresent,
  type OrderListRow,
} from './orders-list-helpers';

const ALL = '__ALL__';

function DueCell({ row, today }: { row: OrderListRow; today: Date }) {
  const days = daysUntil(row.requested_delivery, today);
  if (!row.requested_delivery) return <span className="text-muted-foreground">—</span>;

  const terminal = isTerminal(row);
  const late = isLate(row, today);
  const soon = !late && !terminal && days !== null && days >= 0 && days <= 7;

  /**
   * A finished order gets no countdown at all.
   *
   * `isLate` correctly refuses to call a closed order late, but the remaining
   * branch then read a negative count as future tense — a closed order with a
   * July date rendered "in -12 days". Past dates only ever get a relative line
   * when the order is still running and therefore actually overdue.
   */
  const relative =
    days === null || terminal
      ? ''
      : late
        ? `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} late`
        : days === 0
          ? 'Today'
          : `in ${days} day${days === 1 ? '' : 's'}`;

  return (
    <span className="flex flex-col">
      <span className="tabular-nums text-foreground">{row.requested_delivery}</span>
      {relative ? (
        <span
          className={`text-[11.5px] font-semibold ${
            late ? 'text-destructive' : soon ? 'text-warning-700' : 'text-muted-foreground'
          }`}
        >
          {relative}
        </span>
      ) : null}
    </span>
  );
}

export function OrdersListPage() {
  const [query, setQuery] = useState('');
  const [state, setState] = useState('');
  const [scope, setScope] = useState('All');

  const orders = useSavedQueryList('order_list');
  /**
   * Demand orders only, and the filter is SERVER-side.
   *
   * `order_list` now carries `order_kind == 'demand'`, so this page cannot
   * show our own purchase orders even by omission — which is what it was
   * doing, listing GC-1001-PO1 and the rest with Fiserv (us) in the Buyer
   * column. Filtering here in the page worked too, but every future caller
   * would have had to remember; the query is the better place for it.
   */
  // Memoised: `?? []` builds a fresh array every render, which would change
  // the identity of every downstream useMemo dependency on each pass.
  const rows = useMemo(() => (orders.data ?? []) as OrderListRow[], [orders.data]);

  // One `now` per render pass, so every row's "days late" is measured from the
  // same instant rather than drifting across the list.
  const today = useMemo(() => new Date(), []);

  const states = useMemo(() => statesPresent(rows), [rows]);
  const visible = useMemo(
    () =>
      byDeliverySoonest(
        filterOrders(rows, { query, state, lateOnly: scope === 'Late' }, today),
      ),
    [rows, query, state, scope, today],
  );

  const lateCount = useMemo(() => rows.filter((r) => isLate(r, today)).length, [rows, today]);

  return (
    <div className={PAGE_CONTAINER} data-testid="orders-list-page">
      <h1 className="text-[28px] font-extrabold tracking-[-0.02em] text-foreground">Orders</h1>
      <p className="mb-5 mt-1 text-[15px] text-muted-foreground">
        Every order on the book, soonest delivery first.
        {lateCount > 0 ? (
          <span className="ml-1 font-semibold text-destructive">
            {lateCount} past its requested delivery.
          </span>
        ) : null}
      </p>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="order-search">Search</Label>
          <Input
            id="order-search"
            name="orderSearch"
            data-testid="orders-search"
            className="w-[16rem]"
            placeholder="Code, brief, buyer or state"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="order-state">State</Label>
          <select
            id="order-state"
            data-testid="orders-state"
            className="h-9 rounded-md border border-border bg-card px-2 text-[13.5px]"
            value={state || ALL}
            onChange={(e) => setState(e.target.value === ALL ? '' : e.target.value)}
          >
            {/* Sentinel, not '': Radix reserves the empty string, and a native
                select with an empty value reads as "no selection" too. */}
            <option value={ALL}>All states</option>
            {states.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <SegmentedControl
          value={scope}
          onValueChange={setScope}
          options={['All', 'Late']}
          aria-label="Delivery scope"
        />
        <span className="ml-auto text-[13px] text-muted-foreground">
          {visible.length} of {rows.length}
        </span>
      </div>

      {orders.isLoading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-[13.5px] text-muted-foreground">
          No orders match.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                {['Order', 'Buyer', 'State', 'Requested delivery', 'Brief'].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2.5 text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr
                  key={row.id}
                  data-row-key={row.order_code}
                  data-testid={`order-row-${row.order_code}`}
                  className="border-b border-border last:border-b-0 hover:bg-muted/40"
                >
                  <td className="px-3 py-2.5">
                    <Link
                      to={`/orders/${row.id}`}
                      className="text-[13.5px] font-bold text-primary-600 hover:underline"
                      data-testid={`${row.order_code}-link`}
                    >
                      {row.order_code ?? '—'}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-[13.5px] text-foreground">
                    {buyerName(row)}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-[11.5px] font-bold text-muted-foreground">
                      {liveState(row)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-[13.5px]">
                    <DueCell row={row} today={today} />
                  </td>
                  <td className="max-w-[22rem] truncate px-3 py-2.5 text-[13px] text-muted-foreground">
                    {row.order_brief || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default OrdersListPage;
