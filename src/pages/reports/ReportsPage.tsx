/**
 * Reports — the demo's seven views, over this tenant's own data.
 *
 * Two views, as the demo lays them out: a chooser of seven report cards, and
 * then one report at a time with Save / Schedule / Export beside its title.
 * The chooser IS the landing page — nothing is rendered under it until a card
 * is picked, so arriving at Reports asks which question rather than answering
 * an arbitrary one. Every figure is computed in `report-helpers` from
 * `report_board`; nothing here is seeded.
 *
 * The demo's My orders / Team toggle is deliberately absent. It scopes off a
 * person's org position, and this tenant records no owner on an order —
 * `created_by.full_name` is null on all 80 — so both halves of the toggle
 * would have produced the identical table under two different labels. The
 * demo's AI ask bar is out of scope here for the same reason it is out of the
 * rest of this app.
 */
import { useMemo, useState } from 'react';
import { useSavedQueryList, useSavedQuerySingle } from '@/hooks';
import type { SavedQueryName } from '@/types/saved-queries.generated';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PAGE_CONTAINER } from '@/pages/page-shell';
import type { StageDefinition } from '@/pages/orders/stage-helpers';
import {
  REPORTS,
  activityReport,
  agingReport,
  expiredReport,
  atRiskReport,
  compactMoney,
  milestoneReport,
  money,
  orderFacts,
  pipelineReport,
  proofingReport,
  shippingReport,
  shortDate,
  slaOf,
  toCsv,
  type PipelineStage,
  type ReportBoard,
  type ReportId,
  type SlaTone,
} from './report-helpers';

/** See ClientsPage — codegen for the registry is WAF-blocked, so this is cast. */
const REPORT_BOARD = 'report_board' as SavedQueryName;
const APP_KEY = 'aswathtestapp_6a67823a8fa7215710927dbc';

const LIFECYCLE = ['Order', 'Specs', 'Quote', 'Award', 'Produce', 'Proof', 'Ship', 'Bill', 'Order Close'];

const STATE_STYLE: Record<string, string> = {
  Met: 'text-success-700',
  Late: 'text-warning-700',
  Overdue: 'text-destructive',
  Pending: 'text-muted-foreground',
};

export function ReportsPage() {
  const board = useSavedQuerySingle(REPORT_BOARD, { appDefinitionKey: APP_KEY });
  const stageList = useSavedQueryList('tq_stage_list');

  // Null is the chooser. A report is only computed once somebody asks for it.
  const [reportId, setReportId] = useState<ReportId | null>(null);

  const data = board.data as ReportBoard | null;
  const stageData = stageList.data;

  // One clock for the whole screen: two panels a millisecond apart must not
  // disagree about whether something is overdue.
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // `?? []` inside the callback, not outside: a fresh array literal on every
  // render would make this memo — and the seven that depend on it — recompute
  // every time anything on the page changes.
  const scoped = useMemo(
    () => orderFacts(data, (stageData ?? []) as StageDefinition[], today),
    [data, stageData, today],
  );

  const pipeline = useMemo(() => pipelineReport(scoped, LIFECYCLE), [scoped]);
  const atRisk = useMemo(
    () => atRiskReport(scoped, data?.plan_items ?? [], today),
    [scoped, data, today],
  );
  const milestones = useMemo(
    () => milestoneReport(scoped, data?.plan_items ?? [], today),
    [scoped, data, today],
  );
  const activity = useMemo(() => activityReport(scoped, data, today), [scoped, data, today]);
  const proofing = useMemo(() => proofingReport(scoped, data?.reviews ?? []), [scoped, data]);
  const shipping = useMemo(() => shippingReport(scoped, data), [scoped, data]);
  const aging = useMemo(() => agingReport(scoped, today), [scoped, today]);
  // No `today`: an expiry is dated by when it happened, not by when you look.
  const expired = useMemo(() => expiredReport(scoped), [scoped]);

  const current = REPORTS.find((r) => r.id === reportId) ?? null;

  /** Build the CSV for whatever is on screen and hand it to the browser. */
  function handleExport() {
    if (!reportId) return;
    const { headers, rows } = csvFor(reportId, {
      pipeline,
      atRisk,
      milestones,
      activity,
      proofing,
      shipping,
      aging,
      expired,
    });
    const blob = new Blob([toCsv(headers, rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `forge-${reportId}-${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (board.isLoading || stageList.isLoading) {
    return (
      <div className={PAGE_CONTAINER}>
        <Skeleton className="mb-4 h-10 w-64" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  return (
    <div className={PAGE_CONTAINER} data-testid="reports-page">
      <h1 className="text-[28px] font-extrabold tracking-[-0.02em] text-foreground">Reports</h1>
      <p className="mt-1 text-[15px] text-muted-foreground">
        {scoped.length} order{scoped.length === 1 ? '' : 's'} across this tenant. Every figure is
        read from real orders, plans, RFEs, proofs and shipments — nothing here is illustrative.
      </p>

      {/* The chooser IS the landing view — pick a question before seeing an answer. */}
      {current === null ? (
        <div className="mt-5 grid gap-3 lg:grid-cols-2" data-testid="report-chooser">
          {REPORTS.map((r) => (
            <button
              key={r.id}
              type="button"
              data-testid={`report-card-${r.id}`}
              onClick={() => setReportId(r.id)}
              className="flex items-center gap-3.5 rounded-xl border border-border bg-card px-4 py-3.5 text-left transition-colors hover:border-primary-300 hover:bg-primary-50/30"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-primary-200 bg-primary-50">
                <i className={`icon ${r.icon} text-[1.25rem] text-primary-600`} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14.5px] font-bold text-foreground">{r.title}</span>
                <span className="block text-[12.5px] text-muted-foreground">{r.sub}</span>
              </span>
              <i
                className="icon icon_-Tb_chevron_right text-[1.125rem] text-muted-foreground"
                aria-hidden="true"
              />
            </button>
          ))}
        </div>
      ) : null}

      {/* The report. */}
      {current !== null ? (
      <div className="mt-5 rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <button
            type="button"
            data-testid="report-back"
            aria-label="Back to all reports"
            onClick={() => setReportId(null)}
            className="flex items-center gap-1.5 text-[12.5px] font-semibold text-muted-foreground hover:text-foreground"
          >
            <i className="icon icon_-Tb_arrow_left text-[1.125rem]" aria-hidden="true" />
            All reports
          </button>
          <span className="h-4 w-px bg-border" aria-hidden="true" />
          <span className="text-[13.5px] font-bold text-foreground">{current.title}</span>
          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled
              title="Saved views need somewhere to store them — no entity exists for that yet."
            >
              Save
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled
              title="Scheduling needs a scheduler and a delivery address — neither is wired up yet."
            >
              Schedule
            </Button>
            <Button size="sm" data-testid="report-export" onClick={handleExport}>
              <i className="icon icon_-Tb_download" aria-hidden="true" />
              Export
            </Button>
          </div>
        </div>

        <div className="px-4 py-3">
          {reportId === 'pipeline' ? (
            <>
              <h2 className="mb-3.5 text-[18px] font-bold text-foreground">
                Pipeline · open orders by stage
              </h2>
              <PipelineChart stages={pipeline.stages} />
              <Summary text={pipeline.summary} />
              <Table
                columns={[
                  { label: 'Order' },
                  { label: 'Client' },
                  { label: 'Stage' },
                  { label: 'Value', align: 'right' },
                  { label: 'Supplier' },
                  { label: 'Target' },
                  { label: 'SLA', align: 'right' },
                ]}
                rows={pipeline.rows.map((f) => {
                  const sla = slaOf(f, today);
                  return [
                    { text: f.code, className: 'font-semibold text-muted-foreground' },
                    { text: f.client, className: 'font-semibold text-foreground' },
                    { text: f.stage, className: 'text-muted-foreground' },
                    {
                      text: f.awardedCostMicros ? money(f.awardedCostMicros) : '—',
                      className: 'font-bold text-foreground',
                    },
                    { text: f.suppliers.join(' · ') || 'pending', className: 'text-muted-foreground' },
                    { text: shortDate(f.requestedDelivery), className: 'text-muted-foreground' },
                    { text: sla.label, className: SLA_CLASS[sla.tone] },
                  ];
                })}
              />
            </>
          ) : null}

          {reportId === 'atrisk' ? (
            <>
              <Summary text={atRisk.summary} />
              <Table
                columns={[
                  { label: 'Order' },
                  { label: 'Client' },
                  { label: 'Why' },
                  { label: 'Days', align: 'right' },
                  { label: 'Owner' },
                ]}
                rows={atRisk.rows.map((r) => [
                  { text: r.order.code, className: 'font-semibold text-muted-foreground' },
                  { text: r.order.client, className: 'font-semibold text-foreground' },
                  { text: r.why, className: 'text-destructive' },
                  { text: `${r.days}d`, className: 'font-bold text-foreground' },
                  { text: r.order.owner, className: 'text-muted-foreground' },
                ])}
              />
            </>
          ) : null}

          {reportId === 'milestones' ? (
            <>
              <Summary
                text={`${milestones.onTimePct === null ? '—' : `${milestones.onTimePct}% on time`} · ${milestones.summary}`}
              />
              <Table
                columns={[
                  { label: 'Order' },
                  { label: 'Client' },
                  { label: 'Milestone' },
                  { label: 'Target' },
                  { label: 'Actual' },
                  { label: 'Status' },
                  { label: 'Owner' },
                ]}
                rows={milestones.rows.map((r) => [
                  { text: r.code, className: 'font-semibold text-muted-foreground' },
                  { text: r.client, className: 'font-semibold text-foreground' },
                  r.milestone,
                  { text: shortDate(r.target), className: 'text-muted-foreground' },
                  { text: r.actual === '—' ? '—' : shortDate(r.actual), className: 'text-muted-foreground' },
                  { text: r.state, className: `font-bold ${STATE_STYLE[r.state]}` },
                  { text: r.owner, className: 'text-muted-foreground' },
                ])}
              />
            </>
          ) : null}

          {reportId === 'activity' ? (
            <>
              <div className="mb-3 flex flex-wrap gap-4">
                <Stat label="Win rate" value={activity.winRatePct === null ? '—' : `${activity.winRatePct}%`} />
                <Stat label="RFEs out" value={String(activity.rfesOut)} />
                <Stat label="Quotes in" value={String(activity.quotesIn)} />
              </div>
              <Summary text={activity.summary} />
              <Table
                columns={[
                  { label: 'Supplier' },
                  { label: 'Order' },
                  { label: 'Sent' },
                  { label: 'Status' },
                  { label: 'Lead', align: 'right' },
                ]}
                rows={activity.rows.map((r) => [
                  { text: r.supplier, className: 'font-semibold text-foreground' },
                  { text: r.code, className: 'font-semibold text-muted-foreground' },
                  { text: shortDate(r.sent === '—' ? null : r.sent), className: 'text-muted-foreground' },
                  {
                    text: r.stalled ? `${r.status} · stalled` : r.status,
                    className: r.stalled ? 'font-bold text-destructive' : 'text-muted-foreground',
                  },
                  r.leadWeeks === null ? '—' : `${r.leadWeeks} wk`,
                ])}
              />
              <h4 className="mb-1.5 mt-4 text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                Supplier orders
              </h4>
              <Table
                columns={[{ label: 'Supply order' }, { label: 'Supplier' }, { label: 'Against' }]}
                rows={activity.supplyOrders.map((o) => [
                  { text: o.code, className: 'font-semibold text-foreground' },
                  { text: o.supplier, className: 'text-muted-foreground' },
                  { text: o.parentCode, className: 'text-muted-foreground' },
                ])}
              />
            </>
          ) : null}

          {reportId === 'proofing' ? (
            <>
              <Summary text={proofing.summary} />
              <Table
                columns={[
                  { label: 'Order' },
                  { label: 'Client' },
                  { label: 'Proof' },
                  { label: 'Round', align: 'right' },
                  { label: 'State' },
                ]}
                rows={proofing.rows.map((r) => [
                  { text: r.code, className: 'font-semibold text-muted-foreground' },
                  { text: r.client, className: 'font-semibold text-foreground' },
                  r.proof,
                  `v${r.round}`,
                  {
                    text: r.state,
                    className:
                      r.state === 'approved'
                        ? 'font-bold text-success-700'
                        : 'font-bold text-warning-700',
                  },
                ])}
              />
            </>
          ) : null}

          {reportId === 'shipping' ? (
            <>
              <Summary text={shipping.summary} />
              <Table
                columns={[
                  { label: 'Order' },
                  { label: 'Client' },
                  { label: 'Destinations', align: 'right' },
                  { label: 'Planned', align: 'right' },
                  { label: 'Despatched', align: 'right' },
                  { label: 'Outstanding', align: 'right' },
                ]}
                rows={shipping.rows.map((r) => [
                  { text: r.code, className: 'font-semibold text-muted-foreground' },
                  { text: r.client, className: 'font-semibold text-foreground' },
                  r.destinations,
                  r.planned.toLocaleString(),
                  r.despatched.toLocaleString(),
                  {
                    text: r.outstanding ? r.outstanding.toLocaleString() : '—',
                    className: r.outstanding
                      ? 'font-bold text-destructive'
                      : 'text-muted-foreground',
                  },
                ])}
              />
              <p className="mt-2 text-[12px] text-muted-foreground">
                No delivery column: a shipment records a despatch date and a tracking number, and
                nothing in this tenant confirms arrival. Outstanding is planned minus despatched.
              </p>
            </>
          ) : null}

          {reportId === 'aging' ? (
            <>
              <Summary text={aging.summary} />
              <Table
                columns={[
                  { label: 'Order' },
                  { label: 'Client' },
                  { label: 'Stage' },
                  { label: 'In stage', align: 'right' },
                  { label: 'Total age', align: 'right' },
                ]}
                rows={aging.rows.map((r) => [
                  { text: r.code, className: 'font-semibold text-muted-foreground' },
                  { text: r.client, className: 'font-semibold text-foreground' },
                  { text: r.stage, className: 'text-muted-foreground' },
                  {
                    text: r.inStage === null ? '—' : `${r.inStage}d`,
                    className: r.stuck ? 'font-bold text-destructive' : 'text-foreground',
                  },
                  { text: `${r.totalAge}d`, className: 'text-muted-foreground' },
                ])}
              />
            </>
          ) : null}

          {reportId === 'expired' ? (
            <>
              <Summary text={expired.summary} />
              <Table
                columns={[
                  { label: 'Order' },
                  { label: 'Client' },
                  { label: 'Expired' },
                  { label: 'Lived', align: 'right' },
                  { label: 'Target' },
                  { label: 'Committed', align: 'right' },
                  { label: 'Supplier' },
                ]}
                rows={expired.rows.map((r) => [
                  { text: r.code, className: 'font-semibold text-muted-foreground' },
                  { text: r.client, className: 'font-semibold text-foreground' },
                  { text: shortDate(r.expiredOn), className: 'font-bold text-destructive' },
                  {
                    text: r.livedDays === null ? '—' : `${r.livedDays}d`,
                    className: 'text-muted-foreground',
                  },
                  { text: shortDate(r.requestedDelivery), className: 'text-muted-foreground' },
                  {
                    // Committed spend on a dead order is the number worth
                    // reading twice — it is the part somebody has to unwind.
                    text: r.committedMicros ? money(r.committedMicros) : '—',
                    className: r.committedMicros
                      ? 'font-bold text-destructive'
                      : 'text-muted-foreground',
                  },
                  {
                    text: r.suppliers.join(' · ') || 'none',
                    className: 'text-muted-foreground',
                  },
                ])}
              />
            </>
          ) : null}
        </div>
      </div>
      ) : null}
    </div>
  );
}

function Summary({ text }: { text: string }) {
  return (
    <p className="mb-3 text-[13px] text-muted-foreground" data-testid="report-summary">
      {text}
    </p>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </div>
      <div className="text-[17px] font-bold tabular-nums text-foreground">{value}</div>
    </div>
  );
}

/**
 * One cell. A bare value takes the default treatment; the object form is for
 * the cells that carry meaning in their colour — an SLA, a milestone status,
 * a stalled RFE.
 */
type Cell = string | number | { text: string | number; className?: string };

interface Column {
  label: string;
  align?: 'right';
}

/**
 * The report table, in the demo's treatment: a gold header strip on a rounded,
 * bordered card.
 *
 * Colour is set PER CELL rather than per row. The previous version painted the
 * last cell of a flagged row, which happened to be the right column on Pipeline
 * and Shipping and the wrong one everywhere else — At-Risk went red on Owner,
 * Activity on Lead. Naming the cell removes the coincidence.
 */
function Table({ columns, rows }: { columns: Column[]; rows: Cell[][] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-[10px] border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted-foreground">
        Nothing to report.
      </p>
    );
  }
  return (
    <div className="overflow-hidden rounded-[10px] border border-border">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12.5px] tabular-nums">
          <thead>
            <tr className="border-b border-primary-100 bg-primary-50">
              {columns.map((c) => (
                <th
                  key={c.label}
                  className={`px-3.5 py-2.5 text-[10.5px] font-bold uppercase text-primary-700 ${
                    c.align === 'right' ? 'text-right' : 'text-left'
                  }`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-border last:border-b-0 hover:bg-muted/40">
                {r.map((cell, j) => {
                  const rich = typeof cell === 'object' && cell !== null;
                  return (
                    <td
                      key={j}
                      className={`px-3.5 py-2.5 ${columns[j]?.align === 'right' ? 'text-right' : 'text-left'} ${
                        rich ? (cell.className ?? 'text-foreground') : 'text-foreground'
                      }`}
                    >
                      {rich ? cell.text : cell}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Tailwind class per SLA tone, matching the demo's red / amber / green / grey. */
const SLA_CLASS: Record<SlaTone, string> = {
  over: 'font-bold text-destructive',
  watch: 'font-bold text-warning-700',
  ontrack: 'font-bold text-success-700',
  none: 'font-bold text-muted-foreground',
};

/**
 * The stage bars above the pipeline table.
 *
 * Height is scaled to the tallest COUNT, not to value: the bar answers "where
 * are the orders", and scaling by money would collapse every pre-award stage to
 * nothing simply because a price has not been agreed yet. The money sits under
 * the bar as a second figure instead.
 */
function PipelineChart({ stages }: { stages: PipelineStage[] }) {
  if (stages.length === 0) return null;
  const max = Math.max(...stages.map((s) => s.count), 1);
  return (
    /**
     * Fixed-width columns, not `flex-1`.
     *
     * A bar that divides the row between however many stages are OPEN makes its
     * width mean something it does not: with one stage in play the single bar
     * stretched the full width of the card and read as an enormous value, and
     * the same count drew a narrow bar once eight stages were live. The height
     * carries the count; the width is chrome and stays put.
     */
    <div className="mb-4 flex flex-wrap gap-2" data-testid="pipeline-chart">
      {stages.map((s) => (
        <div
          key={s.stage}
          className="w-[4.5rem] shrink-0 text-center"
          data-testid={`pipeline-stage-${s.stage}`}
        >
          <div className="flex h-[4.375rem] items-end justify-center">
            <div
              className="w-[2.75rem] min-h-1.5 rounded-t-md bg-linear-to-b from-primary-300 to-primary-500"
              style={{ height: `${Math.round((s.count / max) * 100)}%` }}
            />
          </div>
          <div className="mt-1.5 text-[16px] font-extrabold tabular-nums text-foreground">
            {s.count}
          </div>
          <div className="text-[11px] font-bold text-muted-foreground">{s.stage}</div>
          <div className="text-[10.5px] tabular-nums text-muted-foreground/70">
            {compactMoney(s.costMicros)}
          </div>
        </div>
      ))}
    </div>
  );
}

/** The same rows the table shows, flattened for the CSV. */
function csvFor(
  id: ReportId,
  r: {
    pipeline: ReturnType<typeof pipelineReport>;
    atRisk: ReturnType<typeof atRiskReport>;
    milestones: ReturnType<typeof milestoneReport>;
    activity: ReturnType<typeof activityReport>;
    proofing: ReturnType<typeof proofingReport>;
    shipping: ReturnType<typeof shippingReport>;
    aging: ReturnType<typeof agingReport>;
    expired: ReturnType<typeof expiredReport>;
  },
): { headers: string[]; rows: Array<Array<string | number | null>> } {
  switch (id) {
    case 'pipeline':
      return {
        headers: ['Order', 'Client', 'Stage', 'Awarded cost', 'Supplier', 'Target', 'Days late'],
        rows: r.pipeline.rows.map((f) => [
          f.code,
          f.client,
          f.stage,
          f.awardedCostMicros / 1_000_000,
          f.suppliers.join(' / '),
          f.requestedDelivery,
          f.daysLate,
        ]),
      };
    case 'atrisk':
      return {
        headers: ['Order', 'Client', 'Why', 'Days', 'Owner'],
        rows: r.atRisk.rows.map((x) => [x.order.code, x.order.client, x.why, x.days, x.order.owner]),
      };
    case 'milestones':
      return {
        headers: ['Order', 'Client', 'Milestone', 'Target', 'Actual', 'Status', 'Owner'],
        rows: r.milestones.rows.map((x) => [
          x.code,
          x.client,
          x.milestone,
          x.target,
          x.actual,
          x.state,
          x.owner,
        ]),
      };
    case 'activity':
      return {
        headers: ['Supplier', 'Order', 'Sent', 'Status', 'Lead weeks', 'Stalled'],
        rows: r.activity.rows.map((x) => [
          x.supplier,
          x.code,
          x.sent,
          x.status,
          x.leadWeeks,
          x.stalled ? 'yes' : 'no',
        ]),
      };
    case 'proofing':
      return {
        headers: ['Order', 'Client', 'Proof', 'Round', 'State'],
        rows: r.proofing.rows.map((x) => [x.code, x.client, x.proof, x.round, x.state]),
      };
    case 'shipping':
      return {
        headers: ['Order', 'Client', 'Destinations', 'Planned', 'Despatched', 'Outstanding'],
        rows: r.shipping.rows.map((x) => [
          x.code,
          x.client,
          x.destinations,
          x.planned,
          x.despatched,
          x.outstanding,
        ]),
      };
    case 'aging':
      return {
        headers: ['Order', 'Client', 'Stage', 'In stage (days)', 'Total age (days)'],
        rows: r.aging.rows.map((x) => [x.code, x.client, x.stage, x.inStage, x.totalAge]),
      };
    case 'expired':
      return {
        headers: [
          'Order',
          'Client',
          'Owner',
          'Expired on',
          'Lived (days)',
          'Requested delivery',
          'Committed cost',
          'Suppliers',
        ],
        rows: r.expired.rows.map((x) => [
          x.code,
          x.client,
          x.owner,
          x.expiredOn,
          x.livedDays,
          x.requestedDelivery,
          // Dollars, not micros — the CSV goes into a spreadsheet.
          x.committedMicros / 1_000_000,
          x.suppliers.join(' / '),
        ]),
      };
  }
}

export default ReportsPage;
