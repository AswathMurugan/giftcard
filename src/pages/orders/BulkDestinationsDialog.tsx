/**
 * Plan several destinations in one pass (US-807).
 *
 * The single-add form below this dialog is right for one destination and
 * miserable for twenty-four — which is why the spreadsheet this replaces
 * exists. The interaction mirrors how people actually describe the job: say
 * the thing that is common once, then adjust the quantities that are not.
 *
 * Two affordances do most of the work:
 *   - **Fill remaining** proposes exactly what each supply order still owes,
 *     which is the common case for a single-DC delivery.
 *   - **Split evenly** takes one total and spreads it, remainder first, for
 *     the case where a client wants an equal share from every supplier.
 *
 * Nothing is created until `buildBulkPlan` is happy. Errors render per-reason
 * and name the supply order, because "quantity too high" on a grid of
 * twenty-four rows is a puzzle rather than an instruction.
 */

import { useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  buildBulkPlan,
  bulkSummary,
  fillRemaining,
  splitEvenly,
  type BulkTarget,
  type ShipmentRecordPayload,
} from './shipment-bulk';

export interface BulkDestinationsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targets: BulkTarget[];
  busy?: boolean;
  onCreate: (payloads: ShipmentRecordPayload[]) => Promise<void>;
}

export function BulkDestinationsDialog({
  open,
  onOpenChange,
  targets,
  busy,
  onCreate,
}: BulkDestinationsDialogProps) {
  const [destination, setDestination] = useState('');
  const [plannedDate, setPlannedDate] = useState('');
  const [splitTotal, setSplitTotal] = useState('');
  // Keyed by supply order id; held as strings so a half-typed value survives.
  const [qty, setQty] = useState<Record<string, string>>({});

  const rows = useMemo(
    () =>
      targets.map((t) => ({
        supplyOrderId: t.supplyOrderId,
        qty: Number(qty[t.supplyOrderId] ?? '') || 0,
      })),
    [targets, qty],
  );

  const plan = useMemo(
    () => buildBulkPlan({ destination, shipmentType: 'Product', plannedDate }, rows, targets),
    [destination, plannedDate, rows, targets],
  );

  // The dialog is only useful while something is still unplanned.
  const openTargets = targets.filter((t) => t.unplanned > 0);

  function applyFillRemaining() {
    const next: Record<string, string> = {};
    for (const row of fillRemaining(targets)) next[row.supplyOrderId] = String(row.qty);
    setQty(next);
  }

  function applySplitEvenly() {
    const total = Number(splitTotal) || 0;
    const parts = splitEvenly(total, openTargets.length);
    const next: Record<string, string> = {};
    openTargets.forEach((t, i) => {
      next[t.supplyOrderId] = String(parts[i] ?? 0);
    });
    setQty(next);
  }

  function reset() {
    setDestination('');
    setPlannedDate('');
    setSplitTotal('');
    setQty({});
  }

  async function handleCreate() {
    if (plan.errors.length > 0) return;
    await onCreate(plan.payloads);
    reset();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[40rem]" data-testid="bulk-destinations-dialog">
        <DialogHeader>
          <DialogTitle>Plan destinations</DialogTitle>
          <DialogDescription>
            Set what every destination shares, then give each supply order its quantity.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="bulk-destination">Destination</Label>
              <Input
                id="bulk-destination"
                name="bulkDestination"
                className="w-[16rem]"
                value={destination}
                data-testid="bulk-destination"
                onChange={(e) => setDestination(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="bulk-planned-date">Planned date</Label>
              <Input
                id="bulk-planned-date"
                name="bulkPlannedDate"
                type="date"
                value={plannedDate}
                data-testid="bulk-planned-date"
                onChange={(e) => setPlannedDate(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
            <Button
              variant="outline"
              size="sm"
              data-testid="bulk-fill-remaining"
              onClick={applyFillRemaining}
            >
              Fill remaining
            </Button>
            <div className="flex items-end gap-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="bulk-split-total">Split a total</Label>
                <Input
                  id="bulk-split-total"
                  name="bulkSplitTotal"
                  className="w-[8rem] text-right"
                  inputMode="numeric"
                  value={splitTotal}
                  data-testid="bulk-split-total"
                  onChange={(e) => setSplitTotal(e.target.value.replace(/[^0-9]/g, ''))}
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={!splitTotal || openTargets.length === 0}
                data-testid="bulk-split-evenly"
                onClick={applySplitEvenly}
              >
                Split evenly
              </Button>
            </div>
          </div>

          <div className="flex flex-col divide-y divide-border rounded-md border border-border">
            {targets.length === 0 ? (
              <p className="p-3 text-[0.875rem] text-muted-foreground" data-testid="bulk-empty">
                No supply orders on this order yet.
              </p>
            ) : (
              targets.map((t) => (
                <div
                  key={t.supplyOrderId}
                  className="flex items-center justify-between gap-3 p-2.5"
                  data-row-key={t.supplyOrderCode}
                  data-testid={`bulk-row-${t.supplyOrderCode}`}
                >
                  <div className="min-w-0">
                    <p className="truncate text-[0.875rem] font-semibold text-foreground">
                      {t.supplyOrderCode}
                    </p>
                    <p className="text-[0.8125rem] text-muted-foreground">
                      {t.unplanned > 0
                        ? `${t.unplanned.toLocaleString()} unplanned`
                        : 'Fully planned'}
                    </p>
                  </div>
                  <Input
                    className="w-[7rem] text-right"
                    inputMode="numeric"
                    aria-label={`Quantity for ${t.supplyOrderCode}`}
                    disabled={t.unplanned <= 0}
                    value={qty[t.supplyOrderId] ?? ''}
                    data-testid={`bulk-qty-${t.supplyOrderCode}`}
                    onChange={(e) =>
                      setQty((prev) => ({
                        ...prev,
                        [t.supplyOrderId]: e.target.value.replace(/[^0-9]/g, ''),
                      }))
                    }
                  />
                </div>
              ))
            )}
          </div>

          {/* Errors only once something has been entered — an untouched form
              should not open shouting about a missing destination. */}
          {plan.errors.length > 0 && (destination.trim() !== '' || Object.keys(qty).length > 0) ? (
            <div
              className="flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive/10 p-2.5"
              role="alert"
              data-testid="bulk-errors"
            >
              {plan.errors.map((message) => (
                <p key={message} className="text-[0.8125rem] text-destructive">
                  {message}
                </p>
              ))}
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
            <p className="text-[0.8125rem] text-muted-foreground" data-testid="bulk-summary">
              {bulkSummary(rows)}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                aria-busy={Boolean(busy)}
                disabled={Boolean(busy) || plan.errors.length > 0}
                data-testid="bulk-create"
                onClick={handleCreate}
              >
                Create destinations
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default BulkDestinationsDialog;
