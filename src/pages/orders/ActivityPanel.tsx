/**
 * The order's Activity rail.
 *
 * A connected timeline: each entry is an icon in a tinted disc with a hairline
 * running down to the next one, so the eye reads it as one sequence rather
 * than a list of cards. The rail is drawn per-entry (not as one absolute line)
 * so it stops cleanly at the last item however many there are.
 *
 * Every line here is derived from a real record — see `order-activity.ts` for
 * why this is a projection rather than a logged event stream.
 */

import { useMemo } from 'react';
import { useSavedQuerySingle } from '@/hooks';
import { Skeleton } from '@/components/ui/skeleton';
import {
  buildActivity,
  relativeTime,
  activitySourcesFromFeed,
  ACTIVITY_ICON,
  type ActivityKind,
  type ActivitySources,
} from './order-activity';

/**
 * Tint per kind. Supplier traffic is the accent — those are the entries a
 * buyer is scanning for — while stage transitions stay neutral so a long
 * order does not read as a wall of gold.
 */
const TONE: Record<ActivityKind, string> = {
  created: 'bg-muted text-muted-foreground',
  stage: 'bg-teal-50 text-teal-700',
  rfe_sent: 'bg-muted text-muted-foreground',
  quote_received: 'bg-primary-50 text-primary-700',
  // Client moments carry the accent too — a signature is the other thing a
  // buyer scans this rail for.
  proposal_sent: 'bg-muted text-muted-foreground',
  proposal_signed: 'bg-primary-50 text-primary-700',
  proposal_declined: 'bg-destructive/10 text-destructive',
  proof_requested: 'bg-muted text-muted-foreground',
  proof_uploaded: 'bg-muted text-muted-foreground',
  proof_decided: 'bg-primary-50 text-primary-700',
};

export interface ActivityPanelProps extends ActivitySources {
  loading?: boolean;
  /** Injected so the relative stamps are deterministic in tests. */
  now?: number;
  /**
   * Self-loading mode. Pass BOTH ids and the panel fetches everything itself
   * through the `order_activity_feed` composite — for screens that don't
   * already hold the order's rows (a standalone activity view, a client-facing
   * timeline). Omit them and the panel renders whatever sources the caller
   * passes, which is what the order workspace does: its rows are already in
   * flight for the stage strip and the RFE table, so fetching again would mean
   * two copies of the same data that can disagree after a refetch.
   */
  orderId?: string;
  instanceId?: string;
}

export function ActivityPanel({
  loading,
  now,
  orderId,
  instanceId,
  order,
  history,
  rfes,
  quotes,
}: ActivityPanelProps) {
  const selfLoading = Boolean(orderId && instanceId);

  // Hooks cannot be conditional, so this always runs and is gated by `enabled`
  // — inert in supplied mode.
  const feed = useSavedQuerySingle('order_activity_feed', {
    input: { orderId: orderId ?? '', instanceId: instanceId ?? '' },
    enabled: selfLoading,
  });

  // Depends on the four sources individually rather than on a rest object: a
  // rest object is a fresh identity every render, which would re-derive the
  // whole timeline on every paint. The arrays themselves come from React Query
  // and stay referentially stable between refetches.
  const sources = useMemo(
    () =>
      selfLoading ? activitySourcesFromFeed(feed.data) : { order, history, rfes, quotes },
    [selfLoading, feed.data, order, history, rfes, quotes],
  );
  const busy = loading || (selfLoading && feed.isLoading);
  const entries = useMemo(() => buildActivity(sources), [sources]);
  // Read once per render rather than per row, so every stamp in one paint is
  // measured from the same instant.
  const asOf = now ?? Date.now();

  /**
   * A full-height companion rail.
   *
   * No card border or radius: the rail IS the page edge — its own left border
   * comes from the aside that holds it (see OrderWorkspacePage), so drawing a
   * second boxed edge here would read as a panel floating inside a panel.
   *
   * The heading is pinned and only the timeline scrolls, so "Activity" and
   * what it means stay readable however far down a long order you are.
   */
  return (
    <section
      className="flex h-full min-h-0 flex-col overflow-hidden"
      data-testid="order-activity"
    >
      <div className="flex shrink-0 flex-col gap-1 px-6 pb-4 pt-8">
        <div className="flex items-center gap-2.5">
          <i
            className="icon icon_-Tb_history text-[1.25rem] text-foreground"
            aria-hidden="true"
          />
          <h2 className="text-[1.0625rem] font-bold text-foreground">Activity</h2>
        </div>
        <p className="text-[0.8125rem] text-muted-foreground">
          Every recorded action, logged for audit.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8">
      {busy ? (
        <div className="flex flex-col gap-3" data-testid="order-activity-loading">
          <Skeleton className="h-12 rounded-lg" />
          <Skeleton className="h-12 rounded-lg" />
          <Skeleton className="h-12 rounded-lg" />
        </div>
      ) : entries.length === 0 ? (
        <p className="text-[0.875rem] text-muted-foreground" data-testid="order-activity-empty">
          Nothing has happened on this order yet.
        </p>
      ) : (
        <ol className="flex flex-col">
          {entries.map((entry, index) => {
            const last = index === entries.length - 1;
            return (
              <li
                key={entry.id}
                className="flex gap-3"
                data-testid={`activity-row-${entry.kind}`}
                data-row-key={entry.id}
              >
                {/* Icon + the rail beneath it, as one column. */}
                <div className="flex flex-col items-center">
                  <span
                    className={`flex size-8 shrink-0 items-center justify-center rounded-full ${TONE[entry.kind]}`}
                  >
                    <i
                      className={`icon ${ACTIVITY_ICON[entry.kind]} text-[1.125rem]`}
                      aria-hidden="true"
                    />
                  </span>
                  {!last ? <span className="w-px flex-1 bg-border" aria-hidden="true" /> : null}
                </div>

                <div className={last ? 'pb-0' : 'pb-6'}>
                  <p className="text-[0.9375rem] font-semibold text-foreground">{entry.title}</p>
                  <p className="text-[0.8125rem] text-muted-foreground">
                    {/* The machine-readable instant stays in the DOM even
                        though the eye gets the relative form. */}
                    <time dateTime={entry.at}>{relativeTime(entry.at, asOf)}</time>
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      </div>
    </section>
  );
}

export default ActivityPanel;
