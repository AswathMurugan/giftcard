/**
 * One order, in full, for the client who placed it.
 *
 * Built to the Vista reference: the CARD is the subject, so the page is titled
 * with the card's name and the order code is demoted to the meta line. The body
 * is a narrative rather than a progress bar — a status timeline down the left
 * saying what actually happened, with proofs, documents and shipments beside it.
 *
 * Everything here is theirs: their card, their price, their documents, their
 * decisions. Nothing about who is making it or what it costs us.
 */
import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useSavedQuerySingle } from '@/hooks';
import { PAGE_CONTAINER } from '@/pages/page-shell';
import type { ClientOrderDetailRow } from '@/types/saved-queries.generated';
import { CertificateLink } from '@/pages/_shared/CertificateLink';
import { formatUsd } from '@/pages/approvals/approval-helpers';
import {
  decorateOrderDetail,
  type OrderDetail,
  type TimelineStep,
} from './order-detail-helpers';

function shortDate(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.parse(iso.length <= 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(ms)) return '—';
  return new Date(ms).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** The card as a tile. An empty frame when there is no artwork — see below. */
function CardThumb({ detail }: { detail: OrderDetail }) {
  if (detail.artworkPreview) {
    return (
      <img
        src={detail.artworkPreview}
        alt={`${detail.cardName} artwork`}
        className="h-14 w-[5.5rem] shrink-0 rounded-md border border-border object-cover"
        data-testid="order-artwork"
      />
    );
  }
  // Deliberately not a stock image: an empty frame reads as "still being
  // designed", which is true, whereas a placeholder card would not be.
  return (
    <div
      className="flex h-14 w-[5.5rem] shrink-0 items-center justify-center rounded-md border border-dashed border-border bg-muted/40 px-1 text-center text-[10px] font-bold uppercase leading-tight tracking-[0.04em] text-muted-foreground"
      data-testid="order-artwork-pending"
    >
      Artwork pending
    </div>
  );
}

/** The narrative down the left: what happened, in order, with a caption each. */
function StatusTimeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <ol className="mt-3 flex flex-col" data-testid="status-timeline">
      {steps.map((step, i) => (
        <li key={step.label} className="flex gap-3" data-testid={`timeline-${step.label}`}>
          <div className="flex flex-col items-center">
            <span
              aria-hidden="true"
              className={[
                'mt-1 size-2.5 shrink-0 rounded-full',
                step.status === 'done'
                  ? 'bg-primary-500'
                  : step.status === 'current'
                    ? 'border-2 border-primary-500 bg-background'
                    : 'border border-border bg-background',
              ].join(' ')}
            />
            {i < steps.length - 1 ? <span className="my-1 w-px flex-1 bg-border" /> : null}
          </div>
          <div className="pb-5">
            <p
              className={[
                'text-[13px]',
                step.status === 'ahead'
                  ? 'font-semibold text-muted-foreground'
                  : 'font-bold text-foreground',
              ].join(' ')}
            >
              {step.label}
            </p>
            <p className="text-[12px] text-muted-foreground">{step.caption}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function OrderDetailPage() {
  const { orderId = '' } = useParams();

  const packet = useSavedQuerySingle('client_order_detail', {
    input: { orderId },
    enabled: Boolean(orderId),
  });

  const detail = useMemo(
    () => decorateOrderDetail((packet.data ?? null) as ClientOrderDetailRow | null),
    [packet.data],
  );

  if (packet.isLoading) {
    return (
      <div className={PAGE_CONTAINER}>
        <Skeleton className="mb-4 h-14 w-80" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className={PAGE_CONTAINER} data-testid="order-detail-missing">
        <p className="text-[14px] font-semibold text-foreground">Order not found</p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          It may belong to another account.{' '}
          <Link to="/my-orders" className="font-semibold text-primary-600 underline">
            Back to My Orders
          </Link>
        </p>
      </div>
    );
  }

  const healthClass =
    detail.health === 'late'
      ? 'text-destructive'
      : detail.health === 'expired'
        ? 'text-muted-foreground'
        : 'text-success-600';

  return (
    <div className={PAGE_CONTAINER} data-testid="order-detail-page">
      <Link
        to="/my-orders"
        className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-primary-600"
      >
        <i className="icon icon_-Tb_arrow_left text-[1.125rem]" aria-hidden="true" />
        My Orders
      </Link>

      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <CardThumb detail={detail} />
          <div className="min-w-0">
            <h1 className="text-[22px] font-extrabold tracking-[-0.01em] text-foreground">
              {detail.cardName}
            </h1>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              {detail.code} · {detail.totalQty.toLocaleString()} units · Target{' '}
              {shortDate(detail.requestedDelivery)} ·{' '}
              <span className={`font-bold ${healthClass}`}>{detail.healthLabel}</span>
            </p>
            <div className="mt-1.5">
              {detail.expired ? (
                <Badge variant="destructive">Expired</Badge>
              ) : detail.done ? (
                <Badge variant="secondary">Complete</Badge>
              ) : (
                <Badge variant="outline" data-testid="order-stage-badge">
                  {detail.clientStage}
                </Badge>
              )}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {/* The reference offers Message / Schedule / Reorder. Only the ones
              with a real destination are rendered — a dead "Message" button on
              a portal whose promise is "no email required" would be worse than
              its absence, and there is no reorder flow to send them to yet. */}
          <Button variant="outline" size="sm" asChild data-testid="order-open-proofs">
            <Link to="/proofs">
              <i className="icon icon_-Tb_photo_check text-[1.125rem]" aria-hidden="true" />
              Proofs
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild data-testid="order-open-approvals">
            <Link to="/approvals">
              <i className="icon icon_-Tb_writing_sign text-[1.125rem]" aria-hidden="true" />
              Approvals
            </Link>
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_22rem]">
        {/* ── Status timeline ────────────────────────────────────────── */}
        <div className="rounded-xl border border-border bg-card px-4 py-3.5">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
            Status timeline
          </h2>
          <StatusTimeline steps={detail.timeline} />
        </div>

        <div className="flex flex-col gap-3">
          {/* ── Proofs ───────────────────────────────────────────────── */}
          <div className="rounded-xl border border-border bg-card px-4 py-3.5">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
              Proofs
            </h2>
            {detail.proofs.length === 0 ? (
              <p className="mt-2 text-[13px] text-muted-foreground">
                No artwork has been sent for your approval yet.
              </p>
            ) : (
              <div className="mt-2 flex flex-col">
                {detail.proofs.map((p) => (
                  <Link
                    key={p.id}
                    to="/proofs"
                    data-testid={`detail-proof-r${p.round}`}
                    className="flex items-center justify-between gap-3 border-b border-border py-2.5 last:border-0 hover:bg-muted/30"
                  >
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-foreground">
                        {p.proofType} · v{p.round}
                      </p>
                      <p className="text-[11.5px] text-muted-foreground">
                        {p.awaitingYou
                          ? 'Awaiting your approval'
                          : p.status === 'approved'
                            ? 'Approved by you'
                            : p.status === 'rejected'
                              ? 'Changes requested'
                              : p.status}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {p.status === 'approved' ? (
                        <i
                          className="icon icon_-Tb_circle_check text-[1.125rem] text-success-600"
                          aria-hidden="true"
                        />
                      ) : null}
                      <i
                        className="icon icon_-Tb_chevron_right text-[1.125rem] text-muted-foreground"
                        aria-hidden="true"
                      />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* ── Documents ────────────────────────────────────────────── */}
          <div className="rounded-xl border border-border bg-card px-4 py-3.5">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
              Documents
            </h2>
            {detail.documents.length === 0 ? (
              <p className="mt-2 text-[13px] text-muted-foreground">
                No proposal has been issued to you yet.
              </p>
            ) : (
              <div className="mt-2 flex flex-col gap-2">
                {detail.documents.map((d) => (
                  <div
                    key={d.id}
                    data-testid={`detail-doc-v${d.version}`}
                    className="flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-foreground">
                        Proposal · v{d.version}
                      </p>
                      <p className="text-[11.5px] text-muted-foreground">
                        {d.acceptedAt
                          ? `signed ${shortDate(d.acceptedAt)}`
                          : `issued ${shortDate(d.sentAt)}`}{' '}
                        · {formatUsd(d.totalSell)}
                      </p>
                    </div>
                    {d.status === 'accepted' ? (
                      <Badge variant="secondary">Signed</Badge>
                    ) : (
                      <Badge variant="outline">{d.status}</Badge>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Shipments ────────────────────────────────────────────── */}
          <div className="rounded-xl border border-border bg-card px-4 py-3.5">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
              Shipments
            </h2>
            <p className="mt-2 text-[13px] text-muted-foreground">
              {/* Tracking hangs off the SUPPLY order, which DynQL cannot reach
                  from the demand order in one hop — so this states the rule
                  rather than showing an empty table it cannot fill. */}
              {detail.done
                ? 'Despatched — your account team holds the tracking detail.'
                : 'Ships after proof approval & production.'}
            </p>
          </div>
        </div>
      </div>

      {/* ── Your decisions ───────────────────────────────────────────── */}
      <div className="mt-3 rounded-xl border border-border bg-card px-4 py-3.5">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
          Your decisions
        </h2>
        {detail.events.length === 0 ? (
          <p className="mt-2 text-[13px] text-muted-foreground">
            Nothing signed off yet. Approvals and proof sign-offs are recorded here with the
            date you made them.
          </p>
        ) : (
          <ol className="mt-2 flex flex-col gap-2">
            {detail.events.map((e) => (
              <li
                key={e.id}
                data-testid={`detail-event-${e.id}`}
                className="flex items-start justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-[12.5px] font-semibold text-foreground">
                    {e.what}{' '}
                    <span className="font-normal text-muted-foreground">
                      · {shortDate(e.when)}
                    </span>
                  </p>
                  <p className="text-[11.5px] text-muted-foreground">{e.detail}</p>
                  {e.signedBy ? (
                    <p className="text-[11.5px] text-muted-foreground">signed by {e.signedBy}</p>
                  ) : null}
                </div>
                <CertificateLink
                  certificate={e.certificate}
                  label="Certificate"
                  testId={`event-certificate-${e.id}`}
                />
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

export default OrderDetailPage;
