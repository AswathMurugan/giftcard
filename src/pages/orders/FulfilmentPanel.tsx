/**
 * Award → Produce → Proof → Ship → Bill.
 *
 * Follows the demo's shapes:
 *   Award    supplier orders raised from the award split, one per supplier,
 *            with material carve-outs shown as their own order line
 *   Produce  those supply orders and where each has got to
 *   Proof    proof rounds by type, each with its version history
 *   Ship     planned destinations and what actually despatched against them
 *   Bill     billable extras with cost, price and the margin between
 *
 * One query feeds all five (`order_fulfilment_grid`) because they read the
 * same handful of tables; which stage is LIVE decides what is editable, and
 * everything else renders as the record of what happened.
 */
import { useEffect, useMemo, useState } from 'react';
import { useSavedQueryList, useSavedQuerySingle } from '@/hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  approveProof,
  componentLabel,
  createExpense,
  createShipment,
  createShipmentRecord,
  createSupplyOrders,
  openProof,
  rejectProof,
  saveProofDocument,
} from './order-api';
import { money, unitMoney, type ChainState } from './deal-helpers';
import { ChainBlock } from './ChainBlock';
import { ProofPanel } from './ProofPanel';
import { PROOF_UI, buildProofs, statusAfterApproval } from './proof-helpers';
import {
  expenseTotals,
  forThisOrder,
  plannedForSupplyOrder,
  stageGate,
  shipProgress,
  supplierWorkloads,
  supplyOrders as pickSupplyOrders,
  unplannedUnits,
  type FulfilmentGrid,
  type ShipmentRecordRow,
  awardBlockedReason,
  type ProposalStateRow,
} from './fulfilment-helpers';

/** The fulfilment stages in order — the same sequence as the stage rail. */
/**
 * The WHOLE lifecycle, not just the stages this panel draws.
 *
 * Comparing against only the fulfilment five meant that at Order Close — a
 * stage outside that list — the lookup returned -1 and every block fell back
 * to "pending", so a finished order reported nothing done. The position has
 * to be measured against the full sequence for stages on either side of it to
 * resolve correctly.
 */
const LIFECYCLE = [
  'Order',
  'Specs',
  'Quote',
  'Award',
  'Produce',
  'Proof',
  'Ship',
  'Bill',
  'Order Close',
] as const;

/**
 * Where a block sits relative to the live stage.
 *
 * Derived from the workflow's own stage rather than a local flag, so a reload
 * or another operator sees the same thing — the same rule the decision chain
 * follows.
 */
function stageState(block: string, current: string): ChainState {
  const at = LIFECYCLE.indexOf(current as (typeof LIFECYCLE)[number]);
  const mine = LIFECYCLE.indexOf(block as (typeof LIFECYCLE)[number]);
  // An unknown block can't be placed; an unknown CURRENT stage is treated as
  // the end, because the only way out of the sequence is through it.
  if (mine < 0) return 'pending';
  if (at < 0) return 'approved';
  if (mine < at) return 'approved';
  return mine === at ? 'current' : 'pending';
}


/**
 * Record an actual despatch.
 *
 * Carrier and tracking are typed by the operator, not generated: a tracking
 * number is what the client chases the parcel with, so a made-up one is worse
 * than none at all. The quantity defaults to what is still outstanding and is
 * capped there — over-shipping a destination is a data error, not a choice.
 */
function DespatchForm({
  record,
  remaining,
  busy,
  onDespatch,
}: {
  record: ShipmentRecordRow;
  remaining: number;
  busy: boolean;
  onDespatch: (fields: {
    trackingNo: string;
    carrier: string;
    shippedQty: number;
    shippingCostMicros: number | null;
  }) => Promise<void>;
}) {
  const [carrier, setCarrier] = useState('');
  const [tracking, setTracking] = useState('');
  const [qty, setQty] = useState(String(remaining));
  const [cost, setCost] = useState('');

  const shipped = Number(qty) || 0;
  const tooMany = shipped > remaining;
  const ready = Boolean(carrier.trim() && tracking.trim()) && shipped > 0 && !tooMany;

  async function submit() {
    await onDespatch({
      carrier: carrier.trim(),
      trackingNo: tracking.trim(),
      shippedQty: shipped,
      shippingCostMicros: cost ? Math.round((Number(cost) || 0) * 1_000_000) : null,
    });
    setCarrier('');
    setTracking('');
    setCost('');
  }

  return (
    <div className="mt-2 flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-muted-foreground">Carrier</span>
        <Input
          className="h-8 w-[8rem] text-[12.5px]"
          value={carrier}
          data-testid={`despatch-carrier-${record.destination}`}
          onChange={(e) => setCarrier(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-muted-foreground">Tracking</span>
        <Input
          className="h-8 w-[10rem] text-[12.5px]"
          value={tracking}
          data-testid={`despatch-tracking-${record.destination}`}
          onChange={(e) => setTracking(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-muted-foreground">Qty (max {remaining})</span>
        <Input
          className="h-8 w-[6rem] text-right text-[12.5px]"
          inputMode="numeric"
          value={qty}
          aria-invalid={tooMany}
          data-testid={`despatch-qty-${record.destination}`}
          onChange={(e) => setQty(e.target.value.replace(/[^0-9]/g, ''))}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-muted-foreground">Freight cost</span>
        <Input
          className="h-8 w-[6rem] text-right text-[12.5px]"
          value={cost}
          data-testid={`despatch-cost-${record.destination}`}
          onChange={(e) => setCost(e.target.value.replace(/[^0-9.]/g, ''))}
        />
      </label>
      <Button
        size="sm"
        variant="outline"
        disabled={busy || !ready}
        data-testid={`ship-despatch-${record.destination}`}
        title={
          tooMany
            ? `Only ${remaining} left to ship against this destination`
            : ready
              ? 'Record this despatch'
              : 'Carrier, tracking and a quantity are needed'
        }
        onClick={() => void submit()}
      >
        Record despatch
      </Button>
    </div>
  );
}

/**
 * Signal the stage complete, from inside the stage's own card.
 *
 * The advance lives with the work it is advancing — the same shape the
 * decision chain uses — rather than on the strip above, where it read as a
 * page-level control that happened to affect whichever stage was live.
 *
 * It is refused while the stage's own exit condition is unmet, with the reason
 * beside it: a disabled button with no explanation reads as broken.
 */
function ProceedRow({
  label,
  hint,
  gate,
  busy,
  testId,
  onProceed,
}: {
  label: string;
  hint: string;
  gate: { blocked: boolean; reason: string };
  busy: boolean;
  testId: string;
  onProceed?: () => Promise<void>;
}) {
  if (!onProceed) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border pt-3">
      <Button
        size="sm"
        data-testid={testId}
        aria-busy={busy}
        disabled={busy || gate.blocked}
        title={gate.blocked ? gate.reason : label}
        onClick={() => void onProceed()}
      >
        {label}
        <i className="icon icon_-Tb_arrow_right" aria-hidden="true" />
      </Button>
      <span className="text-[12.5px] text-muted-foreground" data-testid={`${testId}-reason`}>
        {gate.blocked ? gate.reason : hint}
      </span>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums text-foreground">{value}</span>
    </div>
  );
}

export function FulfilmentPanel({
  orderId,
  orderCode,
  requestedDelivery,
  stage,
  clientId,
  clientName,
  onProceed,
  stateName,
  onClose,
}: {
  orderId: string;
  orderCode: string;
  requestedDelivery?: string | null;
  /** Award | Produce | Proof | Ship | Bill | Order Close — decides what is editable. */
  stage: string;
  /** Who the extras are billed to by default: the client on the demand order. */
  clientId: string | null;
  clientName: string | null;
  onProceed?: () => Promise<void>;
  /** The live state within the stage — `Closing` vs `Closed` at the last one. */
  stateName?: string | null;
  /** Files the order. Separate from `onProceed`: this one is not a signal. */
  onClose?: () => Promise<void>;
}) {
  const grid = useSavedQuerySingle('order_fulfilment_grid', {
    input: { orderId },
    enabled: Boolean(orderId),
  });
  /**
   * The client's answer to the proposal, read HERE rather than passed in.
   * Raising a supply order is a commitment to a supplier, and the one thing
   * that must stop it — the client having declined — lives on the proposal.
   * Loading it inside the panel makes the gate impossible to forget from the
   * caller side.
   */
  const proposalState = useSavedQueryList('order_proposals', {
    input: { orderId },
    enabled: Boolean(orderId),
  });
  const [busy, setBusy] = useState(false);
  /** The last failure, shown at the top of the panel. */
  const [problem, setProblem] = useState<string | null>(null);
  const [dest, setDest] = useState('');
  const [destQty, setDestQty] = useState('');
  const [expenseDesc, setExpenseDesc] = useState('');
  const [expenseQty, setExpenseQty] = useState('');
  const [expenseCost, setExpenseCost] = useState('');
  const [expensePrice, setExpensePrice] = useState('');

  const data = grid.data as FulfilmentGrid | null;
  const orders = useMemo(() => pickSupplyOrders(data), [data]);
  const workloads = useMemo(() => supplierWorkloads(data, orders), [data, orders]);
  const supplyIds = useMemo(
    () => new Set(orders.map((r) => r.child_order?.id).filter(Boolean) as string[]),
    [orders],
  );
  const records = useMemo(
    () => forThisOrder(data?.shipment_records, supplyIds),
    [data, supplyIds],
  );
  const expenses = useMemo(() => forThisOrder(data?.expenses, supplyIds), [data, supplyIds]);
  const progress = useMemo(
    () => shipProgress(records, data?.shipments ?? []),
    [records, data],
  );
  const proofs = useMemo(() => buildProofs(data?.reviews ?? []), [data]);
  const totals = useMemo(() => expenseTotals(expenses), [expenses]);
  /**
   * Whether the live stage's work is actually finished.
   *
   * The workflow accepts a signal whenever one is sent — it cannot tell that
   * no supply order was raised or that no proof came back — so each stage
   * checks its own exit condition against the data before offering to move on.
   */
  const gate = useMemo(
    () =>
      stageGate(stage, {
        workloads,
        proofs,
        progress,
        unplannedUnits: unplannedUnits(orders, workloads, records),
      }),
    [stage, workloads, proofs, progress, orders, records],
  );

  const unordered = workloads.filter((w) => !w.ordered);
  /**
   * No allocation reached this panel — which is NOT the same as "every supplier
   * is ordered", though both leave `unordered` empty.
   *
   * Reading them as one thing is how the Award block came to say "All raised —
   * production can start" beside a dead button and, in the same breath,
   * "Nothing is allocated — there is nothing to award". Both sentences were
   * generated from an empty list. The states are opposite and have to be told
   * apart before anything is claimed about them.
   */
  const nothingAllocated = workloads.length === 0;
  const clientDeclined = useMemo(
    () => awardBlockedReason((proposalState.data ?? []) as ProposalStateRow[]),
    [proposalState.data],
  );

  /**
   * Re-read on arrival at a new stage.
   *
   * This panel stays mounted from Award through to Order Close, so without
   * this the grid it renders is whatever was fetched when the operator first
   * reached Award — every later stage inherits that snapshot.
   */
  const gridRefetch = grid.refetch;
  useEffect(() => {
    gridRefetch();
  }, [stage, gridRefetch]);

  /**
   * Which supply order the next destination is planned against.
   *
   * Defaults to the first, but the operator must be able to change it — the
   * empty string means "not chosen yet", so a freshly loaded panel still
   * resolves to a real supply order rather than nothing.
   */
  const [shipFrom, setShipFrom] = useState('');
  const shipFromId = shipFrom || orders[0]?.child_order?.id || null;

  /**
   * How much finished stock that supplier still has unplanned.
   *
   * Its QUANTITY SHARE only — the `line` allocations. A carve-out is a
   * component of those same cards (the card blank, the carrier, the setup),
   * not extra units: counting it here made a 1,000-card order offer 4,500
   * shippable units. Carved-out components move to the assembler, not to a
   * client destination.
   */
  const shipSupplierId =
    orders.find((r) => r.child_order?.id === shipFromId)?.child_order?.seller_party_id?.id ?? null;
  const shipWorkload = workloads.find((w) => w.supplierId === shipSupplierId) ?? null;
  const shipCapacity = shipWorkload ? shipWorkload.units : null;
  const shipUnplanned =
    shipCapacity === null || !shipFromId
      ? 0
      : shipCapacity - plannedForSupplyOrder(records, shipFromId);
  const overPlanned = shipCapacity !== null && (Number(destQty) || 0) > shipUnplanned;

  /**
   * An extra charged out below what it cost.
   *
   * The whole point of an Expense is that it is passed on — pricing one under
   * its cost silently eats the order's margin, so it is refused rather than
   * warned about.
   */
  const expenseUnderwater =
    expensePrice !== '' && (Number(expensePrice) || 0) < (Number(expenseCost) || 0);

  /**
   * Which block is expanded — the live stage by default, and whatever the
   * operator opens after that. `null` means "not chosen yet", so opening Award
   * while producing keeps it open rather than snapping shut on the next render.
   */
  const [openBlock, setOpenBlock] = useState<string | null>(null);
  const isOpen = (key: string) => (openBlock ?? stage) === key;
  const toggle = (key: string) => setOpenBlock((prev) => ((prev ?? stage) === key ? '' : key));

  /** Filed. Read from the STATE, not the stage: Order Close holds both. */
  const closed = stateName === 'Closed';

  /**
   * Every action reports by CHANGING THE PANEL, not by announcing itself.
   *
   * Raising the supply orders, approving a proof, recording a despatch — each
   * one rewrites the block it came from, which is a better confirmation than a
   * popup saying it happened. Only a FAILURE needs words, and it is pinned to
   * the top of the panel where it cannot be missed or dismissed by accident.
   */
  async function run(what: string, fn: () => Promise<unknown>) {
    setBusy(true);
    setProblem(null);
    try {
      await fn();
      await grid.refetch();
    } catch (e) {
      setProblem(`${what} failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  if (grid.isLoading) return <Skeleton className="h-48 rounded-xl" />;


  return (
    <div className="flex flex-col gap-4" data-testid="fulfilment-panel">
      {problem ? (
        <p
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive"
          role="alert"
          data-testid="fulfilment-error"
        >
          {problem}
        </p>
      ) : null}

      <ChainBlock
        title="Award"
        state={stageState('Award', stage)}
        summary={
          nothingAllocated
            ? 'Nothing allocated yet'
            : unordered.length === 0
              ? `${orders.length} supplier order${orders.length === 1 ? '' : 's'} raised`
              : `${unordered.length} supplier${unordered.length === 1 ? '' : 's'} still to order`
        }
        open={isOpen('Award')}
        onToggle={() => toggle('Award')}
      >

        {orders.length === 0 ? (
          <p className="mb-3 text-[12.5px] text-muted-foreground">
            None raised yet.
          </p>
        ) : (
          <div className="mb-3 flex flex-col gap-2">
            {orders.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
                data-testid={`supply-order-${r.child_order?.order_code}`}
              >
                <span className="text-[13px] font-semibold text-foreground">
                  {r.child_order?.order_code}
                  <span className="ml-1.5 font-normal text-muted-foreground">
                    {/* The SELLER — on a supply order we are the buyer. */}
                    {r.child_order?.seller_party_id?.name ?? '—'}
                  </span>
                </span>
                <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-bold uppercase text-teal-700">
                  {/* Supply orders carry no workflow instance, so they have no
                      live state to read. This used to render an `orders.status`
                      jsonb that was written once as {state:"Open"} and never
                      changed — the same constant this literal shows, so the
                      column was carrying no information. Tracking a real PO
                      lifecycle is separate work; until then it is Open. */}
                  Open
                </span>
              </div>
            ))}
          </div>
        )}

        {/* What each supplier is owed an order for. */}
        {workloads.map((w) => (
          <div key={w.supplierId} className="mb-2 rounded-lg bg-muted/40 p-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[12.5px] font-semibold text-foreground">
                {w.supplierName}
                {w.ordered ? (
                  <span className="ml-1.5 text-[11px] font-bold uppercase text-success-500">
                    ordered
                  </span>
                ) : null}
              </span>
              <span className="text-[12px] tabular-nums text-muted-foreground">
                {w.units.toLocaleString()} units · {money(w.costMicros)}
              </span>
            </div>
            {w.carveOuts.map((c) => (
              <div
                key={c.componentRole}
                className="text-[11.5px] text-muted-foreground"
                data-testid={`workload-carve-${w.supplierName}-${c.componentRole}`}
              >
                {componentLabel(c.componentRole)} carve-out · {c.qty.toLocaleString()}
                {c.assemblerName ? ` → assembled by ${c.assemblerName}` : ''}
              </div>
            ))}
          </div>
        ))}

        {stage === 'Award' ? (
          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
            <Button
              data-testid="create-supply-orders"
              aria-busy={busy}
              disabled={busy || unordered.length === 0 || Boolean(clientDeclined)}
              title={
                clientDeclined
                  ? clientDeclined
                  : nothingAllocated
                    ? 'Nothing is allocated yet'
                    : unordered.length === 0
                      ? 'Every supplier already has an order'
                      : 'Raise one supply order per supplier'
              }
              onClick={() =>
                run('Supply orders', async () => {
                  await createSupplyOrders({
                    orderId,
                    orderCode,
                    requestedDelivery,
                    existingCount: orders.length,
                    suppliers: unordered.map((w) => ({
                      supplierId: w.supplierId,
                      supplierName: w.supplierName,
                      lines: w.lines,
                      qty: w.units,
                      // Named, not added. A carve-out is a component of the
                      // same cards, so folding it into `qty` would order the
                      // quantity several times over — but a supplier who only
                      // makes carriers still needs their order to say what it
                      // is for, rather than reading "0 units".
                      components: w.carveOuts.map((c) => componentLabel(c.componentRole)),
                      // Carried so the award can raise a supply LINE per
                      // allocation and bind the two together.
                      allocations: w.allocations,
                    })),
                  });
                  await onProceed?.();
                })
              }
            >
              <i className="icon icon_-Tb_package" aria-hidden="true" />
              Raise {unordered.length || ''} supplier order{unordered.length === 1 ? '' : 's'}
            </Button>
            <span className="text-[12.5px] text-muted-foreground">
              {clientDeclined
                ? clientDeclined
                : nothingAllocated
                  ? 'Nothing is allocated yet — award the line first, then Refresh.'
                  : unordered.length === 0
                    ? 'All raised — production can start.'
                    : 'Creates the purchase orders and moves the order to production.'}
            </span>
          </div>
        ) : null}
        {stage === 'Award' && unordered.length === 0 && !nothingAllocated && !clientDeclined ? (
          <ProceedRow
            label="Proceed to production"
            hint="Every supplier has an order."
            gate={gate}
            busy={busy}
            testId="proceed-produce"
            onProceed={onProceed}
          />
        ) : null}
      </ChainBlock>

      <ChainBlock
        title="Produce"
        state={stageState('Produce', stage)}
        summary={
          orders.length === 0
            ? 'Nothing in production yet'
            : `${orders.length} supply order${orders.length === 1 ? '' : 's'} in production`
        }
        open={isOpen('Produce')}
        onToggle={() => toggle('Produce')}
      >
        {orders.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">
            Raise the supplier orders first.
          </p>
        ) : (
          orders.map((r) => (
            <div
              key={`prod-${r.id}`}
              className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
              data-testid={`produce-${r.child_order?.order_code}`}
            >
              <span className="text-[13px] font-semibold text-foreground">
                {r.child_order?.order_code}
                <span className="ml-1.5 font-normal text-muted-foreground">
                  {r.child_order?.seller_party_id?.name ?? '—'}
                </span>
              </span>
              <span className="text-[12px] text-muted-foreground">
                due {r.child_order?.requested_delivery ?? '—'}
              </span>
            </div>
          ))
        )}
        {stage === 'Produce' ? (
          <ProceedRow
            label="Production complete"
            hint="Moves the order into proofing."
            gate={gate}
            busy={busy}
            testId="proceed-proof"
            onProceed={onProceed}
          />
        ) : null}
      </ChainBlock>

      <ChainBlock
        title="Proof"
        state={stageState('Proof', stage)}
        summary={
          proofs.every((p) => p.status === 'not_requested')
            ? 'No rounds opened'
            : proofs
                .filter((p) => p.status !== 'not_requested')
                .map((p) => `${p.type.replace(' proof', '')} v${p.round} ${PROOF_UI[p.status].label.toLowerCase()}`)
                .join(' · ')
        }
        open={isOpen('Proof')}
        onToggle={() => toggle('Proof')}
      >
        <ProofPanel
          proofs={proofs}
          live={stage === 'Proof'}
          busy={busy}
          onRequest={(p) =>
            run(`${p.type} requested`, () =>
              openProof({ orderId, proofType: p.type, round: p.round + 1 }),
            )
          }
          onUpload={(p, file) =>
            // The document is already in Drive; this records it on the round
            // and moves the proof into review in the same write.
            run(`${p.type} uploaded`, () =>
              saveProofDocument({
                reviewId: p.reviewId as string,
                fileId: file.fileId,
                fileName: file.fileName,
              }),
            )
          }
          onApprove={(p) =>
            run(
              // Says what approving actually DID, which differs by proof:
              // the art proof goes on to the client, the rest are finished.
              statusAfterApproval(p) === 'awaiting_sign'
                ? `${p.type} sent to the client`
                : `${p.type} approved`,
              () =>
                approveProof({
                  reviewId: p.reviewId as string,
                  nextStatus: statusAfterApproval(p),
                  comment:
                    p.status === 'awaiting_sign'
                      ? 'Client signed off.'
                      : 'Approved by CS.',
                }),
            )
          }
          onReject={(p, reason) =>
            run(`${p.type} sent back`, () =>
              rejectProof({
                orderId,
                reviewId: p.reviewId as string,
                proofType: p.type,
                round: p.round,
                reason,
              }),
            )
          }
        />
        {stage === 'Proof' ? (
          <ProceedRow
            label="Proofs signed off"
            hint="Every proof is approved — the order can ship."
            gate={gate}
            busy={busy}
            testId="proceed-ship"
            onProceed={onProceed}
          />
        ) : null}
      </ChainBlock>

      <ChainBlock
        title="Ship"
        state={stageState('Ship', stage)}
        summary={
          progress.length === 0
            ? 'No destinations planned'
            : `${progress.filter((p) => p.state === 'complete').length}/${progress.length} destinations complete`
        }
        open={isOpen('Ship')}
        onToggle={() => toggle('Ship')}
      >
        {progress.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">No destinations planned yet.</p>
        ) : (
          progress.map((p) => (
            <div
              key={p.record.id}
              className="mb-2 rounded-lg border border-border p-2"
              data-testid={`ship-record-${p.record.destination}`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[12.5px] font-semibold text-foreground">
                  {p.record.destination}
                  <span className="ml-1.5 font-normal text-muted-foreground">
                    {p.record.supply_order?.order_code ?? ''}
                  </span>
                </span>
                <span
                  className={`text-[11px] font-bold uppercase ${
                    p.state === 'complete'
                      ? 'text-success-500'
                      : p.state === 'partial'
                        ? 'text-warning-700'
                        : 'text-muted-foreground'
                  }`}
                >
                  {p.state}
                </span>
              </div>
              <Row
                label="Planned / shipped"
                value={`${p.planned.toLocaleString()} / ${p.shipped.toLocaleString()}`}
              />
              {p.despatches.map((d) => (
                <Row
                  key={d.id}
                  label={`${d.carrier ?? 'carrier'} ${d.tracking_no ?? ''}`}
                  value={`${(d.shipped_qty ?? 0).toLocaleString()} · ${money(
                    d.shipping_cost_micros ?? 0,
                  )}`}
                />
              ))}
              {stage === 'Ship' && p.remaining > 0 ? (
                <DespatchForm
                  record={p.record}
                  remaining={p.remaining}
                  busy={busy}
                  onDespatch={(fields) =>
                    run('Despatch', () =>
                      createShipment({
                        shipmentRecordId: p.record.id as string,
                        ...fields,
                      }),
                    )
                  }
                />
              ) : null}
            </div>
          ))
        )}

        {stage === 'Ship' && orders.length > 0 ? (
          <div className="flex flex-col gap-1.5 border-t border-border pt-3">
            <div className="flex flex-wrap items-end gap-2">
              {/* WHICH supplier ships this. With a split award the demand is
                  produced in two places, so booking every destination against
                  the first supply order would credit one supplier with the
                  other's stock. */}
              <label className="flex flex-col gap-1">
                <span className="text-[11.5px] text-muted-foreground">From supply order</span>
                <select
                  className="h-8 rounded-md border border-border bg-card px-2 text-[12.5px] text-foreground"
                  value={shipFrom}
                  data-testid="ship-supply-order"
                  onChange={(e) => setShipFrom(e.target.value)}
                >
                  {orders.map((r) => (
                    <option key={r.child_order?.id} value={r.child_order?.id ?? ''}>
                      {r.child_order?.order_code} · {r.child_order?.seller_party_id?.name ?? '—'}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11.5px] text-muted-foreground">Destination</span>
                <Input
                  className="h-8 w-[14rem] text-[12.5px]"
                  value={dest}
                  data-testid="ship-dest"
                  onChange={(e) => setDest(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11.5px] text-muted-foreground">
                  Quantity{shipCapacity !== null ? ` (${shipUnplanned} unplanned)` : ''}
                </span>
                <Input
                  className="h-8 w-[7rem] text-right text-[12.5px]"
                  inputMode="numeric"
                  value={destQty}
                  aria-invalid={overPlanned}
                  data-testid="ship-qty"
                  onChange={(e) => setDestQty(e.target.value.replace(/[^0-9]/g, ''))}
                />
              </label>
              <Button
                size="sm"
                disabled={busy || !dest.trim() || !destQty || overPlanned}
                data-testid="add-destination"
                title={
                  overPlanned
                    ? `That supplier was awarded ${shipCapacity?.toLocaleString()} units and ${(
                        (shipCapacity ?? 0) - shipUnplanned
                      ).toLocaleString()} are already planned`
                    : 'Plan a destination for this supply order'
                }
                onClick={() =>
                  run('Destination', async () => {
                    await createShipmentRecord({
                      supplyOrderId: shipFromId as string,
                      shipmentType: 'Product',
                      destination: dest.trim(),
                      qty: Number(destQty) || 0,
                    });
                    setDest('');
                    setDestQty('');
                  })
                }
              >
                Add destination
              </Button>
            </div>
            {overPlanned ? (
              <p className="text-[12px] text-destructive" role="alert" data-testid="ship-over-plan">
                Only {shipUnplanned.toLocaleString()} of that supplier's award is still unplanned.
              </p>
            ) : null}
          </div>
        ) : null}
        {stage === 'Ship' ? (
          <ProceedRow
            label="All despatched"
            hint="Every planned destination is complete."
            gate={gate}
            busy={busy}
            testId="proceed-bill"
            onProceed={onProceed}
          />
        ) : null}
      </ChainBlock>

      <ChainBlock
        title="Bill"
        state={stageState('Bill', stage)}
        summary={
          expenses.length === 0
            ? 'Nothing extra to bill'
            : `${money(totals.priceMicros)} billed · ${money(totals.marginMicros)} margin`
        }
        open={isOpen('Bill')}
        onToggle={() => toggle('Bill')}
      >

        {expenses.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">Nothing extra to bill.</p>
        ) : (
          expenses.map((e) => (
            <div
              key={e.id}
              className="mb-1 flex items-baseline justify-between gap-2 text-[12.5px]"
              data-testid={`expense-${e.description}`}
            >
              <span className="text-foreground">
                {e.description}
                <span className="ml-1.5 text-muted-foreground">
                  {e.category} · {e.supply_order?.order_code ?? ''}
                </span>
              </span>
              <span className="tabular-nums text-muted-foreground">
                {/* Who pays is the point of the stage — an extra with no
                    payer named cannot become an invoice line. */}
                <span className="mr-2 font-normal">
                  bill to {e.bill_to_party?.name ?? '— unassigned'}
                </span>
                {(e.qty ?? 0).toLocaleString()} × {unitMoney(e.unit_price_micros ?? null)} ={' '}
                {money((e.unit_price_micros ?? 0) * (e.qty ?? 0))}
              </span>
            </div>
          ))
        )}

        {stage === 'Bill' && orders.length > 0 ? (
          <div className="flex flex-col gap-1.5 border-t border-border pt-3">
            <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11.5px] text-muted-foreground">Against supply order</span>
              <select
                className="h-8 rounded-md border border-border bg-card px-2 text-[12.5px] text-foreground"
                value={shipFrom}
                data-testid="expense-supply-order"
                onChange={(ev) => setShipFrom(ev.target.value)}
              >
                {orders.map((r) => (
                  <option key={r.child_order?.id} value={r.child_order?.id ?? ''}>
                    {r.child_order?.order_code} · {r.child_order?.seller_party_id?.name ?? '—'}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11.5px] text-muted-foreground">Description</span>
              <Input
                className="h-8 w-[14rem] text-[12.5px]"
                value={expenseDesc}
                data-testid="expense-desc"
                onChange={(e) => setExpenseDesc(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11.5px] text-muted-foreground">Qty</span>
              <Input
                className="h-8 w-[5rem] text-right text-[12.5px]"
                inputMode="numeric"
                value={expenseQty}
                data-testid="expense-qty"
                onChange={(e) => setExpenseQty(e.target.value.replace(/[^0-9]/g, ''))}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11.5px] text-muted-foreground">Unit cost</span>
              <Input
                className="h-8 w-[6rem] text-right text-[12.5px]"
                value={expenseCost}
                data-testid="expense-cost"
                onChange={(e) => setExpenseCost(e.target.value.replace(/[^0-9.]/g, ''))}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11.5px] text-muted-foreground">Unit price</span>
              <Input
                className="h-8 w-[6rem] text-right text-[12.5px]"
                value={expensePrice}
                data-testid="expense-price"
                onChange={(e) => setExpensePrice(e.target.value.replace(/[^0-9.]/g, ''))}
              />
            </label>
            <Button
              size="sm"
              disabled={busy || !expenseDesc.trim() || !expenseQty || expenseUnderwater}
              data-testid="add-expense"
              title={
                expenseUnderwater
                  ? 'The price is below the cost — this extra would lose money'
                  : `Billed to ${clientName ?? 'the client'}`
              }
              onClick={() =>
                run('Expense', async () => {
                  await createExpense({
                    supplyOrderId: shipFromId as string,
                    category: 'Additional spec',
                    description: expenseDesc.trim(),
                    qty: Number(expenseQty) || 0,
                    // Money is micros everywhere; the inputs take currency.
                    unitCostMicros: Math.round((Number(expenseCost) || 0) * 1_000_000),
                    unitPriceMicros: Math.round((Number(expensePrice) || 0) * 1_000_000),
                    // An expense with no payer cannot be invoiced; the client
                    // on the demand order is who a billable extra goes to.
                    billToPartyId: clientId,
                  });
                  setExpenseDesc('');
                  setExpenseQty('');
                  setExpenseCost('');
                  setExpensePrice('');
                })
              }
            >
              Add expense
            </Button>
            </div>
            <p className="text-[11.5px] text-muted-foreground">
              Billed to {clientName ?? 'the client on this order'}.
            </p>
            {expenseUnderwater ? (
              <p
                className="text-[12px] text-destructive"
                role="alert"
                data-testid="expense-underwater"
              >
                Unit price is below unit cost — an extra is charged on, not absorbed.
              </p>
            ) : null}
          </div>
        ) : null}
        {stage === 'Bill' ? (
          <ProceedRow
            label="Billing complete"
            hint="Moves the order to Order Close."
            gate={gate}
            busy={busy}
            testId="proceed-close"
            onProceed={onProceed}
          />
        ) : null}
      </ChainBlock>

      {/* ── Order Close ─────────────────────────────────────────────
          The last stage, and the only one whose action is not a signal.
          By the time an order arrives here the workflow run has ended, so
          `Closing → Closed` is written directly (see `closeOrder`). Without
          this block the strip lit its final step and offered nothing to
          click, and every finished order stayed at Closing for ever. */}
      <ChainBlock
        title="Order Close"
        state={stageState('Order Close', stage)}
        summary={
          closed
            ? 'Filed'
            : stage === 'Order Close'
              ? 'Everything is done — file the order'
              : 'Files the order once billing is done'
        }
        open={isOpen('Order Close')}
        onToggle={() => toggle('Order Close')}
      >
        {closed ? (
          <p className="text-[13px] text-muted-foreground" data-testid="order-filed">
            Filed. Nothing further is expected on this order — the record stays readable.
          </p>
        ) : stage === 'Order Close' ? (
          <>
            <p className="text-[13px] text-muted-foreground">
              Every stage is complete. Filing records the order as closed; the workflow run has
              already finished, so nothing is signalled.
            </p>
            {onClose ? (
              <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border pt-3">
                <Button
                  size="sm"
                  data-testid="close-order"
                  aria-busy={busy}
                  disabled={busy}
                  onClick={() => void onClose()}
                >
                  Close order
                  <i className="icon icon_-Tb_check" aria-hidden="true" />
                </Button>
                <span className="text-[12.5px] text-muted-foreground">
                  Marks the order Closed. It stays fully readable afterwards.
                </span>
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            Nothing to file yet — billing has to finish first.
          </p>
        )}
      </ChainBlock>
    </div>
  );
}

export default FulfilmentPanel;
