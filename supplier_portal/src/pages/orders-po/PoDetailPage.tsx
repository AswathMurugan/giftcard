/**
 * One purchase order, in full.
 *
 * The list screen answers "what needs me next"; this one answers "what exactly
 * am I building, how much of it, where does it go, and where are we". Acting
 * here fires the same SIGNAL the list does — the `create_supplier_order`
 * workflow owns every TQ write, from whichever screen the supplier is on.
 */
import { useCallback, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { useSavedQuerySingle, useSavedQueryList } from '@/hooks';
import { PAGE_CONTAINER } from '@/pages/page-shell';
import { useSupplierSession } from '@/pages/_shared/supplier-session';
import { asNumber } from '@/lib/runtime';
import type {
  SupplierPoDetailRow,
  SupplierPoParentsRow,
  SupplierParentVolumeRow,
} from '@/types/saved-queries.generated';
import { signalPo } from './po-api';
import {
  decoratePoDetail,
  explainSignalFailure,
  splitNote,
  type PoDetail,
  type PoMilestone,
} from './po-detail-helpers';

function shortDate(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.parse(iso.length <= 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(ms)) return '—';
  return new Date(ms).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function money(v: number | null): string {
  if (v === null || Number.isNaN(v)) return '—';
  return `$${v.toFixed(3)}`;
}

/** The state, in the colour that matches how urgent it is. */
function StateBadge({ detail }: { detail: PoDetail }) {
  if (detail.done) return <Badge variant="secondary">Shipped</Badge>;
  if (detail.state === 'PO Raised')
    return (
      <Badge variant="outline" className="border-primary-500 text-primary-600">
        Awaiting acknowledgment
      </Badge>
    );
  return <Badge variant="outline">{detail.state}</Badge>;
}

function Milestones({ items }: { items: PoMilestone[] }) {
  return (
    <ol className="flex flex-col" data-testid="po-milestones">
      {items.map((m, i) => (
        <li key={m.label} className="flex gap-3" data-testid={`milestone-${m.label}`}>
          <div className="flex flex-col items-center">
            <span
              aria-hidden="true"
              className={[
                'mt-1 size-2.5 shrink-0 rounded-full',
                m.status === 'done'
                  ? 'bg-success-500'
                  : m.status === 'current'
                    ? 'bg-primary-500'
                    : 'border border-border bg-background',
              ].join(' ')}
            />
            {i < items.length - 1 ? <span className="my-1 w-px flex-1 bg-border" /> : null}
          </div>
          <div className="pb-4">
            <p
              className={[
                'text-[13px]',
                m.status === 'ahead' ? 'text-muted-foreground' : 'font-semibold text-foreground',
              ].join(' ')}
            >
              {m.label}
            </p>
            <p className="text-[11.5px] text-muted-foreground">
              {m.date ? `${shortDate(m.date)} · ` : ''}
              {m.note}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function PoDetailPage() {
  const { poId = '' } = useParams();
  const { supplierId } = useSupplierSession();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const packet = useSavedQuerySingle('supplier_po_detail', {
    input: { poId },
    enabled: Boolean(poId),
  });

  // The parent map also carries the client's own delivery date, which is what
  // makes a split visible without ever naming the other supplier.
  const parents = useSavedQueryList('supplier_po_parents', {
    input: { supplierId },
    enabled: Boolean(supplierId),
  });

  const detail = useMemo(
    () => decoratePoDetail((packet.data ?? null) as SupplierPoDetailRow | null),
    [packet.data],
  );

  const relation = useMemo(
    () =>
      ((parents.data ?? []) as SupplierPoParentsRow[]).find(
        (r) => r.child_order?.id === poId,
      ) ?? null,
    [parents.data, poId],
  );

  /**
   * The client's whole volume, so a split can be named.
   *
   * Gated on the parent id, which only arrives once `supplier_po_parents` has
   * resolved — until then the note is simply absent rather than wrong.
   */
  const parentId = relation?.parent_order?.id ?? '';
  const parentVolume = useSavedQueryList('supplier_parent_volume', {
    input: { orderId: parentId },
    enabled: Boolean(parentId),
  });

  const parentQty = useMemo(() => {
    const rows = (parentVolume.data ?? []) as SupplierParentVolumeRow[];
    if (rows.length === 0) return null;
    return rows.reduce((sum, r) => sum + (asNumber(r.qty) ?? 0), 0);
  }, [parentVolume.data]);

  const handleAdvance = useCallback(async () => {
    if (!detail?.instanceId || !detail.next) return;
    setBusy(true);
    setProblem(null);
    try {
      await signalPo(detail.instanceId);
      // The workflow writes the new state; re-read rather than guess it.
      packet.refetch();
      /**
       * Report the ACTION, not a predicted state.
       *
       * `detail.next.toState` is this component's guess at where the workflow
       * will land, read from data captured before the refetch — so the toast
       * could announce "PO Ready to Ship" while the badge beside it already
       * said "Shipped". The workflow owns the state; the portal only knows
       * what it asked for.
       */
      toast.success(`${detail.code} — ${detail.next.label.toLowerCase()} sent`, {
        testId: 'toast-po-advanced',
      });
    } catch (error) {
      setProblem(explainSignalFailure(error));
    } finally {
      setBusy(false);
    }
  }, [detail, packet]);

  if (packet.isLoading) {
    return (
      <div className={PAGE_CONTAINER}>
        <Skeleton className="mb-4 h-10 w-72" />
        <Skeleton className="h-52 rounded-xl" />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className={PAGE_CONTAINER} data-testid="po-detail-missing">
        <p className="text-[14px] font-semibold text-foreground">Purchase order not found</p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          It may belong to another supplier.{' '}
          <Link to="/orders" className="font-semibold text-primary-600 underline">
            Back to Orders
          </Link>
        </p>
      </div>
    );
  }

  const split = splitNote(detail.totalQty, parentQty);

  return (
    <div className={PAGE_CONTAINER} data-testid="po-detail-page">
      <Link to="/orders" className="text-[12.5px] font-semibold text-primary-600">
        ← Orders
      </Link>

      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="mt-3 rounded-xl border border-border bg-card px-4 py-3.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-[22px] font-extrabold tracking-[-0.01em] text-foreground">
            {detail.code}
          </h1>
          {detail.parentCode ? (
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-[12px] text-muted-foreground"
              data-testid="po-parent-chip"
            >
              <i className="icon icon_-Tb_link text-[1.125rem]" aria-hidden="true" />
              from Forge {detail.parentCode}
            </span>
          ) : null}
          <StateBadge detail={detail} />
        </div>
        <p className="mt-1.5 text-[15px] font-bold text-foreground">
          {detail.clientName ? `${detail.clientName} · ` : ''}
          {detail.totalQty.toLocaleString()} units
        </p>
        <p className="mt-1 text-[13px] text-muted-foreground">{detail.brief}</p>
        {split ? (
          <p
            className="mt-1.5 flex items-center gap-1.5 text-[12.5px] text-muted-foreground"
            data-testid="po-split-note"
          >
            <i className="icon icon_-Tb_git_branch text-[1.125rem]" aria-hidden="true" />
            {split}
          </p>
        ) : null}
      </div>

      {/* ── Specs + milestones ───────────────────────────────────────── */}
      <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_20rem]">
        <div className="rounded-xl border border-border bg-card px-4 py-3.5">
          <h2 className="text-[13px] font-bold text-foreground">Specs &amp; quantity</h2>

          {detail.lines.length === 0 ? (
            <p className="mt-3 text-[13px] text-muted-foreground">
              No lines on this order yet.
            </p>
          ) : (
            detail.lines.map((line) => (
              <div
                key={line.id}
                className="mt-3 border-t border-border pt-3 first:mt-2 first:border-0 first:pt-0"
                data-testid={`po-line-${line.name}`}
              >
                <p className="text-[13px] font-semibold text-foreground">{line.name}</p>

                {line.chips.length === 0 ? (
                  <p className="mt-2 text-[12.5px] text-muted-foreground">
                    No spec sheet attached to this line.
                  </p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {line.chips.map((c) => (
                      <span
                        key={c.key}
                        title={c.label}
                        data-testid={`spec-chip-${c.key}`}
                        className="rounded-md border border-border px-2 py-1 text-[12px] text-foreground"
                      >
                        {c.value}
                      </span>
                    ))}
                  </div>
                )}

                <div className="mt-3 flex flex-wrap gap-8">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                      Your quantity
                    </p>
                    <p className="text-[19px] font-extrabold tabular-nums text-foreground">
                      {line.qty.toLocaleString()} {line.uom}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                      Your unit price
                    </p>
                    <p className="text-[19px] font-extrabold tabular-nums text-foreground">
                      {money(line.unitPrice)}
                    </p>
                  </div>
                  {detail.destinations.length > 0 ? (
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                        Ship to
                      </p>
                      <p className="text-[13px] font-semibold text-foreground">
                        {detail.destinations.map((d) => d.destination).join(' · ')}
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="rounded-xl border border-border bg-card px-4 py-3.5">
          <h2 className="mb-3 text-[13px] font-bold text-foreground">Milestones</h2>
          <Milestones items={detail.milestones} />
        </div>
      </div>

      {/* ── Destinations ─────────────────────────────────────────────── */}
      {detail.destinations.length > 0 ? (
        <div className="mt-3 rounded-xl border border-border bg-card px-4 py-3.5">
          <h2 className="text-[13px] font-bold text-foreground">Destinations</h2>
          <div className="mt-2 flex flex-col gap-2">
            {detail.destinations.map((d) => (
              <div
                key={d.id}
                data-testid={`po-destination-${d.destination}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2"
              >
                <div>
                  <p className="text-[12.5px] font-semibold text-foreground">{d.destination}</p>
                  <p className="text-[11.5px] text-muted-foreground">
                    {d.tracking
                      ? `${d.carrier ?? 'Carrier'} ${d.tracking} · shipped ${shortDate(d.shipDate)}`
                      : `planned ${shortDate(d.plannedDate)}`}
                  </p>
                </div>
                <span className="text-[12px] tabular-nums text-muted-foreground">
                  {d.shippedQty.toLocaleString()} / {d.qty.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* ── The one action ───────────────────────────────────────────── */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3.5">
        <p className="text-[13px] text-foreground">
          {detail.next
            ? detail.next.blurb
            : detail.done
              ? 'This order is complete. Nothing further is expected.'
              : 'Nothing outstanding on your side.'}
        </p>
        {detail.next ? (
          <Button
            data-testid="po-advance"
            aria-busy={busy}
            disabled={busy || !detail.instanceId}
            onClick={handleAdvance}
          >
            <i className="icon icon_-Tb_check text-[1.25rem]" aria-hidden="true" />
            {detail.next.label}
          </Button>
        ) : null}
      </div>

      {problem ? (
        <p className="mt-2 text-[12.5px] text-destructive" role="alert">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

export default PoDetailPage;
