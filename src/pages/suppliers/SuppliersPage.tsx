/**
 * Suppliers — who we buy from, what they owe us a quote on, and what we know.
 *
 * Four saved queries, joined client-side on supplier id:
 *   supplier_board          suppliers + their RFEs (two lists, one call)
 *   supplier_capacity_list  declared vs committed per period
 *   supplier_cert_list      certifications
 *   supplier_price_list     observed unit cost per quantity tier
 *
 * A supplier with no RFE, no capacity and no certifications still appears.
 * Missing data is shown as unknown rather than the supplier being dropped —
 * an unquantified supplier is exactly the one an RFE would confirm.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSavedQueryList, useSavedQuerySingle } from '@/hooks';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { PAGE_CONTAINER } from '@/pages/page-shell';
import {
  buildSupplierCards,
  matchesSupplier,
  remainingUnits,
  utilisationPct,
  type CapacityRow,
  type CertRow,
  type PriceRow,
  type SupplierBoardResult,
  type SupplierCard,
} from './suppliers-helpers';

type Tab = 'Quotes' | 'Capacity' | 'Certifications' | 'Prices';
const TABS: Tab[] = ['Quotes', 'Capacity', 'Certifications', 'Prices'];

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-3 text-[12.5px] text-muted-foreground">{children}</p>;
}

function QuotesTab({ card }: { card: SupplierCard }) {
  if (card.rfes.length === 0) {
    return <Empty>No RFEs sent to this supplier yet.</Empty>;
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {card.rfes.map((r) => (
        <li
          key={r.id}
          data-testid={`supplier-rfe-${r.demand_order?.order_code ?? r.id}`}
          className="flex items-center gap-2 text-[13px]"
        >
          {/* This row IS this supplier's RFE, so it opens the SUPPLIER's view
              of it — what they were sent and what they quoted. The order page
              is the CS side of the same thing and is reachable separately. */}
          <Link
            to={`/rfe/${r.id ?? ''}`}
            className="font-bold text-primary-600 hover:underline"
            data-testid={`open-rfe-${r.demand_order?.order_code ?? r.id}`}
          >
            {r.demand_order?.order_code ?? '—'}
          </Link>
          <Link
            to={`/orders/${r.demand_order?.id ?? ''}`}
            className="text-[11.5px] text-muted-foreground hover:underline"
            title="Open the order (CS view)"
          >
            order
          </Link>
          <span className="text-muted-foreground">
            {r.demand_order?.buyer_party_id?.name ?? '—'}
          </span>
          <span className="ml-auto inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold uppercase text-muted-foreground">
            {r.status ?? 'unknown'}
          </span>
          <span className="w-[6rem] text-right text-[12px] tabular-nums text-muted-foreground">
            {r.respond_by ?? '—'}
          </span>
        </li>
      ))}
    </ul>
  );
}

function CapacityTab({ card }: { card: SupplierCard }) {
  if (card.capacity.length === 0) {
    return <Empty>No capacity declared — an RFE would confirm it.</Empty>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {[...card.capacity]
        .sort((a, b) => (a.period ?? '').localeCompare(b.period ?? ''))
        .map((c: CapacityRow) => {
          const pct = utilisationPct(c);
          const left = remainingUnits(c);
          return (
            <li key={c.id} data-testid={`capacity-${c.period}`}>
              <div className="flex items-baseline justify-between text-[12.5px]">
                <span className="font-semibold text-foreground">{c.period ?? '—'}</span>
                <span className="text-muted-foreground">
                  {left === null
                    ? 'Not declared'
                    : `${left.toLocaleString()} of ${(c.declared ?? 0).toLocaleString()} free`}
                </span>
              </div>
              {/* A bar only when there is something to be a fraction OF. */}
              {pct !== null ? (
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full ${pct >= 90 ? 'bg-destructive' : pct >= 70 ? 'bg-warning-500' : 'bg-teal-500'}`}
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </div>
              ) : null}
            </li>
          );
        })}
    </ul>
  );
}

function CertsTab({ card }: { card: SupplierCard }) {
  if (card.certs.length === 0) return <Empty>No certifications recorded.</Empty>;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {card.certs.map((c: CertRow) => (
        <li
          key={c.id}
          data-testid={`cert-${c.certification}`}
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-[12px]"
        >
          <span className="font-semibold text-foreground">{c.certification ?? '—'}</span>
          {c.valid_until ? (
            <span className="text-muted-foreground">to {c.valid_until}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function PricesTab({ card }: { card: SupplierCard }) {
  if (card.prices.length === 0) {
    return <Empty>No observed prices. Quotes at the Quote stage fill this in.</Empty>;
  }
  return (
    <ul className="flex flex-col gap-1">
      {[...card.prices]
        .sort((a, b) => (a.tier_qty ?? 0) - (b.tier_qty ?? 0))
        .map((p: PriceRow) => (
          <li
            key={p.id}
            data-testid={`price-${p.tier_qty}`}
            className="flex items-center gap-2 text-[12.5px]"
          >
            <span className="w-[5rem] tabular-nums font-semibold text-foreground">
              {(p.tier_qty ?? 0).toLocaleString()}
            </span>
            <span className="tabular-nums text-foreground">
              {typeof p.unit_cost === 'number' ? `$${p.unit_cost.toFixed(3)}` : '—'}
            </span>
            <span className="truncate text-muted-foreground">{p.signature_hash ?? ''}</span>
            <span className="ml-auto text-[11.5px] text-muted-foreground">
              {p.observed_at ? p.observed_at.slice(0, 10) : ''}
            </span>
          </li>
        ))}
    </ul>
  );
}

export function SuppliersPage() {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('Quotes');

  const board = useSavedQuerySingle('supplier_board');
  const capacity = useSavedQueryList('supplier_capacity_list');
  const certs = useSavedQueryList('supplier_cert_list');
  const prices = useSavedQueryList('supplier_price_list');

  const cards = useMemo(
    () =>
      buildSupplierCards(
        board.data as SupplierBoardResult | null,
        (capacity.data ?? []) as CapacityRow[],
        (certs.data ?? []) as CertRow[],
        (prices.data ?? []) as PriceRow[],
      ),
    [board.data, capacity.data, certs.data, prices.data],
  );

  const visible = useMemo(
    () => cards.filter((c) => matchesSupplier(c, query)),
    [cards, query],
  );
  const awaiting = cards.reduce((n, c) => n + c.awaiting, 0);

  return (
    <div className={PAGE_CONTAINER} data-testid="suppliers-page">
      <h1 className="text-[28px] font-extrabold tracking-[-0.02em] text-foreground">
        Suppliers
      </h1>
      <p className="mb-5 mt-1 text-[15px] text-muted-foreground">
        {cards.length} supplier{cards.length === 1 ? '' : 's'}
        {awaiting > 0 ? ` · ${awaiting} RFE${awaiting === 1 ? '' : 's'} awaiting a quote` : ''}.
      </p>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="supplier-search">Search</Label>
          <Input
            id="supplier-search"
            name="supplierSearch"
            data-testid="suppliers-search"
            className="w-[16rem]"
            placeholder="Supplier or order code"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <SegmentedControl
          value={tab}
          onValueChange={(v) => setTab(v as Tab)}
          options={TABS}
          aria-label="Supplier detail"
        />
      </div>

      {board.isLoading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-[13.5px] text-muted-foreground">
          No suppliers match.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {visible.map((card) => (
            <div
              key={card.id}
              data-testid={`supplier-${card.name}`}
              className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
            >
              <div className="flex items-center gap-2">
                <span className="text-[15px] font-bold text-foreground">{card.name}</span>
                <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold uppercase text-muted-foreground">
                  {card.status}
                </span>
                {card.awaiting > 0 ? (
                  <span className="ml-auto inline-flex items-center rounded-full bg-teal-50 px-2.5 py-0.5 text-[11.5px] font-bold text-teal-700">
                    {card.awaiting} awaiting
                  </span>
                ) : null}
              </div>
              {tab === 'Quotes' ? (
                <QuotesTab card={card} />
              ) : tab === 'Capacity' ? (
                <CapacityTab card={card} />
              ) : tab === 'Certifications' ? (
                <CertsTab card={card} />
              ) : (
                <PricesTab card={card} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default SuppliersPage;
