/**
 * Decision chain — Deal Review → Allocation → Proposal, end to end.
 *
 * Follows the demo's shape: per-component margins (card / carrier / features
 * / setup, exactly `pricing_template_role`), a mandatory reason before any
 * override commits, a floor breach that blocks the proposal, and a blended
 * margin across the order.
 *
 * Step state is derived from what EXISTS, never from a flag column:
 *   Deal Review  current until every line is priced and none breaches the floor
 *   Allocation   current until each line's allocations sum to its quantity
 *   Proposal     current until an award_record is written
 * That way reloading the page, or someone else doing the work, lands on the
 * same place — see `chainStates`.
 */
import { Fragment, useMemo, useState } from 'react';
import { useSavedQueryList, useSavedQuerySingle } from '@/hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  buildProposal,
  componentLabel,
  recordMarginOverride,
  replaceAllocations,
  writeAwardRecord,
  type AllocationInput,
  type ProposalRow,
} from './order-api';
import { asNumber } from '@/lib/runtime';
import { quoteColumns, quoteLines, type QuoteGridResult } from './quote-helpers';
import { useExpandedRows } from '@/pages/_shared/use-expanded-rows';
import { ChainBlock } from './ChainBlock';
import { StepGroup } from './StepGroup';
import { PlanPanel } from './PlanPanel';
import { AllocationPanel } from './AllocationPanel';
import { ProposalPanel } from './ProposalPanel';
import { AllocationSummaryView } from './AllocationSummaryView';
import {
  buildDeal,
  buildSupplierDeals,
  recommendSuppliers,
  marginForRole,
  chainStates,
  STATE_CLASS,
  STATE_LABEL,
  money,
  pct,
  unitMoney,
  type ChainState,
  type CommittedShare,
  type MarginOverrideRow,
  type PricingRole,
  type PricingTemplate,
} from './deal-helpers';



/**
 * One decision-chain step as a status card.
 *
 * A progress READ, deliberately control-free: a third-width card is the wrong
 * place to price a deal, and mixing "where am I" with "what do I do" made both
 * harder to scan. The work sits below these, under the numbers it acts on.
 */
function StepCard({ title, state, detail }: { title: string; state: ChainState; detail: string }) {
  return (
    <div
      className={`rounded-xl border bg-card p-4 ${
        state === 'current' ? 'border-teal-200' : 'border-border'
      }`}
      data-testid={`chain-step-${title}`}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[13.5px] font-bold text-foreground">{title}</span>
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${STATE_CLASS[state]}`}
          data-testid={`chain-state-${title}`}
        >
          {STATE_LABEL[state]}
        </span>
      </div>
      <p className="text-[12px] text-muted-foreground">{detail}</p>
    </div>
  );
}

export function DecisionChain({
  orderId,
  orderNo,
  clientId,
  clientName,
  requestedDelivery,
  onProceed,
  stateName = null,
  quoteInputs,
}: {
  orderId: string;
  orderNo: string;
  clientId: string | null;
  clientName: string | null;
  requestedDelivery?: string | null;
  /**
   * Advance the workflow, called by Proceed to award AFTER the deal-review
   * rows are written.
   */
  onProceed?: () => Promise<void>;
  /**
   * The workflow STATE inside the Quote stage — "Deal Review", "Allocation",
   * "Proposal" — which is what this chain maps onto one-for-one.
   *
   * Drives which step is live rather than a local flag, so a reload or a
   * different operator lands on the same step. The `quote` function node
   * writes each of these via tq_state_add and then waits for a signal.
   */
  stateName?: string | null;
  /**
   * The RFE table and quote comparison, rendered inside the Deal Review block.
   *
   * Passed in rather than queried here: the workspace owns `order_rfes` so
   * that sending an RFE can refetch it, and moving the query would break that.
   */
  quoteInputs?: React.ReactNode;
}) {
  const grid = useSavedQuerySingle('order_quote_grid', {
    input: { orderId },
    enabled: Boolean(orderId),
  });
  const roles = useSavedQuerySingle('pricing_template_editor');
  const overrides = useSavedQueryList('order_margin_overrides', {
    input: { orderId },
    enabled: Boolean(orderId),
  });
  const allocGrid = useSavedQuerySingle('order_allocation_grid', {
    input: { orderId },
    enabled: Boolean(orderId),
  });
  // The deal review itself — read back rather than held in state, so a reload
  // or a different operator sees the same chain position.
  const reviews = useSavedQueryList('order_reviews', {
    input: { orderId },
    enabled: Boolean(orderId),
  });
  const proposals = useSavedQueryList('order_proposals', {
    input: { orderId },
    enabled: Boolean(orderId),
  });

  /**
   * Margins are editable only while the workflow sits at Deal Review. Once the
   * signal has moved it on, the deal is the record the allocation was made
   * against — an editable box there would change a price nobody re-approved.
   */
  const readOnly = stateName !== null && stateName !== 'Deal Review';
  /**
   * The states the Quote stage owns. Anything else means the order has moved
   * PAST quoting, so all three steps are settled history — the chain must not
   * re-derive them from live quotes and report "current" on a step that was
   * completed days ago.
   */
  const QUOTE_STATES = [
    'Quote Requested',
    'Deal Review',
    'Deal Review Completed',
    'Allocation',
    'Allocation Completed',
    'Proposal',
    'Proposal Completed',
  ];
  const pastQuote = stateName !== null && !QUOTE_STATES.includes(stateName);
  /** Allocation is its own state, with its own signal wait in the workflow. */
  const atAllocation = stateName === 'Allocation';
  /** The Proposal state — the workflow's third and last wait in Quote. */
  const atProposal = stateName === 'Proposal';

  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // `awarded` still has no setter — the Proposal panel that wrote the award
  // record is not back yet.
  const [awarded] = useState(false);
  /**
   * orderLineId → supplierId, used only to override which quote the DEAL
   * prices against. The award split itself lives in AllocationPanel, because
   * an allocation is a quantity per supplier, not one supplier per line.
   */
  const [picks] = useState<Record<string, string>>({});
  /** The pending margin edit, held until a reason is given. */
  const [pendingMargin, setPendingMargin] = useState<{
    role: string;
    fromBps: number | null;
    toBps: number;
  } | null>(null);
  const [reason, setReason] = useState('');

  const result = grid.data as QuoteGridResult | null;
  // `pricing_template_editor` returns three lists: clients, roles, templates.
  // The roles carry only a bare template id, so the client match has to go
  // through templates — see templateFor.
  const roleRows = useMemo(
    () => ((roles.data as { roles?: PricingRole[] } | null)?.roles ?? []) as PricingRole[],
    [roles.data],
  );
  const templateRows = useMemo(
    () =>
      ((roles.data as { templates?: PricingTemplate[] } | null)?.templates ??
        []) as PricingTemplate[],
    [roles.data],
  );
  // Memoised — `?? []` is a new array each render, which would change every
  // downstream useMemo dependency on every pass.
  const overrideRows = useMemo(
    () => (overrides.data ?? []) as MarginOverrideRow[],
    [overrides.data],
  );

  /** Quotes reshaped into what buildDeal wants: one row per line, every
   *  supplier, each carrying its per-material costs. */
  const dealInput = useMemo(() => {
    const lines = quoteLines(result);
    const columns = quoteColumns(result, lines);
    const toMicros = (unit: number | null | undefined) =>
      unit === null || unit === undefined ? null : Math.round(unit * 1_000_000);

    return lines.map((l) => ({
      // The real demand order line — an allocation is keyed by it, so a
      // placeholder here silently posts an RFE id as an order line id.
      orderLineId: l.orderLineId ?? '',
      tierId: l.tierId,
      name: l.name,
      qty: l.qty,
      quotes: columns.map((c) => {
        const cell = c.cells[l.tierId];
        const byRole: Record<string, number | null> = {};
        for (const [role, unit] of Object.entries(cell?.byRole ?? {})) {
          byRole[role] = toMicros(unit);
        }
        return {
          supplierId: c.supplierId,
          supplierName: c.supplierName,
          unitCostMicros: toMicros(cell?.unitCost),
          byRole,
          declinedRoles: cell?.declinedRoles ?? [],
          // Without this a half-answered quote is the cheapest number on the
          // line, and wins the automatic pick every time.
          hasUncosted: cell?.hasUncosted ?? false,
        };
      }),
    }));
  }, [result]);

  /**
   * orderLineId → the committed quantity shares.
   *
   * `kind: 'line'` only. A carve-out is a MATERIAL moved to another supplier,
   * not a share of the line's quantity — folding one in here would weight the
   * blend by a quantity the line was never split into.
   */
  const committedShares = useMemo(() => {
    const raw = allocGrid.data as {
      allocations?: Array<{
        kind?: string;
        qty?: number;
        order_line_ref?: { id?: string };
        supplier?: { id?: string } | null;
      }>;
    } | null;
    const out: Record<string, CommittedShare[]> = {};
    for (const a of raw?.allocations ?? []) {
      if (a.kind !== 'line') continue;
      const line = a.order_line_ref?.id;
      const supplierId = a.supplier?.id;
      if (!line || !supplierId) continue;
      (out[line] ??= []).push({ supplierId, qty: asNumber(a.qty) ?? 0 });
    }
    return out;
  }, [allocGrid.data]);

  const deal = useMemo(
    () => buildDeal(dealInput, roleRows, templateRows, overrideRows, clientId, picks, committedShares),
    [dealInput, roleRows, templateRows, overrideRows, clientId, picks, committedShares],
  );

  /**
   * orderLineId → the suppliers a REAL allocation row names.
   *
   * This is the only thing that makes a line "awarded". Without it the table
   * badged the cheapest quote as awarded before anyone had allocated anything
   * — while the chain beside it still read "Allocation pending".
   */
  const allocatedBy = useMemo(() => {
    const raw = allocGrid.data as {
      allocations?: Array<{
        order_line_ref?: { id?: string };
        supplier?: { id?: string } | null;
      }>;
    } | null;
    const out: Record<string, string[]> = {};
    for (const a of raw?.allocations ?? []) {
      const line = a.order_line_ref?.id;
      const supplier = a.supplier?.id;
      if (line && supplier) (out[line] ??= []).push(supplier);
    }
    return out;
  }, [allocGrid.data]);

  /** The same deal seen supplier-first — every quote in, not just the awarded. */
  const supplierDeals = useMemo(
    () =>
      buildSupplierDeals(
        dealInput,
        roleRows,
        templateRows,
        overrideRows,
        clientId,
        picks,
        allocatedBy,
      ),
    [dealInput, roleRows, templateRows, overrideRows, clientId, picks, allocatedBy],
  );

  /**
   * orderLineId → already-allocated quantity.
   *
   * The link is projected as `order_line_ref`, not `order_line` — the entity
   * names it that way because the DynQL filter parser treats `order` as a
   * reserved word, the same reason `margin_override.order_ref` exists. Reading
   * the wrong key returns an empty map, which silently reads as "nothing
   * allocated" and leaves the chain stuck on Allocation.
   */
  const allocatedQty = useMemo(() => {
    const raw = allocGrid.data as {
      allocations?: Array<{ qty?: number; order_line_ref?: { id?: string } }>;
    } | null;
    const out: Record<string, number> = {};
    for (const a of raw?.allocations ?? []) {
      const id = a.order_line_ref?.id;
      if (id) out[id] = (out[id] ?? 0) + (a.qty ?? 0);
    }
    return out;
  }, [allocGrid.data]);


  /** Approved deal reviews, newest round first. */
  const dealReviews = useMemo(() => {
    const rows = (reviews.data ?? []) as Array<{
      review_kind?: string;
      status?: string;
      round?: number;
    }>;
    return rows.filter((r) => r.review_kind === 'deal_review');
  }, [reviews.data]);
  const dealReviewed = dealReviews.some((r) => r.status === 'approved');
  const nextRound = Math.max(0, ...dealReviews.map((r) => r.round ?? 0)) + 1;

  const states = pastQuote
    ? // Settled: the order left the Quote stage, which it can only do through
      // all three steps.
      ({ dealReview: 'approved', allocation: 'approved', proposal: 'approved' } as const)
    : chainStates({ deal, allocatedQty, awarded, dealReviewed });

  // Two levels of expander: supplier opens to its cards, a card opens to its
  // materials. Keyed separately so opening one supplier does not blow the
  // whole order open at four material rows per card.
  const supplierIds = useMemo(
    () => supplierDeals.suppliers.map((s) => s.supplierId),
    [supplierDeals],
  );
  const dealRows = useExpandedRows(supplierIds);
  // Card keys carry the supplier too — the same card appears under every
  // supplier that quoted it, and a bare tier id would open all of them at once.
  const dealCardIds = useMemo(
    () =>
      supplierDeals.suppliers.flatMap((s) => s.lines.map((l) => `${s.supplierId}-${l.tierId}`)),
    [supplierDeals],
  );
  const dealCards = useExpandedRows(dealCardIds);

  /**
   * Which chain block is expanded.
   *
   * Defaults to the LIVE step rather than a fixed one, and follows the
   * workflow when the state moves — landing on this page should put the work
   * in front of you, not make you hunt for it. `null` means "not chosen yet",
   * so an operator who opens Deal Review while allocating keeps it open
   * instead of having it snap shut on the next render.
   */
  const [openBlock, setOpenBlock] = useState<string | null>(null);
  const liveBlock = pastQuote
    ? ''
    : atProposal
      ? 'proposal'
      : atAllocation
        ? 'allocation'
        : 'deal';
  const blocks = useMemo(
    () => ({
      isOpen: (key: string) =>
        // 'quote' is the PARENT of the other three, so it follows the stage
        // rather than competing with its own children for the open slot:
        // open while the order is still quoting, and thereafter only if the
        // operator opens it to look back.
        key === 'quote'
          ? !pastQuote || openBlock === 'quote'
          : (openBlock ?? liveBlock) === key,
      toggleKey: (key: string) =>
        setOpenBlock((prev) => ((prev ?? liveBlock) === key ? '' : key)),
    }),
    [openBlock, liveBlock, pastQuote],
  );

  /** How many distinct suppliers currently hold a line — 2+ means a split. */
  const awardedSupplierCount = useMemo(
    () => new Set(deal.lines.map((l) => l.supplierId).filter(Boolean)).size,
    [deal.lines],
  );

  /** What the allocation panel needs: each line, its quotes, its default. */
  const allocationLines = useMemo(
    () =>
      deal.lines.map((l) => ({
        orderLineId: l.orderLineId,
        tierId: l.tierId,
        name: l.name,
        qty: l.qty,
        quotes:
          dealInput
            .find((d) => d.tierId === l.tierId)
            ?.quotes.filter((q) => q.unitCostMicros !== null)
            .map((q) => ({
              supplierId: q.supplierId,
              supplierName: q.supplierName,
              unitCostMicros: q.unitCostMicros,
              byRole: q.byRole,
              hasUncosted: q.hasUncosted,
            })) ?? [],
        suggestedSupplierId: l.supplierId,
      })),
    [deal.lines, dealInput],
  );

  /** Which supplier to take, and what a split would save. */
  const advice = useMemo(
    () =>
      recommendSuppliers(
        supplierDeals.suppliers,
        supplierDeals.floorBps,
        deal.totalCostMicros || null,
      ),
    [supplierDeals, deal.totalCostMicros],
  );

  /**
   * Expand all means ALL of it — suppliers and their cards.
   *
   * Toggling only the outer level would leave "Expand all" showing rows that
   * are themselves still collapsed, which reads as the button half-working.
   * Collapse is driven off the same combined state so the pair round-trips.
   */
  function toggleWholeDeal() {
    const openEverything = !(dealRows.allOpen && dealCards.allOpen);
    if (openEverything !== dealRows.allOpen) dealRows.toggleAll();
    if (openEverything !== dealCards.allOpen) dealCards.toggleAll();
  }

  /**
   * Why "Send to client" cannot fire yet, in the operator's words.
   *
   * A disabled control with no reason is indistinguishable from a broken one —
   * the blocker is usually two steps upstream (a supplier submitted no price,
   * or the client has no rate card), so the button has to say which.
   */
  /** Why the deal cannot be reviewed yet — the upstream half of the chain. */
  const reviewBlockedBecause: string | null = (() => {
    if (deal.lines.length === 0) return 'Nothing is out to bid yet.';
    if (deal.lines.every((l) => l.unitCostMicros === null))
      return 'No supplier has given a price. Their quotes came back with every line uncosted.';
    if (deal.lines.some((l) => l.missingMargin))
      return `No pricing template covers ${clientName ?? 'this client'}. Add a rate card on their client record.`;
    if (deal.anyBelowFloor)
      return `A line is below the ${pct(deal.floorBps)} margin floor — override it with a reason first.`;
    return null;
  })();

  const blockedBecause: string | null = (() => {
    if (awarded) return 'Already sent — the award record is written.';
    if (deal.lines.length === 0) return 'Nothing is out to bid yet.';
    if (deal.lines.every((l) => l.unitCostMicros === null))
      return 'No supplier has given a price. Their quotes came back with every line uncosted.';
    if (deal.lines.some((l) => l.missingMargin))
      return `No pricing template covers ${clientName ?? 'this client'}, so no sell price can be worked out. Add a rate card on their client record.`;
    if (deal.anyBelowFloor)
      return `A line is below the ${pct(deal.floorBps)} margin floor — override it with a reason first.`;
    if (!dealReviewed) return 'Review the deal and build the proposal first.';
    if (states.allocation !== 'approved') return 'Allocate every line to a supplier first.';
    return null;
  })();

  function onMarginTyped(role: string, value: string) {
    // Demo behaviour: clamp 0–60%, and only prompt when the number actually
    // moves off what is currently committed.
    const nextPct = Math.max(0, Math.min(60, Number(value.replace(/[^0-9]/g, '')) || 0));
    const current = marginForRole(deal, role).bps;
    if (current !== null && nextPct * 100 === current) return;
    setPendingMargin({ role, fromBps: current, toBps: nextPct * 100 });
    setReason('');
  }

  /**
   * Margin inputs live on every material row now, so the role rides on the
   * input's `data-role` rather than in a closure — one handler for all of
   * them instead of a fresh one per rendered row.
   */

  function onMarginBlur(event: React.FocusEvent<HTMLInputElement>) {
    const role = event.currentTarget.dataset.role;
    if (role) onMarginTyped(role, event.currentTarget.value);
  }

  async function commitMargin() {
    if (!pendingMargin) return;
    setBusy(true);
    setNote(null);
    try {
      await recordMarginOverride({
        orderId,
        componentRole: pendingMargin.role,
        marginBps: pendingMargin.toBps,
        fromBps: pendingMargin.fromBps,
        scenario: 'standard',
        reason: reason.trim(),
      });
      setPendingMargin(null);
      await overrides.refetch();
      setNote(`${pendingMargin.role} margin set to ${pct(pendingMargin.toBps)}.`);
    } catch (e) {
      setNote(`Could not save the override: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Record that the margins have been reviewed and the proposal can be built.
   *
   * The gate between "the numbers are in" and "a person accepted them" — see
   * `chainStates.dealReviewed` for why that is not derived.
   */
  /**
   * Write the award split.
   *
   * Replaces every allocation for the order rather than appending, so
   * re-allocating cannot leave a previous split half-standing alongside the
   * new one.
   */
  /**
   * Send the proposal: write the immutable award record, then signal.
   *
   * The award record is the domain model's frozen evidence of what was
   * proposed — written BEFORE the signal so the order cannot reach Award
   * with nothing recording why.
   */
  async function handleSendToClient(proposal: ProposalRow) {
    await writeAwardRecord({
      orderId,
      totalCostMicros: deal.totalCostMicros,
      snapshot: {
        proposal_id: proposal.id,
        proposal_version: proposal.version,
        pdf_file_id: proposal.pdf_file_id,
        lines: deal.lines.map((l) => ({
          order_line_id: l.orderLineId,
          name: l.name,
          qty: l.qty,
          supplier_id: l.supplierId,
          supplier_name: l.supplierName,
          unit_cost_micros: l.unitCostMicros,
          unit_sell_micros: l.unitSellMicros,
          materials: l.materials.map((m) => ({
            component_role: m.componentRole,
            unit_cost_micros: m.unitCostMicros,
            unit_sell_micros: m.unitSellMicros,
            margin_bps: m.marginBps,
          })),
        })),
        total_cost_micros: deal.totalCostMicros,
        total_sell_micros: deal.totalSellMicros,
        blended_bps: deal.blendedBps,
      },
    });
    await onProceed?.();
  }

  async function commitAllocation(
    rows: Array<{
      orderLineId: string;
      supplierId: string;
      qty: number;
      unitCostMicros: number | null;
      kind: 'line' | 'carve_out';
      componentRole: string | null;
      assemblerId: string | null;
    }>,
  ) {
    setBusy(true);
    setNote(null);
    try {
      const payload: AllocationInput[] = rows.map((r) => ({ orderId, ...r }));
      const n = await replaceAllocations(orderId, payload);
      await allocGrid.refetch();
      // Rows first, then the signal — the workflow is parked on
      // `waitforsignalnode_alloc_done`, and advancing it before the
      // allocations exist would record a completed allocation of nothing.
      await onProceed?.();
      const carves = rows.filter((r) => r.kind === 'carve_out').length;
      setNote(
        `${n} allocation${n === 1 ? '' : 's'} written${
          carves > 0 ? ` including ${carves} carve-out${carves === 1 ? '' : 's'}` : ''
        } — moving to proposal.`,
      );
    } catch (e) {
      setNote(`Could not allocate: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Pass the deal review — the demo's `passDeal`.
   *
   * Labelled "Proceed to allocation", not the demo's "Proceed to award": the
   * demo treated allocation and award as one step, whereas this workflow makes
   * them distinct states and the signal here lands on Allocation. Award comes
   * later, after the split is committed.
   *
   * Writes a `review_request` of kind deal_review plus an approving `verdict`,
   * THEN signals the workflow to advance. Order matters: if the write fails
   * nothing is signalled and the order stays at Quote, so the stage never
   * moves ahead of the evidence for it — the same rule Send-for-quotes uses.
   *
   * Those two rows are the gate `chainStates` reads to move Deal Review to
   * approved; the signal is what carries the order to Award, where allocation
   * happens.
   *
   * Deliberately not called "build proposal". In the demo that is a SEPARATE
   * action ("Price & build proposal", file-dollar icon) belonging to the
   * Proposal step, and it produces the client-facing document. Keeping one
   * name for both made this button claim to have created something it never
   * touched.
   */
  async function handleBuildProposal() {
    setBusy(true);
    setNote(null);
    try {
      await buildProposal({ orderId, round: nextRound });
      await reviews.refetch();
      // Only now advance. A failure above leaves the order at Quote.
      await onProceed?.();
      setNote('Deal reviewed — moving to award.');
    } catch (e) {
      setNote(`Could not record the deal review: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }



  if (grid.isLoading || roles.isLoading) return <Skeleton className="h-48 rounded-xl" />;


  /**
   * Status at the top, work at the bottom.
   *
   * The three chain cards are a progress READ — where the order is — and are
   * deliberately control-free: a 1/3-width card is the wrong place to price a
   * deal, and mixing "where am I" with "what do I do" made both harder to
   * scan. The work lives in the collapsible blocks directly below them.
   */

  const workbench = (
    /* Deal Review, Allocation and Proposal are STATES OF THE QUOTE STAGE —
       exactly how the `quote` function node models them, each written by
       tq_state_add and each parked on its own signal — so they nest inside
       Quote rather than sitting beside Award and Produce as if they were
       stages in their own right. */
    <ChainBlock
      title="Quote"
      state={pastQuote ? 'approved' : 'current'}
      summary={
        deal.blendedBps !== null
          ? `Sell ${money(deal.totalSellMicros)} · margin ${pct(deal.blendedBps)}`
          : 'Awaiting supplier quotes'
      }
      open={blocks.isOpen('quote')}
      onToggle={() => blocks.toggleKey('quote')}
    >
      <div className="flex flex-col gap-3" data-testid="deal-workbench">
      {/* No "Pricing and proposal" heading: these three blocks ARE deal
          review, allocation and proposal, which the Decision chain heading
          above already names. A second heading over the same three things
          read as a separate section and pushed the live step further down. */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={toggleWholeDeal}
          data-testid="toggle-all-deal-materials"
          className="text-[12px] font-semibold text-primary-600 hover:underline"
        >
          {dealRows.allOpen && dealCards.allOpen ? 'Collapse all' : 'Expand all'}
        </button>
      </div>

        {/* The three steps as STATUS CARDS — where this stage has got to,
            control-free. They live inside Quote because that is the stage they
            belong to; at page level they duplicated the block headers and read
            as the status of the whole order. */}
        <div className="grid gap-3 lg:grid-cols-3">
          <StepCard
            title="Deal Review"
            state={states.dealReview}
            detail={
              deal.anyBelowFloor
                ? `Below the ${pct(deal.floorBps)} floor — supplier orders blocked`
                : deal.blendedBps !== null
                  ? `Blended ${pct(deal.blendedBps)} · cost ${money(deal.totalCostMicros)} · sell ${money(deal.totalSellMicros)}`
                  : 'Awaiting supplier quotes'
            }
          />
          <StepCard
            title="Allocation"
            state={states.allocation}
            detail={
              states.dealReview !== 'approved'
                ? 'Awaiting deal review'
                : `${deal.lines.length} line${deal.lines.length === 1 ? '' : 's'} to award`
            }
          />
          <StepCard
            title="Proposal"
            state={states.proposal}
            detail={
              blockedBecause ?? `Sell ${money(deal.totalSellMicros)} · margin ${pct(deal.blendedBps)}`
            }
          />
        </div>

        <StepGroup title="Deal Review" state={states.dealReview}>
        {/* The quotes the margins are read off, above the deal they price. */}
        {quoteInputs}

      {/* Recommendation above the numbers, in the demo's suggestion purple
          (its --ai50/100/600 are byte-identical to this design system's
          purple-50/100/600, so tokens carry it — no lifted hex). */}
      {advice ? (
        <div
          className="flex gap-3 rounded-xl border border-purple-100 bg-purple-50 px-4 py-3"
          data-testid="deal-advice"
        >
          <i
            className="icon icon_-Tb_sparkles mt-0.5 text-[1.25rem] text-purple-600"
            aria-hidden="true"
          />
          <div className="flex flex-col gap-1">
            <p className="text-[13px] font-bold text-purple-600">{advice.headline}</p>
            {advice.detail ? (
              <p className="text-[12.5px] text-foreground/80">{advice.detail}</p>
            ) : null}
            {advice.warning ? (
              <p className="text-[12.5px] font-semibold text-warning-700">{advice.warning}</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* ── The deal, supplier by supplier ───────────────────────
          Grouped by SUPPLIER, then card, then material, because that is the
          question a deal review asks: what is each supplier offering, and
          what would we make on it. The card-first view could not show that,
          and could not show a split across suppliers at all.

          Margins are edited HERE, on the material row where the number is
          read, rather than in a separate panel — an input far from the figure
          it changes is how a margin gets set against the wrong line. */}
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full border-collapse text-left" data-testid="deal-breakdown">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
              <th className="px-3 py-2">Supplier · card · material</th>
              <th className="px-3 py-2 text-right">Unit cost</th>
              <th className="px-3 py-2 text-right">Margin</th>
              <th className="px-3 py-2 text-right">Unit sell</th>
              <th className="px-3 py-2 text-right">Ext. cost</th>
              <th className="px-3 py-2 text-right">Ext. sell</th>
              <th className="px-3 py-2 text-right">Profit</th>
            </tr>
          </thead>
          <tbody>
            {supplierDeals.suppliers.map((sup, supIndex) => {
              const open = dealRows.isOpen(sup.supplierId);
              return (
                <Fragment key={sup.supplierId}>
                  <tr
                    className="border-b border-border bg-muted/30"
                    data-testid={`deal-supplier-${sup.supplierName}`}
                  >
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        data-row={sup.supplierId}
                        onClick={dealRows.toggle}
                        aria-expanded={open}
                        aria-label={`${open ? 'Hide' : 'Show'} ${sup.supplierName} breakdown`}
                        data-testid={`toggle-supplier-${sup.supplierName}`}
                        className="flex w-full items-center gap-2 text-left"
                      >
                        <i
                          className={`icon icon_-Tb_chevron_right text-[1.125rem] text-muted-foreground transition-transform ${
                            open ? 'rotate-90' : ''
                          }`}
                          aria-hidden="true"
                        />
                        <span>
                          <span className="block text-[13.5px] font-bold text-foreground">
                            {sup.supplierName}
                            {/* Cheapest COMPLETE quote, so the recommendation
                                cannot be won by a supplier who simply left
                                materials blank. */}
                            {supIndex === 0 && sup.complete ? (
                              <span className="ml-2 rounded-full bg-success-50 px-2 py-0.5 text-[10px] font-bold uppercase text-success-500">
                                Lowest
                              </span>
                            ) : null}
                            {sup.awardedLines > 0 ? (
                              <span className="ml-2 rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-bold uppercase text-teal-700">
                                {sup.awardedLines} awarded
                              </span>
                            ) : null}
                            {/* No "suggested" badge: LOWEST already says this
                                supplier is the default, and a second badge
                                saying the same thing is noise. `suggested`
                                stays in the data so the distinction from
                                `awarded` survives. */}
                            {!sup.complete ? (
                              <span className="ml-2 rounded-full bg-warning-50 px-2 py-0.5 text-[10px] font-bold uppercase text-warning-700">
                                Partial
                              </span>
                            ) : null}
                          </span>
                          <span className="block text-[11.5px] text-muted-foreground">
                            {sup.lines.length} card{sup.lines.length === 1 ? '' : 's'} quoted
                          </span>
                        </span>
                      </button>
                    </td>
                    {/* A supplier has no unit price — it is an aggregate of
                        several cards — so the unit columns stay empty rather
                        than showing an order total under a "unit" header. */}
                    <td className="px-3 py-2" />
                    <td
                      className={`px-3 py-2 text-right text-[13px] font-semibold tabular-nums ${
                        sup.belowFloor ? 'text-destructive' : 'text-foreground'
                      }`}
                    >
                      {pct(sup.blendedBps)}
                    </td>
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2 text-right text-[13px] font-semibold tabular-nums text-foreground">
                      {money(sup.totalCostMicros)}
                    </td>
                    <td className="px-3 py-2 text-right text-[13px] font-semibold tabular-nums text-foreground">
                      {money(sup.totalSellMicros)}
                    </td>
                    <td className="px-3 py-2 text-right text-[13px] font-semibold tabular-nums text-foreground">
                      {money(sup.profitMicros)}
                    </td>
                  </tr>

                  {open
                    ? sup.lines.map((l) => {
                        const cardKey = `${sup.supplierId}-${l.tierId}`;
                        const cardOpen = dealCards.isOpen(cardKey);
                        return (
                        <Fragment key={cardKey}>
                          <tr
                            className="border-b border-border bg-muted/10"
                            data-testid={`deal-line-${sup.supplierName}-${l.name}`}
                          >
                            <td className="py-1.5 pl-8 pr-3 text-[12.5px]">
                              <button
                                type="button"
                                data-row={cardKey}
                                onClick={dealCards.toggle}
                                aria-expanded={cardOpen}
                                aria-label={`${cardOpen ? 'Hide' : 'Show'} ${l.name} materials from ${sup.supplierName}`}
                                data-testid={`toggle-deal-card-${sup.supplierName}-${l.name}`}
                                className="flex w-full items-center gap-2 text-left"
                              >
                                <i
                                  className={`icon icon_-Tb_chevron_right text-[1rem] text-muted-foreground transition-transform ${
                                    cardOpen ? 'rotate-90' : ''
                                  }`}
                                  aria-hidden="true"
                                />
                                <span className="font-semibold text-foreground">
                                  {l.name}
                                  <span className="ml-1.5 font-normal text-muted-foreground">
                                    {l.qty.toLocaleString()} units · {l.materials.length} materials
                                  </span>
                                  {l.awarded ? (
                                    <span className="ml-1.5 text-[11px] font-bold uppercase text-teal-700">
                                      awarded
                                    </span>
                                  ) : null}
                                  {l.hasUncosted ? (
                                    <span className="ml-1.5 text-[11px] font-bold uppercase text-warning-700">
                                      partial
                                    </span>
                                  ) : null}
                                </span>
                              </button>
                            </td>
                            <td className="py-1.5 px-3 text-right text-[12.5px] tabular-nums text-foreground">
                              {unitMoney(l.unitCostMicros)}
                            </td>
                            <td
                              className={`py-1.5 px-3 text-right text-[12.5px] tabular-nums ${
                                l.belowFloor ? 'text-destructive' : 'text-foreground'
                              }`}
                            >
                              {pct(l.realisedBps)}
                            </td>
                            <td className="py-1.5 px-3 text-right text-[12.5px] tabular-nums text-foreground">
                              {unitMoney(l.unitSellMicros)}
                            </td>
                            <td className="py-1.5 px-3 text-right text-[12.5px] tabular-nums text-muted-foreground">
                              {money(l.extendedCostMicros)}
                            </td>
                            <td className="py-1.5 px-3 text-right text-[12.5px] tabular-nums text-foreground">
                              {money(l.extendedSellMicros)}
                            </td>
                            <td className="py-1.5 px-3 text-right text-[12.5px] tabular-nums text-muted-foreground">
                              {l.extendedSellMicros === null || l.extendedCostMicros === null
                                ? '—'
                                : money(l.extendedSellMicros - l.extendedCostMicros)}
                            </td>
                          </tr>

                          {(cardOpen ? l.materials : []).map((m) => (
                            <tr
                              key={`${sup.supplierId}-${l.tierId}-${m.componentRole}`}
                              className="border-b border-border text-[12.5px] text-muted-foreground last:border-b-0"
                              data-testid={`deal-material-${sup.supplierName}-${l.name}-${m.componentRole}`}
                            >
                              <td className="py-1 pl-12 pr-3">
                                {componentLabel(m.componentRole)}
                              </td>
                              <td className="py-1 px-3 text-right tabular-nums">
                                {m.declined ? 'Declined' : unitMoney(m.unitCostMicros)}
                              </td>
                              <td className="py-1 px-3 text-right">
                                {m.declined ? (
                                  '—'
                                ) : readOnly ? (
                                  /* Past Quote the deal is a RECORD of what was
                                     decided. An editable box would invite a
                                     change that no longer has a gate to pass. */
                                  <span className="tabular-nums">{pct(m.marginBps)}</span>
                                ) : (
                                  <span className="inline-flex items-center gap-1">
                                    <Input
                                      id={`margin-${sup.supplierId}-${l.tierId}-${m.componentRole}`}
                                      name={`margin-${m.componentRole}`}
                                      data-testid={`margin-input-${sup.supplierName}-${l.name}-${m.componentRole}`}
                                      className="h-7 w-[3.5rem] text-right text-[12.5px]"
                                      inputMode="numeric"
                                      // Keyed by the rate so a change made on
                                      // another row re-renders this one with
                                      // the new value — the rate is order-wide.
                                      key={`${m.componentRole}-${m.marginBps ?? 'none'}`}
                                      defaultValue={
                                        m.marginBps !== null ? String(m.marginBps / 100) : ''
                                      }
                                      onBlur={onMarginBlur}
                                      data-role={m.componentRole}
                                      aria-label={`${componentLabel(m.componentRole)} margin`}
                                    />
                                    <span className="text-[11px]">
                                      {m.marginSource === 'override' ? 'over' : '%'}
                                    </span>
                                  </span>
                                )}
                              </td>
                              <td className="py-1 px-3 text-right tabular-nums">
                                {m.declined ? '—' : unitMoney(m.unitSellMicros)}
                              </td>
                              <td className="py-1 px-3 text-right tabular-nums">
                                {m.declined || m.unitCostMicros === null
                                  ? '—'
                                  : money(m.unitCostMicros * l.qty)}
                              </td>
                              <td className="py-1 px-3 text-right tabular-nums">
                                {m.declined || m.unitSellMicros === null
                                  ? '—'
                                  : money(m.unitSellMicros * l.qty)}
                              </td>
                              <td className="py-1 px-3 text-right tabular-nums">
                                {m.declined || m.unitSellMicros === null || m.unitCostMicros === null
                                  ? '—'
                                  : money((m.unitSellMicros - m.unitCostMicros) * l.qty)}
                              </td>
                            </tr>
                          ))}
                        </Fragment>
                        );
                      })
                    : null}
                </Fragment>
              );
            })}

            {/* What the ORDER costs, across however many suppliers hold it.
                When every line sits with one supplier this repeats that
                supplier's row — but it is the only line that stays correct
                once the award is split, and it is the figure the proposal is
                built from, so it is labelled by its job rather than dropped. */}
            <tr className="border-t-2 border-border bg-muted/50 font-semibold">
              <td className="px-3 py-2">
                <span className="block text-[12px] uppercase tracking-[0.06em] text-muted-foreground">
                  Awarded — this order
                </span>
                <span className="block text-[11px] font-normal text-muted-foreground">
                  {awardedSupplierCount === 0
                    ? 'nothing awarded yet'
                    : awardedSupplierCount === 1
                      ? 'one supplier'
                      : `split across ${awardedSupplierCount} suppliers`}
                </span>
              </td>
              <td className="px-3 py-2" />
              <td
                className={`px-3 py-2 text-right text-[13px] tabular-nums ${
                  deal.anyBelowFloor ? 'text-destructive' : 'text-foreground'
                }`}
              >
                {pct(deal.blendedBps)}
              </td>
              <td className="px-3 py-2" />
              <td className="px-3 py-2 text-right text-[13px] tabular-nums text-foreground">
                {money(deal.totalCostMicros)}
              </td>
              <td className="px-3 py-2 text-right text-[13px] tabular-nums text-foreground">
                {money(deal.totalSellMicros)}
              </td>
              <td className="px-3 py-2 text-right text-[13px] tabular-nums text-foreground">
                {money(deal.totalSellMicros - deal.totalCostMicros)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Margins are order-wide per material — `margin_override` carries a
          component_role and an order, and no line — so this is the truth
          rather than a limitation to hide behind a per-row input. */}
      {readOnly ? null : (
        <p className="text-[11.5px] text-muted-foreground">
          A margin applies to that material across the whole order, so changing it
          on one row changes every row for the same material.
        </p>
      )}

      {/* The decision on the whole deal, so it sits in the main content under
          the numbers it is a verdict on — not inside one of the panels. */}
      {/* The gate lives at Quote. Past it the deal is settled, so the button
          would either re-fire a signal or sit permanently disabled. */}
      <div
        className={`flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 ${
          readOnly ? 'hidden' : 'flex'
        }`}
      >
        {dealReviewed ? (
          <p className="text-[13px] font-semibold text-success-600" data-testid="deal-reviewed">
            <i className="icon icon_-Tb_circle_check mr-1.5" aria-hidden="true" />
            Deal reviewed — allocation unlocked.
          </p>
        ) : (
          <>
            <Button
              data-testid="proceed-to-allocation"
              onClick={handleBuildProposal}
              aria-busy={busy}
              disabled={busy || Boolean(reviewBlockedBecause)}
              title={reviewBlockedBecause ?? 'Accept these margins and unlock allocation'}
            >
              <i className="icon icon_-Tb_circle_check" aria-hidden="true" />
              Proceed to allocation
            </Button>
            <span className="text-[12.5px] text-muted-foreground">
              {reviewBlockedBecause ??
                `Accept these margins for all ${deal.lines.length} line${
                  deal.lines.length === 1 ? '' : 's'
                } and move to allocation.`}
            </span>
          </>
        )}
      </div>

        </StepGroup>

        <StepGroup title="Allocation" state={states.allocation}>
          {/* Editable at that state, a record of the split afterwards. */}
          {atAllocation ? (
            <AllocationPanel lines={allocationLines} busy={busy} onAllocate={commitAllocation} />
          ) : states.allocation === 'approved' ? (
            <AllocationSummaryView orderId={orderId} lines={deal.lines} />
          ) : (
            <p className="text-[12.5px] text-muted-foreground">
              The award split is made here once the deal review passes.
            </p>
          )}
        </StepGroup>

        <StepGroup title="Proposal" state={states.proposal}>
        {/* Shown once a proposal EXISTS, not only while the step is live: past
            it, this is the record of what the client was sent, and the stored
            PDF is exactly what they received. Read-only there, so nothing can
            build or send a second one outside the change-order flow. */}
        {atProposal || (proposals.data ?? []).length > 0 ? (
          <ProposalPanel
            readOnly={!atProposal}
            orderId={orderId}
            orderNo={orderNo}
            clientName={clientName}
            requestedDelivery={requestedDelivery}
            deal={deal}
            proposals={(proposals.data ?? []) as ProposalRow[]}
            busy={busy}
            onChanged={async () => {
              await proposals.refetch();
            }}
            onSendToClient={handleSendToClient}
          />
        ) : (
          <p className="text-[12.5px] text-muted-foreground">
            The client document is built here once the award split is committed.
          </p>
        )}
        </StepGroup>

        {/* The dates the client is agreeing to, alongside the price they are
            agreeing to. The plan is drawn from the delivery date BEFORE a
            supplier is chosen, which is exactly what makes it a quoting step:
            the proposal commits to both. It keeps stamping itself long after
            Quote closes, so this section stays reachable from the collapsed
            block for the rest of the order. */}
        <PlanPanel
          orderId={orderId}
          clientId={clientId}
          clientName={clientName}
          requestedDelivery={requestedDelivery ?? null}
        />

      {note ? <p className="text-[12.5px] text-muted-foreground">{note}</p> : null}
      </div>
    </ChainBlock>
  );

  return (
    <>
      {workbench}

      {/* A margin change never commits without a reason — the demo's rule and
          margin_override's own mandatory column. */}
      <Dialog open={Boolean(pendingMargin)} onOpenChange={(o) => (o ? null : setPendingMargin(null))}>
        <DialogContent className="sm:max-w-[26rem]" data-testid="margin-reason-dialog">
          <DialogHeader>
            <DialogTitle>Why this margin?</DialogTitle>
            <DialogDescription>
              {pendingMargin
                ? `${pendingMargin.role} ${pct(pendingMargin.fromBps)} → ${pct(pendingMargin.toBps)}. An override cannot be saved without a reason.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="margin-reason">Reason</Label>
              <Input
                id="margin-reason"
                name="marginReason"
                data-testid="margin-reason-input"
                value={reason}
                placeholder="Volume commitment for Q4"
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <Button
                data-testid="confirm-margin"
                onClick={commitMargin}
                aria-busy={busy}
                disabled={busy || !reason.trim()}
              >
                Save override
              </Button>
              <Button variant="outline" onClick={() => setPendingMargin(null)} disabled={busy}>
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default DecisionChain;
