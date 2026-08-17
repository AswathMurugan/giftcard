/**
 * The Schedule card — the order's dated commitments.
 *
 * Laid out as the demo has it: a state pill and the template it came from, an
 * action bar (apply · firm · publish), then one row per milestone with an
 * editable target, a status chip and a client-obligation toggle.
 *
 * Sits above the stage chain because it spans it: the milestones here are
 * owed across Quote, Proof and Ship at once, and several are owed by the
 * CLIENT. The rail says where the order is; this says whether it is on time.
 *
 * Two halves, deliberately separated. TARGETS are what we ask for and a person
 * edits them. ACTUALS are what happened and only an event writes them — read
 * from the proposal, the supply orders, each proof verdict and each despatch.
 * Nobody can type a completion date, so a milestone nothing proves stays
 * honestly pending.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useSavedQueryList, useSavedQuerySingle } from '@/hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { StepGroup } from './StepGroup';
import {
  addMilestone,
  applyPlanTemplate,
  editMilestone,
  notifySchedulePublished,
  setMilestonePad,
  setPlanState,
  stampMilestone,
} from './order-api';
import {
  ADHOC_MILESTONE_TYPES,
  OWNER_LABEL,
  OWNER_ROLES,
  addDays,
  deriveActuals,
  leadTimeSlip,
  milestoneStatus,
  milestoneViews,
  pendingStamps,
  planFromTemplate,
  planSummary,
  sequenceForDate,
  statusChip,
  templateFor,
  type MilestoneView,
  type OrderPlanGrid,
  type PlanRow,
  type QuotedLeadTime,
} from './plan-helpers';
import {
  forThisOrder,
  shipProgress,
  supplyOrders as pickSupplyOrders,
  type FulfilmentGrid,
} from './fulfilment-helpers';

/** Today as `YYYY-MM-DD`, in the operator's own day. */
function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
}

/** `2026-08-31` → `Aug 31`, the demo's short form. */
function shortDate(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const month = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1)).toLocaleString('en-US', {
    month: 'short',
    timeZone: 'UTC',
  });
  return `${month} ${d}`;
}

/**
 * A target date that is written when the operator has FINISHED typing.
 *
 * A native date input fires `change` on every segment, so saving on change
 * wrote a half-typed date — typing 08/25 through 08/2 first persisted the 2nd
 * of the month, and the refetch that followed reset the field mid-keystroke.
 * The value is held locally and committed on blur or Enter.
 */
function TargetDateCell({
  view,
  busy,
  onCommit,
}: {
  view: MilestoneView;
  busy: boolean;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(view.targetDate ?? '');
  // Re-sync when the row changes underneath (a refetch, or a re-applied plan).
  useEffect(() => setDraft(view.targetDate ?? ''), [view.targetDate]);

  function commit() {
    if (draft && draft !== view.targetDate) onCommit(draft);
    else setDraft(view.targetDate ?? '');
  }

  return (
    <input
      type="date"
      className="h-8 w-[8.5rem] rounded-lg border border-border bg-card px-2 text-[12.5px] text-foreground disabled:opacity-60"
      value={draft}
      disabled={busy}
      aria-label={`Target date for ${view.milestoneType}`}
      data-testid={`milestone-target-${view.milestoneType}`}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setDraft(view.targetDate ?? '');
      }}
    />
  );
}

/**
 * Raise a milestone that the template does not cover.
 *
 * A press check before a long run, a production start the client wants to
 * witness. Kept behind a toggle because it is the exception: most orders run
 * on the template alone, and an always-open form implies otherwise.
 */
function AddMilestoneForm({
  busy,
  onAdd,
}: {
  busy: boolean;
  onAdd: (fields: {
    milestoneType: string;
    targetDate: string;
    ownerRole: string;
    ownerName: string;
  }) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<string>(ADHOC_MILESTONE_TYPES[0]);
  const [detail, setDetail] = useState('');
  const [target, setTarget] = useState('');
  const [ownerRole, setOwnerRole] = useState('cs');
  const [ownerName, setOwnerName] = useState('');

  const label = type === 'Other' ? detail.trim() : type;
  const ready = Boolean(label && target);

  async function submit() {
    await onAdd({ milestoneType: label, targetDate: target, ownerRole, ownerName });
    setDetail('');
    setTarget('');
    setOwnerName('');
    setOpen(false);
  }

  if (!open) {
    return (
      <Button
        size="sm"
        variant="outline"
        className="self-start"
        disabled={busy}
        data-testid="add-milestone-open"
        onClick={() => setOpen(true)}
      >
        <i className="icon icon_-Tb_plus mr-1 text-[1.125rem]" aria-hidden="true" />
        Add milestone
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-muted/40 p-3">
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-muted-foreground">Milestone</span>
        <select
          className="h-8 rounded-md border border-border bg-card px-2 text-[12.5px] text-foreground"
          value={type}
          data-testid="add-milestone-type"
          onChange={(e) => setType(e.target.value)}
        >
          {ADHOC_MILESTONE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>

      {type === 'Other' ? (
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted-foreground">Detail</span>
          <Input
            className="h-8 w-[10rem] text-[12.5px]"
            value={detail}
            data-testid="add-milestone-detail"
            onChange={(e) => setDetail(e.target.value)}
          />
        </label>
      ) : null}

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-muted-foreground">Target</span>
        <input
          type="date"
          className="h-8 w-[8.5rem] rounded-md border border-border bg-card px-2 text-[12.5px] text-foreground"
          value={target}
          data-testid="add-milestone-target"
          onChange={(e) => setTarget(e.target.value)}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-muted-foreground">Owned by</span>
        <select
          className="h-8 rounded-md border border-border bg-card px-2 text-[12.5px] text-foreground"
          value={ownerRole}
          data-testid="add-milestone-role"
          onChange={(e) => setOwnerRole(e.target.value)}
        >
          {OWNER_ROLES.map((r) => (
            <option key={r} value={r}>
              {OWNER_LABEL[r]}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-muted-foreground">Owner name</span>
        <Input
          className="h-8 w-[8rem] text-[12.5px]"
          value={ownerName}
          placeholder="optional"
          data-testid="add-milestone-owner"
          onChange={(e) => setOwnerName(e.target.value)}
        />
      </label>

      <Button
        size="sm"
        disabled={busy || !ready}
        data-testid="add-milestone-save"
        title={ready ? 'Add this milestone' : 'A milestone needs a name and a target date'}
        onClick={() => void submit()}
      >
        Add
      </Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </div>
  );
}

export function PlanPanel({
  orderId,
  clientId,
  clientName,
  requestedDelivery,
}: {
  orderId: string;
  /** Whose template applies — the client's own, else the tenant default. */
  clientId: string | null;
  clientName: string | null;
  /** The in-hands date every target is back-calculated from. */
  requestedDelivery: string | null;
}) {
  const planQuery = useSavedQuerySingle('order_plan', {
    input: { orderId },
    enabled: Boolean(orderId),
  });
  // Same query keys the other panels use, so these come from cache rather
  // than a second fetch.
  const fulfilment = useSavedQuerySingle('order_fulfilment_grid', {
    input: { orderId },
    enabled: Boolean(orderId),
  });
  const quotes = useSavedQuerySingle('order_quote_grid', {
    input: { orderId },
    enabled: Boolean(orderId),
  });
  const proposals = useSavedQueryList('order_proposals', {
    input: { orderId },
    enabled: Boolean(orderId),
  });

  const [busy, setBusy] = useState(false);
  /** The last failure, shown on the card. Success speaks for itself. */
  const [problem, setProblem] = useState<string | null>(null);
  /** Which milestone's padding is being spent, if any. */
  const [padEditing, setPadEditing] = useState<string | null>(null);
  const today = todayIso();

  const data = (planQuery.data ?? null) as OrderPlanGrid | null;
  const grid = (fulfilment.data ?? null) as FulfilmentGrid | null;
  const plan: PlanRow | null = data?.plan?.[0] ?? null;
  const items = useMemo(() => data?.items ?? [], [data]);
  const templateRows = useMemo(
    () => templateFor(data?.template_rows ?? [], clientId),
    [data, clientId],
  );
  const templateName = templateRows[0]?.template?.name ?? 'the default template';

  const views = useMemo(
    () => milestoneViews(items, plan?.anchor_date ?? null, today),
    [items, plan, today],
  );
  /**
   * The two tables show DIFFERENT sets on purpose.
   *
   * Schedule is the client-facing commitment — the template set, and only
   * that, because it is what gets published and what the proposal commits to.
   * Milestones is the operational list: the same rows PLUS anything raised by
   * hand on this order, which the client never sees.
   */
  const scheduleViews = useMemo(() => views.filter((v) => v.origin === 'template'), [views]);

  const supply = useMemo(() => pickSupplyOrders(grid), [grid]);
  const awarded = supply.length > 0;

  /** Every dated event this order can prove, keyed by milestone. */
  const actuals = useMemo(() => {
    const supplyIds = new Set(supply.map((r) => r.child_order?.id).filter(Boolean) as string[]);
    const records = forThisOrder(grid?.shipment_records, supplyIds);
    const progress = shipProgress(records, grid?.shipments ?? []);
    return deriveActuals({
      relations: grid?.relations,
      reviews: grid?.reviews,
      verdicts: grid?.verdicts,
      shipments: grid?.shipments?.filter((s) =>
        records.some((r) => r.id === s.shipment_record?.id),
      ),
      // Only when every planned destination is fully despatched — a partial
      // delivery is not a final ship.
      shippingComplete: progress.length > 0 && progress.every((p) => p.state === 'complete'),
      proposals: (proposals.data ?? []) as Array<{ sent_at?: string; accepted_at?: string }>,
    });
  }, [grid, supply, proposals.data]);

  const unstamped = useMemo(() => pendingStamps(items, actuals), [items, actuals]);

  /**
   * Can the awarded suppliers actually hit the committed date?
   *
   * Read from the lead time they QUOTED on their RFE response, against the
   * suppliers who actually won work. Shown from firming onwards, because
   * before the award there is no supplier to hold to it.
   */
  const slip = useMemo(() => {
    if (!plan?.anchor_date) return null;
    const q = (quotes.data ?? null) as {
      responses?: Array<{
        lead_time_weeks?: number;
        rfe?: { supplier?: { id?: string; name?: string } | null } | null;
      }>;
    } | null;
    const awardedIds = new Set(
      (grid?.allocations ?? []).map((a) => a.supplier?.id).filter(Boolean) as string[],
    );
    const leadTimes: QuotedLeadTime[] = (q?.responses ?? [])
      .filter((r) => r.rfe?.supplier?.id && awardedIds.has(r.rfe.supplier.id))
      .map((r) => ({
        supplierId: r.rfe?.supplier?.id as string,
        supplierName: r.rfe?.supplier?.name ?? 'supplier',
        weeks: r.lead_time_weeks ?? 0,
      }));
    // Measured from the day the supply orders were raised — that is when the
    // supplier's clock actually started.
    const from = supply.map((s) => s.created_at?.slice(0, 10)).filter(Boolean).sort()[0] ?? today;
    return leadTimeSlip(leadTimes, plan.anchor_date.slice(0, 10), from as string);
  }, [plan, quotes.data, grid, supply, today]);

  /**
   * Stamp everything the data already proves.
   *
   * Only ever fills an EMPTY actual, so running it twice does nothing — and
   * doing it automatically is what lets an order that ran before the schedule
   * existed pick up its real history instead of showing nine pending rows
   * against events that plainly happened.
   */
  const syncing = useRef(false);
  /** One attempt per milestone per page load, so a failure cannot loop. */
  const attempted = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!plan || syncing.current || busy) return;
    const todo = unstamped.filter((s) => !attempted.current.has(s.itemId));
    if (todo.length === 0) return;
    syncing.current = true;
    void (async () => {
      try {
        for (const stamp of todo) {
          attempted.current.add(stamp.itemId);
          await stampMilestone({
            itemId: stamp.itemId,
            actualDate: stamp.date,
            status: stamp.status,
            note: stamp.note,
          });
        }
        await planQuery.refetch();
      } catch (e) {
        setProblem(
          `Could not update the schedule: ${e instanceof Error ? e.message : String(e)}`,
        );
      } finally {
        syncing.current = false;
      }
    })();
  }, [plan, unstamped, busy, planQuery]);

  /**
   * Every action reports by CHANGING THE TABLE, not by announcing itself.
   *
   * A schedule edit is visible the moment it lands — the date moves, the chip
   * flips, the pill turns teal — so a popup confirming it was noise on top of
   * the answer. Only a FAILURE needs words, and it stays on the card that
   * caused it rather than floating over the page.
   */
  async function run(what: string, fn: () => Promise<unknown>) {
    setBusy(true);
    setProblem(null);
    try {
      await fn();
      await planQuery.refetch();
    } catch (e) {
      setProblem(`${what.replace(/\.$/, '')} failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  function handleApply() {
    if (!requestedDelivery || templateRows.length === 0) return;
    const anchor = requestedDelivery.slice(0, 10);
    void run('Schedule applied — targets back-calculated from the delivery date.', () =>
      applyPlanTemplate({
        orderId,
        templateId: templateRows[0]?.template?.id as string,
        anchorDate: anchor,
        milestones: planFromTemplate(templateRows, anchor),
      }),
    );
  }

  /** Move a target. The status re-derives against whatever was stamped. */
  function handleRetarget(view: MilestoneView, nextDate: string) {
    if (!nextDate || nextDate === view.targetDate) return;
    void run(`${view.milestoneType} moved to ${nextDate}.`, () =>
      editMilestone({
        itemId: view.id,
        targetDate: nextDate,
        status: milestoneStatus(nextDate, view.actualDate, today),
        ownerRole: view.ownerRole,
        clientObligation: view.clientObligation,
      }),
    );
  }

  /** Hand a milestone to the client, or take it back. */
  function handleToggleClient(view: MilestoneView) {
    const next = !view.clientObligation;
    void run(
      next
        ? `${view.milestoneType} is now the client's to deliver.`
        : `${view.milestoneType} is back with CS.`,
      () =>
        editMilestone({
          itemId: view.id,
          targetDate: view.targetDate ?? today,
          status: view.status,
          ownerRole: next ? 'client' : 'cs',
          clientObligation: next,
        }),
    );
  }

  /**
   * Publish, then tell the client.
   *
   * Two halves in a deliberate order. The flag is written first, because that
   * is the fact — this schedule has been shown to the client and a later edit
   * has to be read against it. The `schedule_published` workflow is the
   * outbound half; if it fails the publish still stands, and the message says
   * exactly that rather than implying nothing happened.
   */
  async function handlePublish() {
    if (!plan?.id) return;
    setBusy(true);
    setProblem(null);
    try {
      await setPlanState({
        planId: plan.id,
        status: plan.status ?? 'provisional',
        publishedToClient: true,
      });
      await planQuery.refetch();
      await notifySchedulePublished({
        orderId,
        orderCode: plan.subject_order?.order_code ?? '',
        planId: plan.id,
        planStatus: plan.status ?? 'provisional',
        clientName: clientName ?? '',
        deliverBy: plan.anchor_date?.slice(0, 10) ?? '',
        milestoneCount: views.length,
      });
    } catch (e) {
      setProblem(
        `The schedule is marked published, but notifying ${clientName ?? 'the client'} failed: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    } finally {
      setBusy(false);
    }
  }

  /**
   * Spend or restore buffer.
   *
   * Removing a day of padding gives the day back to the target — the ask moves
   * LATER, which is the whole point of holding a buffer separately: it can be
   * handed back deliberately when something else slips.
   */
  function handlePad(view: MilestoneView, nextPad: number) {
    if (!view.targetDate) return;
    const delta = view.padDays - nextPad;
    void run(`${view.milestoneType} padding set to ${nextPad}d.`, () =>
      setMilestonePad({
        itemId: view.id,
        padDays: nextPad,
        targetDate: addDays(view.targetDate as string, delta),
      }),
    );
  }

  async function handleAddMilestone(fields: {
    milestoneType: string;
    targetDate: string;
    ownerRole: string;
    ownerName: string;
  }) {
    if (!plan?.id) return;
    await run(`${fields.milestoneType} added.`, () =>
      addMilestone({
        planId: plan.id as string,
        milestoneType: fields.milestoneType,
        // Placed by DATE, so the table still reads as a timeline.
        sequence: sequenceForDate(items, fields.targetDate),
        targetDate: fields.targetDate,
        ownerRole: fields.ownerRole,
        ownerName: fields.ownerName.trim() || null,
        clientObligation: fields.ownerRole === 'client',
      }),
    );
  }

  if (planQuery.isLoading) return <Skeleton className="h-24 rounded-xl" />;

  const published = plan?.published_to_client === true;
  const firmed = plan?.status === 'firmed';

  return (
    <StepGroup
      title="Schedule"
      /* Approved once the client has been shown the dates; live while it is
         still ours to change; pending until a template is applied. */
      state={plan ? (published ? 'approved' : 'current') : 'pending'}
    >
      {/* ── State, template, and what it is a schedule FOR ──────────── */}
      <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1">
        {plan ? (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.04em] ${
              firmed
                ? 'border-teal-200 bg-teal-50 text-teal-700'
                : 'border-warning-200 bg-warning-50 text-warning-700'
            }`}
            data-testid="plan-state"
          >
            <span
              className={`size-1.5 rounded-full ${firmed ? 'bg-teal-700' : 'bg-warning-700'}`}
              aria-hidden="true"
            />
            {firmed ? 'Firmed' : 'Provisional'}
          </span>
        ) : null}
        <span className="text-[12.5px] text-muted-foreground">
          {plan ? `· ${plan.template?.name ?? templateName}` : `· ${templateName}`}
        </span>
        {published ? (
          <span className="rounded-full bg-primary-50 px-2 py-0.5 text-[10.5px] font-bold uppercase text-primary-700">
            Published
          </span>
        ) : null}
        <span className="ml-auto text-[12.5px] text-muted-foreground" data-testid="plan-anchor">
          {clientName ?? 'Client'} · deliver by {shortDate(requestedDelivery)}
        </span>
      </div>

      {/* ── Actions ────────────────────────────────────────────────── */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          data-testid="apply-plan-template"
          aria-busy={busy}
          disabled={busy || Boolean(plan) || !requestedDelivery || templateRows.length === 0}
          title={
            plan
              ? 'A schedule is already applied to this order'
              : !requestedDelivery
                ? 'This order has no delivery date to plan from'
                : 'Back-calculate every target from the delivery date'
          }
          onClick={handleApply}
        >
          <i className="icon icon_-Tb_template mr-1 text-[1.125rem]" aria-hidden="true" />
          Apply: {templateName}
        </Button>

        {/* Firming has no meaning before an award: it exists to read the plan
            against the lead time the winning supplier quoted. */}
        <Button
          size="sm"
          variant="outline"
          data-testid="firm-plan"
          aria-busy={busy}
          disabled={busy || !plan || firmed || !awarded}
          title={
            !plan
              ? 'Apply a schedule first'
              : firmed
                ? 'Already firmed'
                : !awarded
                  ? 'Available after award — firming reads the dates against the chosen supplier'
                  : "Firm these dates against the awarded supplier's quoted lead time"
          }
          onClick={() =>
            void run('Schedule firmed against the awarded supplier.', () =>
              setPlanState({
                planId: plan?.id as string,
                status: 'firmed',
                publishedToClient: published,
              }),
            )
          }
        >
          <i className="icon icon_-Tb_calendar_check mr-1 text-[1.125rem]" aria-hidden="true" />
          Firm schedule
        </Button>

        <Button
          size="sm"
          className="ml-auto"
          data-testid="publish-plan"
          aria-busy={busy}
          disabled={busy || !plan}
          title={
            !plan
              ? 'Apply a schedule first'
              : `Share the ${firmed ? 'firmed' : 'provisional'} dates with the client`
          }
          onClick={() => void handlePublish()}
        >
          <i className="icon icon_-Tb_broadcast mr-1 text-[1.125rem]" aria-hidden="true" />
          {published ? 'Re-publish to client' : 'Publish to client'}
        </Button>
      </div>

      {problem ? (
        <p
          className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive"
          role="alert"
          data-testid="plan-error"
        >
          {problem}
        </p>
      ) : null}

      {!plan ? (
        <p className="text-[12.5px] leading-relaxed text-muted-foreground" data-testid="plan-empty">
          {requestedDelivery
            ? `No schedule yet. Applying ${templateName} back-calculates every target from the ${requestedDelivery} delivery date — these are the dates the client is committed to, set before a supplier is chosen.`
            : 'This order has no requested delivery date, so there is nothing to back-calculate a schedule from.'}
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border" data-testid="plan-panel">
          {/* ── Header ─────────────────────────────────────────────── */}
          <div className="grid grid-cols-[2fr_1.1fr_1fr_1fr] items-center gap-3 bg-primary-50 px-3 py-2 text-[10.5px] font-bold uppercase tracking-[0.06em] text-primary-700">
            <span>Milestone</span>
            <span>Target date</span>
            <span>Status</span>
            <span>Client</span>
          </div>

          {scheduleViews.map((v) => {
            const chip = statusChip(v, today);
            return (
              <Fragment key={v.id}>
                <div
                  className="grid grid-cols-[2fr_1.1fr_1fr_1fr] items-center gap-3 border-t border-border px-3 py-2"
                  data-testid={`milestone-${v.milestoneType}`}
                >
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[13px] font-semibold text-foreground">
                      {v.milestoneType}
                    </span>
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      {v.offsetLabel ?? ''}
                    </span>
                  </div>
                  {/* What proved it, and when. The evidence behind the chip. */}
                  {v.actualDate ? (
                    <div className="text-[11px] text-muted-foreground">
                      {shortDate(v.actualDate)}
                      {v.note ? ` · ${v.note}` : ''}
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-col items-start gap-1">
                  <TargetDateCell
                    view={v}
                    busy={busy}
                    onCommit={(next) => handleRetarget(v, next)}
                  />
                  {/* Padding shown, never folded into the date — an operator
                      can see the buffer exists and decide to spend it. */}
                  {v.padDays > 0 ? (
                    <button
                      type="button"
                      disabled={busy}
                      data-testid={`milestone-pad-${v.milestoneType}`}
                      title="Client standard padding — edit or remove"
                      aria-expanded={padEditing === v.id}
                      onClick={() => setPadEditing(padEditing === v.id ? null : v.id)}
                      className="inline-flex items-center gap-1 rounded-md border border-teal-200 bg-teal-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-teal-700"
                    >
                      <i className="icon icon_-Tb_clock text-[1.125rem]" aria-hidden="true" />
                      +{v.padDays}d padding
                    </button>
                  ) : null}
                </div>

                <span
                  className={`inline-flex w-fit items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${chip.className}`}
                  data-testid={`milestone-status-${v.milestoneType}`}
                >
                  <i className={`icon ${chip.icon} text-[1.125rem]`} aria-hidden="true" />
                  {chip.label}
                </span>

                {/* Whose milestone it is. A client obligation is called out
                    because that is what makes a slip attributable rather than
                    arguable — and it is a decision, so it is a control. */}
                {v.clientObligation ? (
                  <button
                    type="button"
                    disabled={busy}
                    aria-pressed
                    aria-label={`${v.milestoneType} is the client's — click to take it back`}
                    data-testid={`milestone-client-${v.milestoneType}`}
                    title="The client owes this. Click to hand it back to CS."
                    onClick={() => handleToggleClient(v)}
                    className="inline-flex w-fit items-center gap-1 rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-[11px] font-semibold text-teal-700"
                  >
                    <i className="icon icon_-Tb_user text-[1.125rem]" aria-hidden="true" />
                    Client
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    aria-pressed={false}
                    aria-label={`Mark ${v.milestoneType} as the client's obligation`}
                    data-testid={`milestone-client-${v.milestoneType}`}
                    title="Mark this as the client's to deliver"
                    onClick={() => handleToggleClient(v)}
                    className="inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
                  >
                    <i className="icon icon_-Tb_plus text-[1.125rem]" aria-hidden="true" />
                    Set
                  </button>
                )}
                </div>

                {/* Spending the buffer is a decision, so it gets its own row
                    rather than a silent date edit — and the target moves with
                    it, because a buffer means nothing apart from the date it
                    produced. */}
                {padEditing === v.id ? (
                  <div
                    className="col-span-4 -mt-1 flex flex-wrap items-center gap-3 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2"
                    data-testid={`pad-editor-${v.milestoneType}`}
                  >
                    <span className="text-[11.5px] font-semibold text-teal-700">
                      Client standard padding
                    </span>
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="size-6 p-0"
                        disabled={busy || v.padDays <= 0}
                        aria-label="One day less padding"
                        data-testid={`pad-minus-${v.milestoneType}`}
                        onClick={() => handlePad(v, v.padDays - 1)}
                      >
                        <i className="icon icon_-Tb_minus text-[1.125rem]" aria-hidden="true" />
                      </Button>
                      <span className="w-10 text-center text-[12.5px] font-semibold tabular-nums text-foreground">
                        {v.padDays} d
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="size-6 p-0"
                        disabled={busy || v.padDays >= 30}
                        aria-label="One day more padding"
                        data-testid={`pad-plus-${v.milestoneType}`}
                        onClick={() => handlePad(v, v.padDays + 1)}
                      >
                        <i className="icon icon_-Tb_plus text-[1.125rem]" aria-hidden="true" />
                      </Button>
                    </div>
                    <span className="text-[11.5px] text-muted-foreground">
                      Removing padding moves the target {v.padDays} day
                      {v.padDays === 1 ? '' : 's'} later.
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="ml-auto text-destructive"
                      disabled={busy}
                      data-testid={`pad-remove-${v.milestoneType}`}
                      onClick={() => {
                        handlePad(v, 0);
                        setPadEditing(null);
                      }}
                    >
                      Remove padding
                    </Button>
                  </div>
                ) : null}
              </Fragment>
            );
          })}
        </div>
      )}

      {/* ── What firming found ─────────────────────────────────────── */}
      {plan && slip ? (
        <p
          className="mt-2 rounded-lg border border-warning-200 bg-warning-50 px-3 py-2 text-[12px] text-warning-700"
          role="status"
          data-testid="plan-slip"
        >
          {slip.supplierName}&apos;s quoted {slip.weeks}-week lead time puts the earliest ship at{' '}
          {shortDate(slip.earliest)} — {slip.daysLate} day{slip.daysLate === 1 ? '' : 's'} past the
          committed {shortDate(plan.anchor_date ?? null)}. Expedite or re-negotiate; the targets
          still show what the client was promised.
        </p>
      ) : null}

      {/* ── Table 2 · Milestones ───────────────────────────────────────
          The operational list, not the client's. Everything on the schedule
          plus anything raised by hand for THIS order, and it shows the two
          dates side by side — what was asked for and what happened — which is
          the question the schedule table cannot answer at a glance. */}
      {plan ? (
        <div className="mt-4 flex flex-col gap-2" data-testid="milestone-panel">
          <div className="flex flex-wrap items-center gap-2">
            <i className="icon icon_-Tb_flag text-[1.125rem] text-teal-700" aria-hidden="true" />
            <span className="text-[13px] font-bold text-foreground">Milestones</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-muted-foreground">
              {views.length}
            </span>
            <span className="text-[11.5px] text-muted-foreground">
              · schedule plus anything added for this order — internal, never published
            </span>
          </div>

          <div className="overflow-hidden rounded-xl border border-border">
            <div className="grid grid-cols-[1.5fr_0.8fr_0.8fr_1fr_0.8fr] items-center gap-3 bg-primary-50 px-3 py-2 text-[10.5px] font-bold uppercase tracking-[0.06em] text-primary-700">
              <span>Milestone</span>
              <span>Target</span>
              <span>Actual</span>
              <span>Status</span>
              <span>Owner</span>
            </div>
            {views.map((v) => {
              const chip = statusChip(v, today);
              return (
                <div
                  key={`ms-${v.id}`}
                  className="grid grid-cols-[1.5fr_0.8fr_0.8fr_1fr_0.8fr] items-center gap-3 border-t border-border px-3 py-2"
                  data-testid={`milestone-row-${v.milestoneType}`}
                >
                  <span className="text-[12.5px] font-semibold text-foreground">
                    {v.milestoneType}
                    {/* An added milestone is marked, because it is NOT part of
                        what the client accepted. */}
                    {v.origin === 'added' ? (
                      <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[9.5px] font-bold uppercase text-muted-foreground">
                        Added
                      </span>
                    ) : null}
                  </span>
                  <span className="text-[12.5px] tabular-nums text-muted-foreground">
                    {shortDate(v.targetDate)}
                  </span>
                  <span className="text-[12.5px] tabular-nums text-foreground">
                    {v.actualDate ? shortDate(v.actualDate) : '—'}
                  </span>
                  <span
                    className={`inline-flex w-fit items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${chip.className}`}
                  >
                    <i className={`icon ${chip.icon} text-[1.125rem]`} aria-hidden="true" />
                    {chip.label}
                  </span>
                  <span className="truncate text-[12px] text-muted-foreground">
                    {v.ownerName ? v.ownerName : (OWNER_LABEL[v.ownerRole] ?? v.ownerRole)}
                  </span>
                </div>
              );
            })}
          </div>

          <AddMilestoneForm busy={busy} onAdd={handleAddMilestone} />
        </div>
      ) : null}

      {plan ? (
        <p className="mt-2 text-[11px] text-muted-foreground">
          {planSummary(views, today)}. Target dates are yours to move. Actual dates are stamped from the events themselves — the
          proposal, the supply orders, each proof verdict and each despatch — so a milestone cannot
          be marked done by hand. First Box Approval has no event in this app yet, so it stays
          pending.
        </p>
      ) : null}
    </StepGroup>
  );
}

export default PlanPanel;
