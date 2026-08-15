/**
 * Reports — the demo's seven views, over this tenant's own data.
 *
 * A chooser of report cards, then one report at a time with Save / Schedule /
 * Export beside its title, exactly as the demo lays it out. Every figure is
 * computed in `report-helpers` from `report_board`; nothing here is seeded.
 *
 * Scope: the demo toggles My orders / Team off a person's org position. This
 * tenant has no owner on an order — `created_by.full_name` comes back null on
 * every row — so the toggle is All / Active clients instead, which is a
 * distinction the data can actually make. Filtering by an owner nobody has
 * recorded would have produced two identical tables and a false impression
 * that the scope worked.
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
  atRiskReport,
  milestoneReport,
  money,
  orderFacts,
  pipelineReport,
  proofingReport,
  shippingReport,
  toCsv,
  type ReportBoard,
  type ReportId,
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

  const [reportId, setReportId] = useState<ReportId>('pipeline');
  const [activeOnly, setActiveOnly] = useState(false);

  const data = board.data as ReportBoard | null;
  const stages = (stageList.data ?? []) as StageDefinition[];

  // One clock for the whole screen: two panels a millisecond apart must not
  // disagree about whether something is overdue.
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const facts = useMemo(() => orderFacts(data, stages, today), [data, stages, today]);
  const scoped = useMemo(
    () => (activeOnly ? facts.filter((f) => f.open) : facts),
    [facts, activeOnly],
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

  const current = REPORTS.find((r) => r.id === reportId) ?? REPORTS[0];

  /** Build the CSV for whatever is on screen and hand it to the browser. */
  function handleExport() {
    const { headers, rows } = csvFor(reportId, {
      pipeline,
      atRisk,
      milestones,
      activity,
      proofing,
      shipping,
      aging,
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
      <p className="mb-4 mt-1 text-[15px] text-muted-foreground">
        Every figure is read from this tenant's orders, plans, RFEs, proofs and shipments — nothing
        here is illustrative.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-lg border border-border">
          <button
            type="button"
            data-testid="scope-all"
            onClick={() => setActiveOnly(false)}
            className={`px-3 py-1.5 text-[12.5px] font-semibold ${
              !activeOnly ? 'bg-muted text-foreground' : 'bg-card text-muted-foreground'
            }`}
          >
            All orders
          </button>
          <button
            type="button"
            data-testid="scope-open"
            onClick={() => setActiveOnly(true)}
            className={`px-3 py-1.5 text-[12.5px] font-semibold ${
              activeOnly ? 'bg-muted text-foreground' : 'bg-card text-muted-foreground'
            }`}
          >
            Open only
          </button>
        </div>
        <span className="text-[12.5px] text-muted-foreground">
          {scoped.length} order{scoped.length === 1 ? '' : 's'} in scope
        </span>
      </div>

      {/* The chooser. */}
      <div className="mb-5 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {REPORTS.map((r) => (
          <button
            key={r.id}
            type="button"
            data-testid={`report-card-${r.id}`}
            onClick={() => setReportId(r.id)}
            className={`flex flex-col gap-1 rounded-xl border p-3 text-left transition-colors ${
              r.id === reportId
                ? 'border-primary-500 bg-primary-50/40'
                : 'border-border bg-card hover:bg-muted/40'
            }`}
          >
            <span className="flex items-center gap-2">
              <i className={`icon ${r.icon} text-[16px] text-primary-600`} aria-hidden="true" />
              <span className="text-[13px] font-bold text-foreground">{r.title}</span>
            </span>
            <span className="text-[11.5px] text-muted-foreground">{r.sub}</span>
          </button>
        ))}
      </div>

      {/* The report. */}
      <div className="rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
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
              <Summary text={pipeline.summary} />
              <div className="mb-3 flex flex-wrap gap-2">
                {pipeline.stages.map((s) => (
                  <div
                    key={s.stage}
                    className="rounded-lg border border-border px-3 py-2"
                    data-testid={`pipeline-stage-${s.stage}`}
                  >
                    <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                      {s.stage}
                    </div>
                    <div className="text-[15px] font-bold tabular-nums text-foreground">{s.count}</div>
                    <div className="text-[11.5px] tabular-nums text-muted-foreground">
                      {money(s.costMicros)}
                    </div>
                  </div>
                ))}
              </div>
              <Table
                headers={['Order', 'Client', 'Stage', 'Awarded cost', 'Supplier', 'Target', 'SLA']}
                rows={pipeline.rows.map((f) => [
                  f.code,
                  f.client,
                  f.stage,
                  f.awardedCostMicros ? money(f.awardedCostMicros) : '—',
                  f.suppliers.join(', ') || '—',
                  f.requestedDelivery ?? '—',
                  f.daysLate > 0 ? `${f.daysLate}d over` : 'on time',
                ])}
                danger={pipeline.rows.map((f) => f.daysLate > 0)}
              />
            </>
          ) : null}

          {reportId === 'atrisk' ? (
            <>
              <Summary text={atRisk.summary} />
              <Table
                headers={['Order', 'Client', 'Why', 'Days', 'Owner']}
                rows={atRisk.rows.map((r) => [
                  r.order.code,
                  r.order.client,
                  r.why,
                  `${r.days}d`,
                  r.order.owner,
                ])}
                danger={atRisk.rows.map(() => true)}
              />
            </>
          ) : null}

          {reportId === 'milestones' ? (
            <>
              <Summary
                text={`${milestones.onTimePct === null ? '—' : `${milestones.onTimePct}% on time`} · ${milestones.summary}`}
              />
              <Table
                headers={['Order', 'Client', 'Milestone', 'Target', 'Actual', 'Status', 'Owner']}
                rows={milestones.rows.map((r) => [
                  r.code,
                  r.client,
                  r.milestone,
                  r.target,
                  r.actual,
                  r.state,
                  r.owner,
                ])}
                stateColumn={5}
                stateStyle={STATE_STYLE}
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
                headers={['Supplier', 'Order', 'Sent', 'Status', 'Lead']}
                rows={activity.rows.map((r) => [
                  r.supplier,
                  r.code,
                  r.sent,
                  r.status,
                  r.leadWeeks === null ? '—' : `${r.leadWeeks} wk`,
                ])}
                danger={activity.rows.map((r) => r.stalled)}
              />
              <h4 className="mb-1.5 mt-4 text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                Supplier orders
              </h4>
              <Table
                headers={['Supply order', 'Supplier', 'Against']}
                rows={activity.supplyOrders.map((o) => [o.code, o.supplier, o.parentCode])}
              />
            </>
          ) : null}

          {reportId === 'proofing' ? (
            <>
              <Summary text={proofing.summary} />
              <Table
                headers={['Order', 'Client', 'Proof', 'Round', 'State']}
                rows={proofing.rows.map((r) => [r.code, r.client, r.proof, `v${r.round}`, r.state])}
              />
            </>
          ) : null}

          {reportId === 'shipping' ? (
            <>
              <Summary text={shipping.summary} />
              <Table
                headers={['Order', 'Client', 'Destinations', 'Planned', 'Despatched', 'Outstanding']}
                rows={shipping.rows.map((r) => [
                  r.code,
                  r.client,
                  r.destinations,
                  r.planned.toLocaleString(),
                  r.despatched.toLocaleString(),
                  r.outstanding ? r.outstanding.toLocaleString() : '—',
                ])}
                danger={shipping.rows.map((r) => r.outstanding > 0)}
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
                headers={['Order', 'Client', 'Stage', 'In stage', 'Total age']}
                rows={aging.rows.map((r) => [
                  r.code,
                  r.client,
                  r.stage,
                  r.inStage === null ? '—' : `${r.inStage}d`,
                  `${r.totalAge}d`,
                ])}
                danger={aging.rows.map((r) => r.stuck)}
              />
            </>
          ) : null}
        </div>
      </div>
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

function Table({
  headers,
  rows,
  danger,
  stateColumn,
  stateStyle,
}: {
  headers: string[];
  rows: Array<Array<string | number>>;
  /** Per-row: paint it as a problem. */
  danger?: boolean[];
  /** Column index whose value is a state name to colour. */
  stateColumn?: number;
  stateStyle?: Record<string, string>;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted-foreground">
        Nothing to report.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12.5px]">
        <thead>
          <tr className="border-b border-border">
            {headers.map((h) => (
              <th
                key={h}
                className="px-2 py-1.5 text-left text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border last:border-b-0">
              {r.map((cell, j) => (
                <td
                  key={j}
                  className={`px-2 py-1.5 tabular-nums ${
                    j === stateColumn && stateStyle
                      ? (stateStyle[String(cell)] ?? 'text-foreground')
                      : danger?.[i] && j === r.length - 1
                        ? 'font-semibold text-destructive'
                        : 'text-foreground'
                  }`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
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
  }
}

export default ReportsPage;
