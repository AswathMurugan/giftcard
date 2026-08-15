/**
 * Allocation — the award split, line by line.
 *
 * Domain model B4: an Allocation maps a demand OrderLine to a supply line with
 * an allocated QUANTITY, under the constraint "sum of allocations = demand
 * line qty". So a line is split by quantity across suppliers, not handed whole
 * to one — which is the whole point of the step, and what a single supplier
 * dropdown could not express.
 *
 * The Forge demo works the same way: `alloc: [{supplier, qty}]` with editable
 * quantities, add/remove rows, and a balance check gating the action
 * ("Allocate exactly 10,000 to create the orders").
 *
 * Writes through `replaceAllocations`, which clears the order's allocations
 * before inserting, so re-allocating can never leave half of a previous split
 * standing beside the new one.
 */
import { useCallback, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { COMPONENT_ROLES, componentLabel } from './order-api';
import {
  allocationSummary,
  money,
  unitMoney,
  type AllocationRow,
  type CarveOut,
} from './deal-helpers';

export interface AllocationLineInput {
  orderLineId: string;
  tierId: string;
  name: string;
  qty: number;
  /** Everyone who priced this line, cheapest first. */
  quotes: Array<{
    supplierId: string;
    supplierName: string;
    unitCostMicros: number | null;
    /** Per-material unit costs — what a carve-out is priced from. */
    byRole: Record<string, number | null>;
    hasUncosted?: boolean;
  }>;
  /** The deal's default supplier — the cheapest complete quote. */
  suggestedSupplierId: string | null;
}

export function AllocationPanel({
  lines,
  busy,
  onAllocate,
}: {
  lines: AllocationLineInput[];
  busy: boolean;
  /** Writes the rows, then signals the workflow. */
  onAllocate: (
    rows: Array<{
      orderLineId: string;
      supplierId: string;
      qty: number;
      unitCostMicros: number | null;
      /** 'line' for a quantity share, 'carve_out' for a material. */
      kind: 'line' | 'carve_out';
      componentRole: string | null;
      /** Who receives a carved-out material. Null on a plain line row. */
      assemblerId: string | null;
    }>,
  ) => Promise<void>;
}) {
  /**
   * orderLineId → its split rows.
   *
   * Seeded from the deal's suggestion — the whole quantity to the cheapest
   * complete quote — so the common case is one click, and splitting is an
   * edit rather than data entry from nothing.
   */
  const [splits, setSplits] = useState<Record<string, AllocationRow[]>>(() => {
    const seed: Record<string, AllocationRow[]> = {};
    for (const l of lines) {
      if (l.suggestedSupplierId) seed[l.orderLineId] = [{ supplierId: l.suggestedSupplierId, qty: l.qty }];
    }
    return seed;
  });

  /** Materials taken off the line's assembler, per line. */
  const [carveOuts, setCarveOuts] = useState<Record<string, CarveOut[]>>({});

  const unitCostFor = useCallback(
    (orderLineId: string, supplierId: string) =>
      lines
        .find((l) => l.orderLineId === orderLineId)
        ?.quotes.find((q) => q.supplierId === supplierId)?.unitCostMicros ?? null,
    [lines],
  );

  const costs = useMemo(
    () => ({
      unit: unitCostFor,
      material: (orderLineId: string, supplierId: string, role: string) =>
        lines
          .find((l) => l.orderLineId === orderLineId)
          ?.quotes.find((q) => q.supplierId === supplierId)?.byRole[role] ?? null,
    }),
    [lines, unitCostFor],
  );

  const summary = useMemo(
    () => allocationSummary(lines, splits, carveOuts, costs),
    [lines, splits, carveOuts, costs],
  );

  /** What this maker no longer supplies on this line, per unit. */
  const carvedFrom = useCallback(
    (line: { orderLineId: string; carveOuts: CarveOut[] }, supplierId: string) =>
      line.carveOuts.reduce(
        (n, c) => n + (costs.material(line.orderLineId, supplierId, c.componentRole) ?? 0),
        0,
      ),
    [costs],
  );

  function updateRow(lineId: string, index: number, patch: Partial<AllocationRow>) {
    setSplits((prev) => {
      const rows = [...(prev[lineId] ?? [])];
      rows[index] = { ...rows[index], ...patch };
      return { ...prev, [lineId]: rows };
    });
  }

  function addRow(lineId: string) {
    const line = lines.find((l) => l.orderLineId === lineId);
    if (!line) return;
    setSplits((prev) => {
      const rows = prev[lineId] ?? [];
      const taken = new Set(rows.map((r) => r.supplierId));
      // Default the new row to a supplier not already on this line, and to
      // whatever quantity is still unplaced — the two things the operator
      // would otherwise type by hand every time.
      const next = line.quotes.find((q) => !taken.has(q.supplierId) && q.unitCostMicros !== null);
      if (!next) return prev;
      const remaining = Math.max(0, line.qty - rows.reduce((n, r) => n + (r.qty || 0), 0));
      return { ...prev, [lineId]: [...rows, { supplierId: next.supplierId, qty: remaining }] };
    });
  }

  function removeRow(lineId: string, index: number) {
    setSplits((prev) => ({
      ...prev,
      [lineId]: (prev[lineId] ?? []).filter((_, i) => i !== index),
    }));
  }

  const onQtyChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const { line, index } = event.currentTarget.dataset;
    if (!line || index === undefined) return;
    const qty = Number(event.target.value.replace(/[^0-9]/g, '')) || 0;
    updateRow(line, Number(index), { qty });
  }, []);

  const onSupplierChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    const { line, index } = event.currentTarget.dataset;
    if (!line || index === undefined) return;
    updateRow(line, Number(index), { supplierId: event.target.value });
  }, []);

  const onAddRow = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    const line = event.currentTarget.dataset.line;
    if (line) addRow(line);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines]);

  const onRemoveRow = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    const { line, index } = event.currentTarget.dataset;
    if (line && index !== undefined) removeRow(line, Number(index));
  }, []);

  function addCarveOut(lineId: string) {
    const line = lines.find((l) => l.orderLineId === lineId);
    if (!line) return;
    setCarveOuts((prev) => {
      const held = prev[lineId] ?? [];
      const taken = new Set(held.map((c) => c.componentRole));
      // Only materials somebody actually quoted, and not already carved out.
      const role = COMPONENT_ROLES.map((c) => c.role).find(
        (r) => !taken.has(r) && line.quotes.some((q) => q.byRole[r] != null),
      );
      if (!role) return prev;
      const maker = line.quotes.find((q) => q.byRole[role] != null);
      if (!maker) return prev;
      return { ...prev, [lineId]: [...held, { componentRole: role, supplierId: maker.supplierId }] };
    });
  }

  const onCarveSupplier = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    const { line, index } = event.currentTarget.dataset;
    if (!line || index === undefined) return;
    const value = event.target.value;
    setCarveOuts((prev) => {
      const rows = [...(prev[line] ?? [])];
      rows[Number(index)] = { ...rows[Number(index)], supplierId: value };
      return { ...prev, [line]: rows };
    });
  }, []);

  const onCarveRemove = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    const { line, index } = event.currentTarget.dataset;
    if (!line || index === undefined) return;
    setCarveOuts((prev) => ({
      ...prev,
      [line]: (prev[line] ?? []).filter((_, i) => i !== Number(index)),
    }));
  }, []);

  const onAddCarve = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    const line = event.currentTarget.dataset.line;
    if (line) addCarveOut(line);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines]);

  async function handleAllocate() {
    const rows = summary.lines.flatMap((l) => [
      // The quantity shares — kind 'line', no component, no assembler.
      ...l.rows
        .filter((r) => r.supplierId && r.qty > 0)
        .map((r) => ({
          orderLineId: l.orderLineId,
          supplierId: r.supplierId,
          qty: r.qty,
          unitCostMicros: unitCostFor(l.orderLineId, r.supplierId),
          kind: 'line' as const,
          componentRole: null,
          assemblerId: null,
        })),
      // The carve-outs — the whole line quantity of one material, made by
      // someone else and shipped to the assembler.
      ...l.carveOuts.map((c) => ({
        orderLineId: l.orderLineId,
        supplierId: c.supplierId,
        qty: l.qty,
        unitCostMicros: costs.material(l.orderLineId, c.supplierId, c.componentRole),
        kind: 'carve_out' as const,
        componentRole: c.componentRole,
        assemblerId: l.assemblerId,
      })),
    ]);
    await onAllocate(rows);
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4" data-testid="allocation-panel">
      <div className="flex items-baseline gap-2">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
          Award each line
        </h3>
        <span className="text-[12px] text-muted-foreground">
          Split a line across suppliers by quantity — each line must add up
          exactly before it can be awarded.
        </span>
      </div>

      {summary.lines.map((line) => (
        <div key={line.tierId} className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[13px] font-semibold text-foreground">
              {line.name}
              <span className="ml-1.5 font-normal text-muted-foreground">
                {line.qty.toLocaleString()} units
              </span>
            </span>
            {/* The constraint, stated where it can be acted on. */}
            <span
              className={`text-[12px] font-semibold ${
                line.balanced
                  ? 'text-success-500'
                  : line.remaining < 0
                    ? 'text-destructive'
                    : 'text-warning-700'
              }`}
              data-testid={`alloc-balance-${line.name}`}
            >
              {line.balanced ? (
                <>
                  <i className="icon icon_-Tb_circle_check mr-1" aria-hidden="true" />
                  Balanced
                </>
              ) : line.remaining < 0 ? (
                `${Math.abs(line.remaining).toLocaleString()} over`
              ) : (
                `${line.remaining.toLocaleString()} still to place`
              )}
            </span>
          </div>

          {line.rows.map((row, index) => {
            const unit = unitCostFor(line.orderLineId, row.supplierId);
            const lineQuotes = lines.find((l) => l.orderLineId === line.orderLineId)?.quotes ?? [];
            return (
              <div key={`${line.tierId}-${index}`} className="flex items-center gap-2">
                <select
                  className="h-8 flex-1 rounded-md border border-border bg-card px-1.5 text-[12.5px]"
                  data-testid={`alloc-supplier-${line.name}-${index}`}
                  aria-label={`Supplier ${index + 1} for ${line.name}`}
                  value={row.supplierId}
                  data-line={line.orderLineId}
                  data-index={index}
                  onChange={onSupplierChange}
                >
                  {lineQuotes
                    .filter((q) => q.unitCostMicros !== null)
                    .map((q) => (
                      <option key={q.supplierId} value={q.supplierId}>
                        {q.supplierName} {unitMoney(q.unitCostMicros)}
                        {q.hasUncosted ? ' (partial)' : ''}
                      </option>
                    ))}
                </select>
                <Input
                  className="h-8 w-[6rem] text-right text-[12.5px]"
                  inputMode="numeric"
                  data-testid={`alloc-qty-${line.name}-${index}`}
                  aria-label={`Quantity for ${line.name} row ${index + 1}`}
                  value={String(row.qty)}
                  data-line={line.orderLineId}
                  data-index={index}
                  onChange={onQtyChange}
                />
                <span className="w-[5.5rem] text-right text-[12.5px] tabular-nums text-muted-foreground">
                  {/* Net of anything carved away from this maker — they no
                      longer supply that material, so charging it to them here
                      would not reconcile with the line total below. */}
                  {unit === null ? '—' : money(Math.max(0, unit - carvedFrom(line, row.supplierId)) * (row.qty || 0))}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 px-2"
                  data-line={line.orderLineId}
                  data-index={index}
                  onClick={onRemoveRow}
                  // The last row is what holds the line's quantity; removing it
                  // would read as "unallocated" rather than "not yet split".
                  disabled={line.rows.length < 2}
                  aria-label={`Remove supplier ${index + 1} from ${line.name}`}
                  data-testid={`alloc-remove-${line.name}-${index}`}
                >
                  <i className="icon icon_-Tb_trash text-[1.125rem]" aria-hidden="true" />
                </Button>
              </div>
            );
          })}

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              data-line={line.orderLineId}
              onClick={onAddRow}
              data-testid={`alloc-add-${line.name}`}
            >
              <i className="icon icon_-Tb_circle_plus text-[1.125rem]" aria-hidden="true" />
              Split across another supplier
            </Button>
            <Button
              size="sm"
              variant="outline"
              data-line={line.orderLineId}
              onClick={onAddCarve}
              data-testid={`carve-add-${line.name}`}
            >
              <i className="icon icon_-Tb_arrows_split text-[1.125rem]" aria-hidden="true" />
              Carve out a material
            </Button>
          </div>

          {line.carveOuts.length > 0 ? (
            <div className="flex flex-col gap-2 rounded-lg bg-muted/40 p-2">
              <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                Material carve-outs
                {/* Says where the carved material goes — the demo's
                    "assembler · receives carved-out materials". */}
                {line.assemblerId ? (
                  <span className="ml-1.5 font-normal normal-case tracking-normal">
                    · assembled by{' '}
                    {lines
                      .find((l) => l.orderLineId === line.orderLineId)
                      ?.quotes.find((q) => q.supplierId === line.assemblerId)?.supplierName ??
                      'the line supplier'}
                  </span>
                ) : null}
              </span>
              {line.carveOuts.map((c, index) => (
                <div key={`${line.tierId}-${c.componentRole}`} className="flex items-center gap-2">
                  <span className="w-[9rem] text-[12.5px] text-foreground">
                    {componentLabel(c.componentRole)}
                    <i
                      className="icon icon_-Tb_arrow_right mx-1.5 text-[1rem] text-muted-foreground"
                      aria-hidden="true"
                    />
                  </span>
                  <select
                    className="h-8 flex-1 rounded-md border border-border bg-card px-1.5 text-[12.5px]"
                    data-testid={`carve-supplier-${line.name}-${c.componentRole}`}
                    aria-label={`${componentLabel(c.componentRole)} supplier for ${line.name}`}
                    value={c.supplierId}
                    data-line={line.orderLineId}
                    data-index={index}
                    onChange={onCarveSupplier}
                  >
                    {(lines.find((l) => l.orderLineId === line.orderLineId)?.quotes ?? [])
                      .filter((q) => q.byRole[c.componentRole] != null)
                      .map((q) => (
                        <option key={q.supplierId} value={q.supplierId}>
                          {q.supplierName} {unitMoney(q.byRole[c.componentRole])}
                        </option>
                      ))}
                  </select>
                  <span className="w-[5.5rem] text-right text-[12.5px] tabular-nums text-muted-foreground">
                    {money((costs.material(line.orderLineId, c.supplierId, c.componentRole) ?? 0) * line.qty)}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 px-2"
                    data-line={line.orderLineId}
                    data-index={index}
                    onClick={onCarveRemove}
                    aria-label={`Remove the ${componentLabel(c.componentRole)} carve-out from ${line.name}`}
                    data-testid={`carve-remove-${line.name}-${c.componentRole}`}
                  >
                    <i className="icon icon_-Tb_trash text-[1.125rem]" aria-hidden="true" />
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
        <Button
          data-testid="commit-allocation"
          onClick={handleAllocate}
          aria-busy={busy}
          disabled={busy || !summary.allBalanced}
          title={
            summary.allBalanced
              ? 'Write the award split and move to proposal'
              : 'Every line must add up to its quantity first'
          }
        >
          <i className="icon icon_-Tb_arrow_guide" aria-hidden="true" />
          Allocate
        </Button>
        <span className="text-[12.5px] text-muted-foreground" data-testid="alloc-total">
          {summary.allBalanced
            ? `${money(summary.totalCostMicros)} · ${
                summary.splitLines > 0
                  ? `${summary.splitLines} split line(s)`
                  : 'one supplier per line'
              }${
                summary.carveOutCount > 0
                  ? ` · ${summary.carveOutCount} material carve-out(s)`
                  : ''
              }.`
            : 'Balance every line to continue.'}
        </span>
      </div>
    </div>
  );
}

export default AllocationPanel;
