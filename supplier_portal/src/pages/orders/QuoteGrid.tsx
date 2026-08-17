/**
 * Quote comparison — supplier costs side by side, and the form that records them.
 *
 * Reads `order_quote_grid` (rfes + tiers + responses + response_lines, joined
 * in `quote-helpers`) and writes through `recordSupplierQuote`.
 *
 * Entering a quote here is standing in for the supplier portal: in production
 * the supplier submits their own response, and this same chain of saved
 * queries is what their submission would run. Nothing is simulated — the rows
 * written are the rows a real response produces.
 */
import { Fragment, useMemo } from 'react';
import { useExpandedRows } from '@/pages/_shared/use-expanded-rows';
import { useSavedQuerySingle } from '@/hooks';
import { Skeleton } from '@/components/ui/skeleton';
import { COMPONENT_ROLES, componentLabel } from './order-api';
import {
  bestColumn,
  formatTotal,
  formatUnit,
  premiumPct,
  quoteColumns,
  quoteLines,
  type QuoteGridResult,
} from './quote-helpers';

export function QuoteGrid({ orderId }: { orderId: string }) {
  const grid = useSavedQuerySingle('order_quote_grid', {
    input: { orderId },
    enabled: Boolean(orderId),
  });
  const result = grid.data as QuoteGridResult | null;

  const lines = useMemo(() => quoteLines(result), [result]);
  const columns = useMemo(() => quoteColumns(result, lines), [result, lines]);
  const best = useMemo(() => bestColumn(columns), [columns]);

  /**
   * Which lines show their materials. Collapsed by default: the comparison
   * question is "which supplier is cheaper for this card", and four material
   * rows per card buried that under five times the rows on a multi-card order.
   * The breakdown is what you open when a total looks wrong.
   */
  const lineIds = useMemo(() => lines.map((l) => l.tierId), [lines]);
  const rows = useExpandedRows(lineIds);


  if (grid.isLoading) return <Skeleton className="h-40 rounded-lg" />;
  if (lines.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-[13.5px] text-muted-foreground">
        Nothing out to bid yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2">
        <span className="text-[13px] font-bold text-foreground">Quote comparison</span>
        <span className="text-[12.5px] text-muted-foreground">
          {best
            ? `Best complete quote ${formatTotal(best.total)} — ${best.supplierName}`
            : 'No supplier has priced every line yet'}
        </span>
        <button
          type="button"
          onClick={rows.toggleAll}
          data-testid="toggle-all-materials"
          className="ml-auto text-[12px] font-semibold text-primary-600 hover:underline"
        >
          {rows.allOpen ? 'Collapse all' : 'Expand all'}
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                Line
              </th>
              {columns.map((c) => (
                <th
                  key={c.rfeId}
                  className="px-3 py-2 text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground"
                >
                  {c.supplierName}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              /* One card, then its materials underneath — the same shape the
                 supplier fills in, so both sides read the quote identically. */
              const open = rows.isOpen(line.tierId);
              // Only materials some supplier was actually asked about.
              const materialRoles = COMPONENT_ROLES.filter((mat) =>
                columns.some(
                  (c) =>
                    line.tierId in c.cells && mat.role in (c.cells[line.tierId]?.byRole ?? {}),
                ),
              );
              const materialCount = materialRoles.length;
              return (
              <Fragment key={line.tierId}>
                <tr
                  data-testid={`quote-line-row-${line.name}`}
                  className="border-b border-border bg-muted/20"
                >
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      data-row={line.tierId}
                      onClick={rows.toggle}
                      aria-expanded={open}
                      aria-label={`${open ? 'Hide' : 'Show'} materials for ${line.name}`}
                      data-testid={`toggle-materials-${line.name}`}
                      className="flex w-full items-center gap-2 text-left"
                    >
                      <i
                        className={`icon icon_-Tb_chevron_right text-[1.125rem] text-muted-foreground transition-transform ${
                          open ? 'rotate-90' : ''
                        }`}
                        aria-hidden="true"
                      />
                      <span>
                        <span className="block text-[13px] font-semibold text-foreground">
                          {line.name}
                        </span>
                        <span className="block text-[11.5px] text-muted-foreground">
                          {line.qty.toLocaleString()} units
                          {line.rev !== null ? ` · rev ${line.rev}` : ''}
                          {/* Says there is something to open — a collapsed row
                              with no hint reads as a row with no detail. */}
                          {materialCount > 0 ? ` · ${materialCount} materials` : ''}
                        </span>
                      </span>
                    </button>
                  </td>
                  {columns.map((c) => {
                    const cell = c.cells[line.tierId];
                    return (
                      <td
                        key={c.rfeId}
                        className="px-3 py-2 text-[13px] tabular-nums"
                        data-testid={`quote-cell-${c.supplierName}-${line.name}`}
                      >
                        {cell?.unitCost === null || cell === undefined ? (
                          <span className="text-muted-foreground">
                            {cell?.declined ? 'Declined' : '—'}
                          </span>
                        ) : (
                          <>
                            <span className="font-semibold text-foreground">
                              {formatUnit(cell.unitCost)}
                            </span>
                            <span className="ml-1.5 text-[11.5px] text-muted-foreground">
                              {formatTotal(cell.extended)}
                            </span>
                            {/* An unanswered material means this card total is
                                a floor, not the price — say so rather than
                                letting it compete as if it were complete. */}
                            {cell.hasUncosted ? (
                              <span className="ml-1.5 text-[11px] font-semibold text-warning-700">
                                partial
                              </span>
                            ) : null}
                          </>
                        )}
                      </td>
                    );
                  })}
                </tr>

                {(open ? materialRoles : []).map((mat) => {
                  return (
                    <tr
                      key={`${line.tierId}-${mat.role}`}
                      data-testid={`quote-material-row-${line.name}-${mat.role}`}
                      className="border-b border-border last:border-b-0"
                    >
                      <td className="py-1.5 pl-8 pr-3 text-[12.5px] text-muted-foreground">
                        {componentLabel(mat.role)}
                        {mat.perUnit ? '' : ' (one-off)'}
                      </td>
                      {columns.map((c) => {
                        const cell = c.cells[line.tierId];
                        const unit = cell?.byRole?.[mat.role] ?? null;
                        const declined = cell?.declinedRoles.includes(mat.role) ?? false;
                        return (
                          <td
                            key={c.rfeId}
                            className="py-1.5 px-3 text-[12.5px] tabular-nums text-muted-foreground"
                            data-testid={`quote-material-${c.supplierName}-${line.name}-${mat.role}`}
                          >
                            {declined ? 'Declined' : unit === null ? '—' : formatUnit(unit)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </Fragment>
              );
            })}

            <tr className="bg-muted/30">
              <td className="px-3 py-2 text-[12px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                Total · lead
              </td>
              {columns.map((c) => {
                const over = premiumPct(c, best);
                return (
                  <td key={c.rfeId} className="px-3 py-2" data-testid={`quote-total-${c.supplierName}`}>
                    <span className="block text-[13px] font-bold tabular-nums text-foreground">
                      {formatTotal(c.total)}
                      {/* Only meaningful against a complete quote — see bestColumn. */}
                      {over !== null && over > 0 ? (
                        <span className="ml-1.5 text-[11.5px] font-semibold text-warning-700">
                          +{over}%
                        </span>
                      ) : null}
                    </span>
                    <span className="block text-[11.5px] text-muted-foreground">
                      {c.leadTimeWeeks !== null ? `${c.leadTimeWeeks} wk` : 'no lead time'}
                      {!c.complete && c.total !== null ? ' · partial' : ''}
                    </span>
                  </td>
                );
              })}
            </tr>

            {/* No "open supplier view" row. This table is the CS-side
                comparison; the supplier's own page is reached from the
                Suppliers screen, and a link into it from here only ever
                served as a shortcut while the portal was being built. */}
          </tbody>
        </table>
      </div>


    </div>
  );
}

export default QuoteGrid;
