/**
 * Today — the card specialist's queue.
 *
 * Layout matches the Forge demo's TODAY (CS) screen: a centred 880px column,
 * a teal date line over an 800-weight greeting, a scope toggle plus at-risk /
 * needs-you chips on the right, then a stack of full-width order rows (status
 * dot · buyer · code · brief · stage+state · SLA pill · chevron) and a
 * caught-up footer.
 *
 * Forge's palette IS the Phoenix/JiffyAI palette (`--ai` = purple-500,
 * `--red4` = danger-400, `--teal700` = teal-700, `--fg4` = gray-400, …), so
 * every colour below is a design-system utility rather than a literal hex.
 *
 * Data: the `task_board` saved query — one multi_query returning `my_tasks`
 * and `unassigned_tasks` for the signed-in user.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSavedQuerySingle } from '@/hooks';
import { getAuthService } from '@/config/auth-service-manager';
import { Skeleton } from '@/components/ui/skeleton';
import {
  decorateTasks,
  openTasks,
  atRiskCount,
  needsYouCount,
  greetingFor,
  type DecoratedTask,
  type TaskBoardResult,
  type Urgency,
} from './today-helpers';
import { PAGE_CONTAINER } from '@/pages/page-shell';

type Scope = 'mine' | 'unassigned';

/** Status dot — Forge uses red / amber / teal for late / soon / on track. */
const DOT_CLASS: Record<Urgency, string> = {
  late: 'bg-danger-400',
  soon: 'bg-warning-500',
  ontrack: 'bg-teal-500',
};

/** SLA pill — tinted background + strong text, matching Forge's slaColor/slaBg. */
const SLA_CLASS: Record<Urgency, string> = {
  late: 'bg-danger-50 text-danger-500',
  soon: 'bg-warning-50 text-warning-700',
  ontrack: 'bg-muted text-foreground/70',
};

/** Best-effort first name from the Cognito session; empty when unavailable. */
function useDisplayName(): string {
  const [name, setName] = useState('');

  useEffect(() => {
    let cancelled = false;
    void getAuthService()
      .getSession()
      .then((session) => {
        if (cancelled || !session) return;
        const attrs = session.user.attributes ?? {};
        const resolved =
          attrs.given_name ||
          attrs.name ||
          session.user.email?.split('@')[0] ||
          session.user.username;
        if (resolved) setName(resolved);
      })
      .catch(() => {
        /* no session claim for a name — the greeting simply omits it */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return name;
}

function TaskRow({ task }: { task: DecoratedTask }) {
  return (
    <Link
      to={task.orderId ? `/orders/${task.orderId}` : '#'}
      className="flex items-center gap-3.5 rounded-[14px] border border-border bg-card px-4 py-4 shadow-xs transition-shadow hover:shadow-sm"
      data-testid={`today-task-${task.code}`}
    >
      <span
        className={`size-[11px] shrink-0 rounded-full ${DOT_CLASS[task.urgency]}`}
        aria-hidden="true"
      />

      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="text-[15.5px] font-bold text-foreground">{task.buyer}</span>
          <span className="text-xs font-semibold tabular-nums text-muted-foreground/80">
            {task.code}
          </span>
          <span className="text-[13px] text-muted-foreground/70">·</span>
          <span className="truncate text-[13.5px] text-muted-foreground">{task.brief}</span>
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {task.stage ? (
            <span className="text-sm font-semibold text-foreground/90">{task.stage}</span>
          ) : null}
          {task.state ? (
            <span className="inline-flex items-center rounded-full border border-teal-200 bg-teal-50 px-2 py-px text-[12.5px] font-semibold text-teal-700">
              {task.state}
            </span>
          ) : null}
        </div>
      </div>

      <span
        className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-[12.5px] font-bold ${SLA_CLASS[task.urgency]}`}
      >
        {task.sla}
      </span>
      <span className="w-14 shrink-0 text-right text-[12.5px] tabular-nums text-muted-foreground">
        {task.due}
      </span>
      <i
        className="icon icon_-Tb_chevron_right shrink-0 text-[18px] text-muted-foreground/60"
        aria-hidden="true"
      />
    </Link>
  );
}

function ScopeButton({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-3 py-1.5 text-[12.5px] font-bold transition-colors ${
        active
          ? 'bg-card text-foreground shadow-xs'
          : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {label} {count}
    </button>
  );
}

export function TodayPage() {
  const [scope, setScope] = useState<Scope>('mine');
  const userId = getAuthService().getJiffyUserId() ?? '';

  const { data, isLoading, error } = useSavedQuerySingle('task_board', {
    // `task_board` DOES take a `userId` param (its my_tasks sub-query filters
    // `tq_instance.assignee == $userId`), but codegen types composite
    // multi_query inputs as `Record<string, never>` because it can't infer
    // params from the sub-query array. The cast restores the real contract —
    // verified against the live sandbox:
    //   POST /data/saved-queries/task_board/execute?userId=<uuid>
    //     → { my_tasks: [...], unassigned_tasks: [...] }
    input: { userId } as unknown as Record<string, never>,
    // Firing without a userId would return an unfiltered/wrong "my tasks" set.
    enabled: Boolean(userId),
  });
  const isError = Boolean(error);

  const board = (data ?? {}) as TaskBoardResult;

  // One `new Date()` for the whole render so every row is ranked against the
  // same "now" (a per-row clock read could straddle midnight mid-render).
  const today = useMemo(() => new Date(), []);
  // `openTasks` after decorating, not instead of it: the decoration is what
  // knows the state, and the queue is what decides finished work is not a task.
  const mine = useMemo(
    () => openTasks(decorateTasks(board.my_tasks, today)),
    [board.my_tasks, today],
  );
  const unassigned = useMemo(
    () => openTasks(decorateTasks(board.unassigned_tasks, today)),
    [board.unassigned_tasks, today],
  );

  const tasks = scope === 'mine' ? mine : unassigned;
  const atRisk = atRiskCount(tasks);
  const needsYou = needsYouCount(tasks);

  const displayName = useDisplayName();
  const greeting = greetingFor(today);
  const dateLabel = today.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className={PAGE_CONTAINER} data-testid="today-page">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="mb-1.5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-1 text-[13px] font-semibold tracking-[0.02em] text-teal-700">
            {dateLabel}
          </div>
          <h1 className="text-[28px] font-extrabold tracking-[-0.02em] text-foreground">
            {greeting}
            {displayName ? `, ${displayName}` : ''}
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-full border border-border bg-muted p-0.5">
            <ScopeButton
              active={scope === 'mine'}
              label="My items"
              count={mine.length}
              onClick={() => setScope('mine')}
            />
            <ScopeButton
              active={scope === 'unassigned'}
              label="Unassigned"
              count={unassigned.length}
              onClick={() => setScope('unassigned')}
            />
          </div>

          {atRisk > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-danger-200 bg-danger-50 px-3 py-1.5 text-[13px] font-semibold text-danger-500">
              <span className="size-2 rounded-full bg-danger-400" aria-hidden="true" />
              {atRisk} at risk
            </span>
          ) : null}
          <span className="inline-flex items-center rounded-full border border-border bg-card px-3 py-1.5 text-[13px] font-semibold text-muted-foreground">
            {needsYou} need you today
          </span>
        </div>
      </div>

      <p className="mb-6 text-[15px] leading-relaxed text-muted-foreground">
        {scope === 'mine'
          ? 'Your open orders that need a decision today. Sorted by requested delivery.'
          : 'Claimable work with no owner yet. Sorted by requested delivery.'}
      </p>

      {/* ── Queue ──────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[86px] rounded-[14px]" />
          ))}
        </div>
      ) : isError ? (
        <div className="rounded-[14px] border border-danger-200 bg-danger-50 px-4 py-4 text-[14px] text-danger-500">
          Couldn&apos;t load your queue
          {error instanceof Error ? `: ${error.message}` : '.'}
        </div>
      ) : tasks.length === 0 ? (
        <div className="rounded-[14px] border border-border bg-card px-4 py-8 text-center text-[14px] text-muted-foreground">
          {scope === 'mine'
            ? 'Nothing assigned to you right now.'
            : 'No unassigned work in the queue.'}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {tasks.map((task) => (
            <TaskRow key={task.key} task={task} />
          ))}
        </div>
      )}

      {/* ── Footer ─────────────────────────────────────────────── */}
      {!isLoading && !isError && tasks.length > 0 ? (
        <div className="mt-6 flex items-center justify-center gap-2.5 text-[13px] text-muted-foreground">
          <i
            className="icon icon_-Tb_circle_check text-base text-success-400"
            aria-hidden="true"
          />
          {needsYou === 0
            ? "You're all caught up — nothing is due in the next three days."
            : `${needsYou} of ${tasks.length} need a decision in the next three days.`}
        </div>
      ) : null}
    </div>
  );
}

export default TodayPage;
