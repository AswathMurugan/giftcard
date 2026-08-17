/**
 * Start an order — capture the brief, create the order, and start its workflow.
 *
 * Two phases on one route:
 *   FORM    → buyer, brief, requested delivery, order code
 *   CREATED → the 9-stage lifecycle strip for the new order, plus the
 *             "Send response" control that signals the workflow to advance.
 *
 * Layout follows the demo: a centred 880px column, teal eyebrow over an
 * 800-weight title, and the lifecycle strip as a bordered 12px-radius bar of
 * 20px stage pips (done = green check, current = gold dot, todo = hairline
 * outline) joined by hairline connectors.
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useSavedQueryList } from '@/hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  createOrderAndStartWorkflow,
  currentPosition,
  fetchStatusHistory,
  type CreateOrderStep,
} from '@/pages/orders/order-api';
import {
  decorateStages,
  nextOrderCode,
  type OrderedStage,
  type StageDefinition,
} from '@/pages/orders/stage-helpers';
import { PAGE_CONTAINER } from '@/pages/page-shell';

interface PartyRow {
  id?: string;
  name?: string;
  kind?: string;
  status?: string;
}

interface OrderRow {
  id?: string;
  order_code?: string;
}

/** One row of `tq_status_history` — the task instance's own state trail. */
interface StatusHistoryRow {
  id?: string;
  created_at?: string;
  is_current?: boolean;
  tq_state_definition?: { state?: string };
  tq_sub_task_instance?: {
    tq_sub_task_definition?: { name?: string };
  };
}

const STEP_LABELS: Record<CreateOrderStep, string> = {
  order: 'Creating the order and its task…',
  task: 'Reading back the task instance…',
  stage: 'Opening the first stage…',
  link: 'Linking the task to the order…',
  assign: 'Assigning it to you…',
  // Also shown while waiting for the run to reach Specs, which is the same
  // thing from the operator's side: the workflow is getting going.
  workflow: 'Starting the workflow…',
  done: 'Done',
};

/** One 20px pip + label, per the demo's lifecycle strip. */
function StagePip({ stage }: { stage: OrderedStage }) {
  const isDone = stage.status === 'done';
  const isCurrent = stage.status === 'current';

  return (
    <div className="flex shrink-0 items-center">
      <div className="flex items-center gap-2">
        <span
          className={[
            'grid size-5 shrink-0 place-items-center rounded-full border-[1.5px]',
            isDone
              ? 'border-success-500 bg-success-500 text-white'
              : isCurrent
                ? 'border-primary-500 bg-primary-500 text-white'
                : 'border-line-strong bg-card',
          ].join(' ')}
        >
          {isDone ? (
            <i className="icon icon_-Tb_check text-[12px]" aria-hidden="true" />
          ) : (
            <span
              className={[
                'block rounded-full',
                isCurrent ? 'size-1.5 bg-white' : 'size-1.5 bg-muted-foreground/40',
              ].join(' ')}
              aria-hidden="true"
            />
          )}
        </span>
        <span
          className={[
            'text-[12.5px] whitespace-nowrap',
            isDone
              ? 'font-semibold text-foreground'
              : isCurrent
                ? 'font-bold text-primary-600'
                : 'font-medium text-muted-foreground',
          ].join(' ')}
        >
          {stage.name}
        </span>
      </div>
      {stage.connector ? (
        <span className="mx-2 h-[1.5px] w-4 shrink-0 bg-border" aria-hidden="true" />
      ) : null}
    </div>
  );
}

export function StartOrderPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Buyer picker + stage definitions + existing codes (for the next code).
  const parties = useSavedQueryList('party_list');
  const stageList = useSavedQueryList('tq_stage_list');
  const orders = useSavedQueryList('order_list');

  const partyRows = (parties.data ?? []) as PartyRow[];
  const stageRows = (stageList.data ?? []) as StageDefinition[];
  const orderRows = (orders.data ?? []) as OrderRow[];

  const [buyerPartyId, setBuyerPartyId] = useState('');
  const [orderBrief, setOrderBrief] = useState('');
  const [requestedDelivery, setRequestedDelivery] = useState('');

  const [busyStep, setBusyStep] = useState<CreateOrderStep | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{
    orderId: string;
    instanceId: string;
    orderCode: string;
    workflowStarted: boolean;
    workflowError?: string;
  } | null>(null);

  // Allocated silently from the existing GC- series — the specialist never
  // types or sees it before the order exists.
  const effectiveCode = useMemo(
    () => nextOrderCode(orderRows.map((o) => o.order_code)),
    [orderRows],
  );

  // Live position read from the TASK INSTANCE itself, not from `order_list`.
  // `order_list` projects only `current_status` — it never selects
  // `current_task`, so the stage NAME isn't in that response at all.
  // `tq_status_history` returns the whole trail with `is_current`, carrying
  // both the stage name and the state, and it's the same row set the workflow
  // writes as it advances.
  const history = useSavedQueryList('tq_status_history', {
    input: { instanceId: created?.instanceId ?? '' },
    enabled: Boolean(created?.instanceId),
  });
  const historyRows = (history.data ?? []) as StatusHistoryRow[];
  const currentEntry = historyRows.find((r) => r.is_current);
  const currentStageName =
    currentEntry?.tq_sub_task_instance?.tq_sub_task_definition?.name ?? null;
  const currentStateName = currentEntry?.tq_state_definition?.state ?? null;

  // State as well as stage, so a stage sitting on its own final state reads as
  // done rather than in-progress. Same reason as the order workspace.
  const stages = useMemo(
    () => decorateStages(stageRows, currentStageName, currentStateName),
    [stageRows, currentStageName, currentStateName],
  );

  const canSubmit =
    Boolean(buyerPartyId) &&
    Boolean(requestedDelivery) &&
    Boolean(effectiveCode) &&
    busyStep === null;

  async function handleCreate() {
    setError(null);
    try {
      const result = await createOrderAndStartWorkflow(
        {
          orderCode: effectiveCode,
          orderBrief,
          buyerPartyId,
          requestedDelivery,
        },
        setBusyStep,
      );
      setCreated({
        orderId: result.orderId,
        instanceId: result.instanceId,
        orderCode: effectiveCode,
        workflowStarted: result.workflowStarted,
        workflowError: result.workflowError,
      });
      /**
       * Go straight to the card studio.
       *
       * Designing the card IS the next step, so an interstitial that only
       * offers a link to it is a page in the way. The wait matters though:
       * the workflow starts asynchronously and lands on Specs a moment later,
       * so navigating immediately would open the order at the Order stage and
       * show no studio at all. Poll until it arrives, then go — and if it
       * never does, fall through to the created panel rather than dropping the
       * operator somewhere with nothing on it.
       */
      if (result.workflowStarted && result.instanceId) {
        setBusyStep('workflow');
        for (let attempt = 0; attempt < 10; attempt += 1) {
          await new Promise((r) => setTimeout(r, 700));
          const rows = await fetchStatusHistory(result.instanceId);
          if (currentPosition(rows).stage === 'Specs') {
            // Invalidate HERE, not before the poll: done earlier, the order
            // page rendered from a cache captured while the run was still at
            // Order, and opened on the intake panel instead of the studio.
            await queryClient.invalidateQueries();
            navigate(`/orders/${result.orderId}`);
            return;
          }
        }
      }
      // Reached only if the run never got to Specs — fall back to the created
      // panel with a live refresh rather than stranding the operator.
      await queryClient.invalidateQueries();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyStep(null);
    }
  }


  function handleStartAnother() {
    setCreated(null);
    setOrderBrief('');
    setRequestedDelivery('');
    setBuyerPartyId('');
    // No code to reset — the next one is derived from the order list.
    setError(null);
  }

  return (
    <div className={PAGE_CONTAINER} data-testid="start-order-page">
      <div className="mb-1 text-[13px] font-semibold tracking-[0.02em] text-teal-700">
        START AN ORDER
      </div>
      <h1 className="text-[28px] font-extrabold tracking-[-0.02em] text-foreground">
        {created ? 'Order created' : 'What do you need?'}
      </h1>
      <p className="mb-6 mt-1 text-[15px] leading-relaxed text-muted-foreground">
        {created
          ? 'The order is on the board and its workflow is running. Advance it stage by stage below.'
          : 'Describe the order in plain language. It gets a task instance and starts the production workflow.'}
      </p>

      {/* ── Created: lifecycle strip ─────────────────────────────── */}
      {created ? (
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-border bg-card px-4 py-3.5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-baseline gap-2.5">
                <span className="text-[15.5px] font-bold text-foreground">
                  {created.orderCode}
                </span>
                {currentStateName ? (
                  <span className="inline-flex items-center rounded-full border border-teal-200 bg-teal-50 px-2 py-px text-[12.5px] font-semibold text-teal-700">
                    {currentStateName}
                  </span>
                ) : null}
              </div>
              <span className="font-mono text-[11px] text-muted-foreground">
                task {created.instanceId.slice(0, 8)}…
              </span>
            </div>

            {stageList.isLoading ? (
              <Skeleton className="h-8 rounded-lg" />
            ) : (
              <div className="flex items-center overflow-x-auto">
                {stages.map((stage) => (
                  <StagePip key={stage.id} stage={stage} />
                ))}
              </div>
            )}
          </div>

          {!created.workflowStarted ? (
            <div className="rounded-xl border border-warning-200 bg-warning-50 px-4 py-3 text-[13.5px] text-warning-700">
              The order and its task were created, but the workflow did not start
              {created.workflowError ? `: ${created.workflowError}` : '.'} The stage
              strip shows the task's own state; starting the workflow again is safe.
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            {/* Open the order, NOT signal it.
                By the time this screen renders, the workflow has already moved
                to Specs and is parked on its wait. "Send response" here
                therefore consumed that wait and jumped the order to Quote —
                skipping the card design entirely, with no way back to the
                studio because it only renders at Specs. The next step after
                creating an order is designing the card, so that is the
                button. */}
            <Button asChild>
              <Link to={`/orders/${created.orderId}`}>
                <i className="icon icon_-Tb_credit_card" aria-hidden="true" />
                Design the card
              </Link>
            </Button>
            <Button
              variant="outline"
              onClick={() => void history.refetch()}
              disabled={history.isLoading}
            >
              <i className="icon icon_-Tb_refresh" aria-hidden="true" />
              Refresh
            </Button>
            <Button variant="outline" onClick={handleStartAnother}>
              Start another
            </Button>
            <span className="text-[12.5px] text-muted-foreground">
              The workflow is already waiting at Specs — the card is designed
              there, and sending it for quotes is what advances the order.
            </span>
          </div>
        </div>
      ) : (
        /* ── Form ───────────────────────────────────────────────── */
        <div className="flex flex-col gap-5 rounded-xl border border-border bg-card p-6">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="buyer">Buyer</Label>
              {parties.isLoading ? (
                <Skeleton className="h-9 rounded-md" />
              ) : (
                <Select value={buyerPartyId} onValueChange={setBuyerPartyId}>
                  <SelectTrigger id="buyer">
                    <SelectValue placeholder="Choose a client" />
                  </SelectTrigger>
                  <SelectContent>
                    {partyRows
                      .filter((p) => p.id)
                      .map((p) => (
                        <SelectItem key={p.id} value={p.id as string}>
                          {p.name ?? p.id}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="delivery">Requested delivery</Label>
              <Input
                id="delivery"
                type="date"
                value={requestedDelivery}
                onChange={(e) => setRequestedDelivery(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="brief">Order brief</Label>
            <Textarea
              id="brief"
              rows={3}
              placeholder="10,000 Thank-You cards, affixed carrier, matte finish…"
              value={orderBrief}
              onChange={(e) => setOrderBrief(e.target.value)}
            />
          </div>

          {error ? (
            <div className="rounded-lg border border-danger-200 bg-danger-50 px-3.5 py-2.5 text-[13.5px] text-danger-500">
              {error}
            </div>
          ) : null}

          <div className="flex items-center gap-3">
            <Button onClick={handleCreate} disabled={!canSubmit}>
              <i className="icon icon_-Tb_circle_plus" aria-hidden="true" />
              Create order
            </Button>
            {busyStep ? (
              <span className="text-[13px] text-muted-foreground">
                {STEP_LABELS[busyStep]}
              </span>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

export default StartOrderPage;
