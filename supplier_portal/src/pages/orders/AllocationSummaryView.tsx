/**
 * The award split, read-only.
 *
 * Shown once the workflow has moved past Allocation. Deliberately reads the
 * committed `line_allocation` rows rather than re-rendering the panel's local
 * state: past the gate this is a RECORD of what was awarded, and showing
 * unsaved edit state here would let the screen disagree with the database
 * about what a supplier was actually given.
 */
import { useMemo } from 'react';
import { useSavedQuerySingle } from '@/hooks';
import { Skeleton } from '@/components/ui/skeleton';
import { componentLabel } from './order-api';
import { money, unitMoney } from './deal-helpers';

interface AllocationRowData {
  id?: string;
  kind?: string;
  qty?: number;
  unit_cost_micros?: number;
  component_role?: string | null;
  supplier?: { name?: string } | null;
  assembler?: { name?: string } | null;
  order_line_ref?: { id?: string } | null;
}

export function AllocationSummaryView({
  orderId,
  lines,
}: {
  orderId: string;
  /** Deal lines, for the name and demand quantity of each order line. */
  lines: Array<{ orderLineId: string; tierId: string; name: string; qty: number }>;
}) {
  const grid = useSavedQuerySingle('order_allocation_grid', {
    input: { orderId },
    enabled: Boolean(orderId),
  });

  const byLine = useMemo(() => {
    const raw = (grid.data as { allocations?: AllocationRowData[] } | null)?.allocations ?? [];
    const out = new Map<string, AllocationRowData[]>();
    for (const a of raw) {
      const id = a.order_line_ref?.id;
      if (!id) continue;
      out.set(id, [...(out.get(id) ?? []), a]);
    }
    return out;
  }, [grid.data]);

  if (grid.isLoading) return <Skeleton className="h-32 rounded-xl" />;

  const total = [...byLine.values()]
    .flat()
    .reduce((n, a) => n + (a.unit_cost_micros ?? 0) * (a.qty ?? 0), 0);

  return (
    <div
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
      data-testid="allocation-summary"
    >
      <div className="flex items-baseline gap-2">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
          Award split
        </h3>
        <span className="text-[12px] text-muted-foreground">
          Awarded — read-only from here on.
        </span>
      </div>

      {lines.map((line) => {
        const rows = byLine.get(line.orderLineId) ?? [];
        const shares = rows.filter((r) => r.kind !== 'carve_out');
        const carves = rows.filter((r) => r.kind === 'carve_out');
        return (
          <div key={line.tierId} className="rounded-lg border border-border p-3">
            <div className="mb-1.5 text-[13px] font-semibold text-foreground">
              {line.name}
              <span className="ml-1.5 font-normal text-muted-foreground">
                {line.qty.toLocaleString()} units
              </span>
            </div>

            {shares.length === 0 ? (
              <p className="text-[12.5px] text-muted-foreground">No allocation recorded.</p>
            ) : (
              shares.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-2 py-0.5 text-[12.5px]"
                  data-testid={`awarded-share-${line.name}-${r.supplier?.name ?? 'unknown'}`}
                >
                  <span className="text-foreground">{r.supplier?.name ?? '—'}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {(r.qty ?? 0).toLocaleString()} × {unitMoney(r.unit_cost_micros ?? null)} ={' '}
                    {money((r.unit_cost_micros ?? 0) * (r.qty ?? 0))}
                  </span>
                </div>
              ))
            )}

            {carves.length > 0 ? (
              <div className="mt-2 rounded-md bg-muted/40 p-2">
                <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                  Material carve-outs
                </span>
                {carves.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between gap-2 py-0.5 text-[12.5px]"
                    data-testid={`awarded-carve-${line.name}-${r.component_role}`}
                  >
                    <span className="text-foreground">
                      {componentLabel(r.component_role)} → {r.supplier?.name ?? '—'}
                      {r.assembler?.name ? (
                        <span className="text-muted-foreground">
                          {' '}
                          · assembled by {r.assembler.name}
                        </span>
                      ) : null}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {(r.qty ?? 0).toLocaleString()} × {unitMoney(r.unit_cost_micros ?? null)} ={' '}
                      {money((r.unit_cost_micros ?? 0) * (r.qty ?? 0))}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}

      <div className="flex justify-between border-t border-border pt-2 text-[13px] font-semibold">
        <span className="text-muted-foreground">Awarded cost</span>
        <span className="tabular-nums text-foreground">{money(total)}</span>
      </div>
    </div>
  );
}

export default AllocationSummaryView;
