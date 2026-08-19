/**
 * Order workspace — the full 9-stage layout for one order.
 *
 * Structure follows the demo's workspace, top to bottom:
 *   header (code · buyer · target · stage badge)
 *   lifecycle strip (9 stages)
 *   the CURRENT stage's panel — Quote renders its Decision chain; every other
 *     stage renders a scaffolded panel marked "Coming soon"
 *   advance control (signals the workflow)
 *
 * Only the Quote decision chain is wired to real state so far; the remaining
 * stage panels are laid out but marked "Coming soon" deliberately, so the
 * shape of the page is reviewable before each stage gets built out.
 */
import { useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useSavedQueryList, useSavedQuerySingle } from '@/hooks';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { StageStrip } from './StageStrip';
import { SpecificationPanel } from './SpecificationPanel';
import {
  currentPosition,
  fetchStatusHistory,
  closeOrder,
  sendStageResponse,
  type StatusHistoryEntry,
} from './order-api';
import { decorateStages, type StageDefinition } from './stage-helpers';
import { PAGE_CONTAINER } from '@/pages/page-shell';
import { advanceNote } from '@/pages/_shared/advance-feedback';
import { describeAdvanceFailure } from '@/pages/_shared/signal-errors';
import { SendForQuotesDialog } from './SendForQuotesDialog';
import { RfeTable, type OrderRfeRow } from './RfeTable';
import { CardSummary } from './CardSummary';
import { QuoteGrid } from './QuoteGrid';
import { DecisionChain } from './DecisionChain';
import { FulfilmentPanel } from './FulfilmentPanel';

interface OrderDetailRow {
  id?: string;
  order_code?: string;
  order_brief?: string;
  order_kind?: string;
  order_type?: string;
  requested_delivery?: string;
  created_at?: string;
  created_by?: { id?: string; full_name?: string };
  buyer_party_id?: { id?: string; name?: string };
  tq_instance?: { id?: string };
}

/** Per-stage panel scaffolding — what each stage will own once built. */
const STAGE_PANELS: Record<string, { icon: string; title: string; body: string }> = {
  Order: {
    icon: 'icon_-Tb_file_text',
    title: 'Order intake',
    body: 'The brief, buyer and requested delivery captured at intake.',
  },
  Specs: {
    icon: 'icon_-Tb_credit_card',
    title: 'Card specification',
    body: 'Card body, printing, finish, carrier and artwork — the spec the suppliers quote against.',
  },
  Quote: {
    icon: 'icon_-Tb_file_dollar',
    title: 'Quote',
    body: 'RFEs out, supplier responses in, and the decision chain below.',
  },
  Award: {
    icon: 'icon_-Tb_award',
    title: 'Award',
    body: 'Allocate quantity per line to suppliers and raise the supplier orders.',
  },
  Produce: {
    icon: 'icon_-Tb_package',
    title: 'Production',
    body: 'Supplier orders in production, with per-line progress.',
  },
  Proof: {
    icon: 'icon_-Tb_eye',
    title: 'Proofing',
    body: 'Art, data and affixing proofs through CS review and client sign-off.',
  },
  Ship: {
    icon: 'icon_-Tb_truck',
    title: 'Shipping',
    body: 'Destinations, tracking and delivery against the shipping requirements.',
  },
  Bill: {
    icon: 'icon_-Tb_receipt',
    title: 'Billing',
    body: 'Expenses, invoice reconciliation and what flows to Ledger.',
  },
  'Order Close': {
    icon: 'icon_-Tb_circle_check',
    title: 'Order close',
    body: 'Final confirmation that every stage is settled and the order can close.',
  },
};

function ComingSoon() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
      <i className="icon icon_-Tb_clock text-[12px]" aria-hidden="true" />
      Coming soon
    </span>
  );
}

export function OrderWorkspacePage() {
  const { orderId = '' } = useParams();
  const queryClient = useQueryClient();
  const [signalBusy, setSignalBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Held in state, not a ref: the child only renders its portal once this node
  // exists, and a ref assignment wouldn't re-render to tell it.
  const [specHeaderSlot, setSpecHeaderSlot] = useState<HTMLElement | null>(null);
  const [quotesOpen, setQuotesOpen] = useState(false);
  /** True when the send came from Specs, where finishing it advances the
   *  stage. False when sent from Quote, which is already there. */
  const [advanceOnSent, setAdvanceOnSent] = useState(true);

  const [signalNote, setSignalNote] = useState<string | null>(null);

  const detail = useSavedQuerySingle('order_detail', {
    input: { orderId },
    enabled: Boolean(orderId),
  });
  const order = (detail.data ?? null) as OrderDetailRow | null;
  const instanceId = order?.tq_instance?.id ?? '';

  const stageList = useSavedQueryList('tq_stage_list');
  const stageRows = (stageList.data ?? []) as StageDefinition[];

  const history = useSavedQueryList('tq_status_history', {
    input: { instanceId },
    enabled: Boolean(instanceId),
  });
  const historyRows = (history.data ?? []) as StatusHistoryEntry[];

  // Owned here, not inside RfeTable, so a send can refetch it — see RfeTable.
  const rfes = useSavedQueryList('order_rfes', {
    input: { orderId },
    enabled: Boolean(orderId),
  });
  const rfeRows = (rfes.data ?? []) as OrderRfeRow[];
  const { stage: currentStageName, state: currentStateName } =
    currentPosition(historyRows);

  /**
   * The STATE is passed, not just the stage.
   *
   * Without it `decorateStages` can never finish the last step: every other
   * stage is shown done by the order having moved past it, and nothing follows
   * Order Close to push it into the past. A filed order kept a gold
   * in-progress pip on the one step that had actually completed. The helper
   * was written to read `is_final` off the stage's own states — `Closed` on
   * Order Close — and only needed telling which state the order is in.
   */
  /**
   * The stages the order actually entered, straight off its state trail.
   *
   * Passed so the strip greys out what never happened: `Expired` sits outside
   * the linear chain and renders last, so position alone would mark every
   * earlier stage finished on an order that expired at Specs.
   */
  const visitedStages = useMemo(
    () =>
      historyRows
        .map((r) => r.tq_sub_task_instance?.tq_sub_task_definition?.name)
        .filter((name): name is string => Boolean(name)),
    [historyRows],
  );

  const stages = useMemo(
    () => decorateStages(stageRows, currentStageName, currentStateName, visitedStages),
    [stageRows, currentStageName, currentStateName, visitedStages],
  );

  const panel = currentStageName ? STAGE_PANELS[currentStageName] : undefined;
  const isQuote = currentStageName === 'Quote';
  // The specification IS the Specs stage, so it renders in place rather than
  // behind a link to a separate destination.
  const isSpecs = currentStageName === 'Specs';
  /**
   * Award onward: supplier orders, production, proofs, shipping, billing —
   * and Order Close, which has no panel of its own but must still SHOW the
   * chain. Omitting it made every block vanish the moment an order finished,
   * exactly when the completed record matters most.
   */
  const FULFILMENT_STAGES = ['Award', 'Produce', 'Proof', 'Ship', 'Bill', 'Order Close'];
  const isFulfilment = FULFILMENT_STAGES.includes(currentStageName ?? '');
  /**
   * The end of the line — the workflow has no further wait to signal, so no
   * stage card offers to advance past it.
   */
  const isClosed = currentStageName === 'Order Close';


  /**
   * Refresh everything the page is currently showing.
   *
   * Not just the stage history. A supplier submitting a quote changes data
   * this page owns no handle on — the quote grid, the RFE statuses and the
   * decision chain each run their own saved query inside their own component
   * — so refetching only `history` left the operator looking at a stale
   * comparison table and no way to update it short of a browser reload.
   *
   * `invalidateQueries()` with no filter is deliberate over threading a
   * refetch callback down through every panel: React Query refetches the
   * queries that are MOUNTED, and only the current stage's panel is mounted,
   * so this already means "fetch the latest for whatever stage we are on".
   * It also cannot be forgotten the next time a panel is added, which is
   * exactly how the quote grid came to be missed here.
   *
   * The in-flight flag is tracked here rather than read off the hook:
   * `useSavedQueryList` exposes only `isLoading`, which React Query sets on
   * the FIRST load and not on a refetch — so binding the spinner to it meant
   * the button never showed it was doing anything.
   */
  async function handleRefreshProgress() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      // Awaited together so the spinner runs until the slowest one settles,
      // rather than clearing while the table is still loading.
      await Promise.all([history.refetch(), queryClient.invalidateQueries()]);
    } finally {
      setRefreshing(false);
    }
  }

  /**
   * Advance the workflow.
   *
   * At Specs this is NOT the entry point — Send for quotes opens its dialog
   * first, writes the RFEs, and only then calls this. The signal means "the
   * RFEs exist, move on", never "please create them", so nothing here writes
   * business data.
   */
  async function handleAdvance() {
    if (!instanceId) return;
    setSignalBusy(true);
    setSignalNote(null);
    try {
      await sendStageResponse(instanceId);
      const before = currentStateName;
      let moved = false;
      for (let attempt = 0; attempt < 5 && !moved; attempt += 1) {
        await new Promise((r) => setTimeout(r, 600));
        const rows = await fetchStatusHistory(instanceId);
        moved = currentPosition(rows).state !== before;
      }
      history.refetch();
      /**
       * Only the outcomes that need a human report anything.
       *
       * A successful advance is already on screen — the stage strip moves and
       * the blocks re-render — so saying so as well was noise. A signal that
       * changed nothing, or failed, has no visible trace, so it is written
       * beside the strip where it stays until the next attempt.
       *
       * `before` — the state we tried to leave — decides the wording. A
       * guarded stage did not move BECAUSE the counterparty has not acted
       * yet, and telling that person to refresh sends them round a loop that
       * cannot end. See `advance-feedback.ts`.
       */
      setSignalNote(advanceNote(before, moved));
    } catch (e) {
      setSignalNote(describeAdvanceFailure(e));
    } finally {
      setSignalBusy(false);
    }
  }

  /**
   * File the order — `Closing` → `Closed`.
   *
   * Deliberately NOT `handleAdvance`. The workflow run ends before the order
   * reaches Order Close, so signalling returns ERROR_SIGNAL_NO_ACTIVE_WORKFLOW;
   * the state is written directly instead. The status the whole app reads is
   * `tq_instance.current_status`, which is exactly what `closeOrder` moves —
   * `orders.status` has been stale since creation and is nobody's source.
   */
  async function handleClose() {
    if (!instanceId) return;
    setSignalBusy(true);
    setSignalNote(null);
    try {
      await closeOrder(instanceId);
      await history.refetch();
    } catch (e) {
      setSignalNote(`Could not close: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSignalBusy(false);
    }
  }

  if (detail.isLoading) {
    return (
      <div className={PAGE_CONTAINER}>
        <Skeleton className="mb-4 h-10 w-64" />
        <Skeleton className="h-16 rounded-xl" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className={PAGE_CONTAINER}>
        <h1 className="text-[21px] font-bold text-foreground">Order not found</h1>
        <p className="mt-2 text-[15px] text-muted-foreground">
          No order matches this id.{' '}
          <Link to="/today" className="text-primary-600 underline">
            Back to Today
          </Link>
        </p>
      </div>
    );
  }

  return (
    /**
     * Fixed identity, scrolling work.
     *
     * The root is exactly `<main>`'s height (`h-full`), so `<main>` itself
     * never overflows and there is only ever ONE scrollbar — the inner one.
     * Sizing the page to the viewport instead would double-count it and leave
     * a trailing band plus a second scrollbar.
     *
     * Everything down to the progress strip is `shrink-0` and stays put; the
     * stage panel below scrolls, so which order this is and where it has got
     * to remain on screen while the operator works down the card studio.
     */
    <div
      className="flex h-full min-h-0 w-full flex-col px-7 pt-8"
      data-testid="order-workspace-page"
    >
      <div className="shrink-0">
      {/* ── Breadcrumb ───────────────────────────────────────────── */}
      <Breadcrumb className="mb-3">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/today">Today</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{order.order_code ?? 'Order'}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="mb-1 text-[13px] font-semibold tracking-[0.02em] text-teal-700">
        {order.buyer_party_id?.name ?? 'Order'}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[28px] font-extrabold tracking-[-0.02em] text-foreground">
          {order.order_code ?? '—'}
        </h1>
        {currentStateName ? (
          <span className="inline-flex items-center rounded-full border border-teal-200 bg-teal-50 px-2.5 py-0.5 text-[12.5px] font-semibold text-teal-700">
            {currentStateName}
          </span>
        ) : null}
      </div>
      <p className="mb-5 mt-1 text-[15px] leading-relaxed text-muted-foreground">
        {order.order_brief?.trim() || 'No brief captured.'}
        {order.requested_delivery ? ` · Target ${order.requested_delivery}` : ''}
      </p>

      {/* ── Lifecycle ────────────────────────────────────────────── */}
      {stageList.isLoading ? (
        <Skeleton className="h-14 rounded-xl" />
      ) : (
        <StageStrip
          stages={stages}
          action={
            <div className="flex items-center gap-2">
            {signalNote ? (
              <span
                className="max-w-[26rem] text-right text-[11.5px] text-destructive"
                role="alert"
                data-testid="signal-note"
              >
                {signalNote}
              </span>
            ) : null}
            {/* Only Refresh here. The advance belongs to the STAGE, so it
                lives on that stage's own card beside the work it is
                signalling complete — one control per step, where the operator
                is already looking, rather than a page-level button that acted
                on whichever stage happened to be live. */}
            <button
              type="button"
              className="inline-flex size-8 items-center justify-center rounded-md text-primary-600 transition-colors hover:bg-primary-50 disabled:opacity-35 disabled:hover:bg-transparent"
              aria-label="Refresh order progress"
              data-testid="refresh-progress"
              title="Refresh progress and the current stage's data"
              aria-busy={refreshing}
              onClick={() => void handleRefreshProgress()}
              disabled={refreshing}
            >
              <i
                className={`icon icon_-Tb_refresh text-[18px] ${
                  refreshing ? 'animate-spin' : ''
                }`}
                aria-hidden="true"
              />
            </button>
            </div>
          }
        />
      )}
      </div>

      {/* ── Scrolling work area ──────────────────────────────────────
          The `mt-4` is a permanent gutter, NOT spacing on the first child:
          the container clips at its own top edge, so the gap survives being
          scrolled. Put on the panel instead, it would scroll away and the
          content would run flush into the progress strip. */}
      <div className="mt-4 min-h-0 flex-1 overflow-y-auto pb-8">
      {/* ── What is being made ───────────────────────────────────────
          Above the stage panel, not inside it. The cards are a property of
          the ORDER, not of whichever stage it happens to be sitting in —
          they stay true from Specs through to Close — so they read as
          standing context rather than as part of this stage's work. */}
      <CardSummary orderId={orderId} />

      {/* ── The order's progress ─────────────────────────────────────
          Above the stage panel, and outside it. Nested inside, the panel's
          header named one stage ("Production") while the body held all eight
          steps, so Award, Proof, Ship and Bill read as things that live under
          Produce. They are peers, the ones already done stay readable instead
          of vanishing when the order moves on, and the whole chain is the
          first thing on the page rather than something to scroll for. */}
      {isQuote || isFulfilment ? (
        <div className="mb-4">
          {/* No heading: the blocks are named for the stages themselves, and
              the strip above already says where the order is. A label over
              them only repeated that. */}
          <div className="flex flex-col gap-3">
            <DecisionChain
              orderId={orderId}
              clientId={order.buyer_party_id?.id ?? null}
              clientName={order.buyer_party_id?.name ?? null}
              orderNo={order.order_code ?? ''}
              requestedDelivery={order.requested_delivery ?? null}
              onProceed={handleAdvance}
              stateName={currentStateName}
              quoteInputs={
                isQuote ? (
                  <>
                    <RfeTable rows={rfeRows} loading={rfes.isLoading} />
                    <QuoteGrid orderId={orderId} />
                    {/* NOT a second "send for quotes" — the details already
                        went out at Specs. This adds a supplier to a round
                        that is already open, so it does not advance the
                        stage. */}
                    <Button
                      size="sm"
                      variant="outline"
                      className="self-start"
                      data-testid="send-rfe-quote"
                      title="Send this order's RFE to a supplier who wasn't included at Specs"
                      onClick={() => {
                        setAdvanceOnSent(false);
                        setQuotesOpen(true);
                      }}
                    >
                      <i className="icon icon_-Tb_circle_plus" aria-hidden="true" />
                      Add another supplier
                    </Button>
                  </>
                ) : (
                  // Past Quote the comparison is history; the deal table in
                  // the block already records what was chosen and why.
                  null
                )
              }
            />
            <FulfilmentPanel
              orderId={orderId}
              orderCode={order.order_code ?? ''}
              requestedDelivery={order.requested_delivery ?? null}
              stage={currentStageName ?? ''}
              clientId={order.buyer_party_id?.id ?? null}
              clientName={order.buyer_party_id?.name ?? null}
              // At Order Close the run has finished: a signal there can only
              // return ERROR_SIGNAL_NO_ACTIVE_WORKFLOW, so no card offers one.
              // Filing is a state write instead — see `handleClose`.
              onProceed={isClosed ? undefined : handleAdvance}
              stateName={currentStateName}
              onClose={isClosed ? handleClose : undefined}
            />
          </div>
        </div>
      ) : null}

      {/* ── Current stage panel ──────────────────────────────────────
          Only where it still carries something: Specs hosts the card studio,
          and the stages with no panel yet show "Coming soon". At Quote and the
          fulfilment stages the chain blocks above ARE the content, so a card
          whose header just repeated the stage name was pure duplication. */}
      {panel && !isQuote && !isFulfilment ? (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex items-center gap-2.5 border-b border-border px-4 py-3.5">
            <i className={`icon ${panel.icon} text-[17px] text-primary-600`} aria-hidden="true" />
            <span className="text-[13.5px] font-bold text-foreground">{panel.title}</span>
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-[12px] font-bold text-muted-foreground">
              {currentStageName}
            </span>
            <div className="ml-auto flex items-center gap-2">
              {/* Card-level actions owned by SpecificationPanel land here.
                  The panel portals into this node rather than the state being
                  lifted: "Save as template" needs the panel's selected card,
                  its spec draft and its dialog state, none of which belong to
                  the stage frame. */}
              <div ref={setSpecHeaderSlot} className="flex items-center gap-2" />
              {!isQuote && !isSpecs && !isFulfilment ? <ComingSoon /> : null}
              {/* The advance control belongs with the stage it advances, not in
                  a separate section below the work. The label names the stage
                  the signal moves the order INTO, which is only "quotes" from
                  Specs — every other stage keeps the neutral wording.
                  At QUOTE there is no button here at all: the decision chain's
                  "Send to client" is the advance, because the order should move
                  on the proposal going out and nothing else. Two controls doing
                  the same thing invited signalling without a proposal. */}
              {isQuote ? null : (
              <Button
                size="sm"
                // At Specs the button opens the RFE dialog; the signal is sent
                // from there, after every RFE is written.
                onClick={
                  isSpecs
                    ? () => {
                        setAdvanceOnSent(true);
                        setQuotesOpen(true);
                      }
                    : handleAdvance
                }
                data-testid="advance-stage"
                aria-busy={signalBusy}
                disabled={signalBusy || !instanceId}
                title={
                  instanceId
                    ? undefined
                    : 'This order has no task instance, so there is no workflow to signal.'
                }
              >
                {signalBusy ? 'Sending…' : isSpecs ? 'Send for quotes' : 'Send response'}
                <i className="icon icon_-Tb_arrow_right" aria-hidden="true" />
              </Button>
              )}
            </div>
          </div>
          {signalNote || !instanceId ? (
            <p
              className={`border-b border-border px-4 py-2 text-[12.5px] ${
                instanceId ? 'text-muted-foreground' : 'text-warning-700'
              }`}
              role="status"
            >
              {instanceId
                ? signalNote
                : 'This order has no task instance, so there is no workflow to signal.'}
            </p>
          ) : null}
          {isSpecs ? (
            <div className="px-4 py-4">
              <SpecificationPanel
                orderId={orderId}
                orderNo={order.order_code ?? null}
                buyerPartyId={order.buyer_party_id?.id ?? null}
                headerSlot={specHeaderSlot}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-4 px-4 py-3.5">
              <p className="text-[13.5px] text-muted-foreground">{panel.body}</p>
              {!isQuote && !isFulfilment ? <ComingSoon /> : null}
            </div>
          )}
        </div>
      ) : null}

      </div>

      {/* RFEs are written here, then the stage advances — never the reverse.
          Mounted only while open so its selections reset on close without a
          reset effect (which would be a synchronous setState in an effect). */}
      {quotesOpen ? (
      <SendForQuotesDialog
        open={quotesOpen}
        onOpenChange={setQuotesOpen}
        orderId={orderId}
        orderNo={order.order_code ?? null}
        onSent={async ({ rfeCount, supplierNames }) => {
          setQuotesOpen(false);
          await rfes.refetch();
          setSignalNote(
            `${rfeCount} RFE${rfeCount === 1 ? '' : 's'} sent to ${supplierNames.join(', ')}.`,
          );
          if (advanceOnSent) await handleAdvance();
        }}
      />
      ) : null}
    </div>
  );
}

export default OrderWorkspacePage;
