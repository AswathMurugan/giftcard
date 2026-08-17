/**
 * Lifecycle strip — the demo's stage bar.
 *
 * A bordered 12px-radius bar of 20px pips joined by hairline connectors:
 * done = green check, current = gold dot, todo = hairline outline. Scrolls
 * horizontally rather than wrapping, so the nine stages stay on one line.
 */
import type { OrderedStage } from './stage-helpers';

export function StagePip({ stage }: { stage: OrderedStage }) {
  const isDone = stage.status === 'done';
  const isCurrent = stage.status === 'current';
  // The stage whose wait ran out. Red, and never a check — it did not finish.
  const isFailed = stage.status === 'failed';

  return (
    <div className="flex shrink-0 items-center">
      <div className="flex items-center gap-2">
        <span
          className={[
            'grid size-5 shrink-0 place-items-center rounded-full border-[1.5px]',
            isFailed
              ? 'border-destructive bg-destructive text-white'
              : isDone
                ? 'border-success-500 bg-success-500 text-white'
                : isCurrent
                  ? 'border-primary-500 bg-primary-500 text-white'
                  : 'border-line-strong bg-card',
          ].join(' ')}
        >
          {isFailed ? (
            <i className="icon icon_-Tb_x text-[12px]" aria-hidden="true" />
          ) : isDone ? (
            <i className="icon icon_-Tb_check text-[12px]" aria-hidden="true" />
          ) : (
            <span
              className={[
                'block size-1.5 rounded-full',
                isCurrent ? 'bg-white' : 'bg-muted-foreground/40',
              ].join(' ')}
              aria-hidden="true"
            />
          )}
        </span>
        <span
          className={[
            'whitespace-nowrap text-[12.5px]',
            isFailed
              ? 'font-bold text-destructive'
              : isDone
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

export function StageStrip({
  stages,
  action,
}: {
  stages: OrderedStage[];
  /** Pinned to the right of the strip — outside the horizontal scroll, so it
   *  stays reachable however many stages the process carries. */
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3.5">
      <div className="flex min-w-0 flex-1 items-center overflow-x-auto">
        {stages.map((stage) => (
          <StagePip key={stage.id} stage={stage} />
        ))}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
