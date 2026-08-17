/**
 * Pure helpers for the Today queue — extracted so they can be unit-tested
 * without rendering React.
 *
 * The row shape mirrors one `task_board` sub-query row (`my_tasks` /
 * `unassigned_tasks`), which the saved query returns as:
 *
 *   { order_code, order_brief, order_type, requested_delivery,
 *     buyer_party_id: { id, name },
 *     tq_instance: { id, assignee{…}, current_task{tq_sub_task_definition{name}},
 *                    current_status{tq_state_definition{state}} } }
 */

/** One row as returned by either `task_board` sub-query. */
export interface TaskBoardRow {
  id?: string;
  order_code?: string;
  order_brief?: string;
  order_type?: string;
  created_at?: string;
  requested_delivery?: string;
  buyer_party_id?: { id?: string; name?: string };
  tq_instance?: {
    id?: string;
    assignee?: { id?: string; email?: string; full_name?: string | null };
    current_task?: { id?: string; tq_sub_task_definition?: { name?: string } };
    current_status?: { id?: string; tq_state_definition?: { state?: string } };
  };
}

/** The `task_board` multi_query result — one key per sub-query. */
export interface TaskBoardResult {
  my_tasks?: TaskBoardRow[];
  unassigned_tasks?: TaskBoardRow[];
}

/** Urgency bucket, driving the dot colour and the SLA pill. */
export type Urgency = 'late' | 'soon' | 'ontrack';

/** Days from `today` until `due` (negative = overdue). Null when unparseable. */
export function daysUntil(
  due: string | undefined | null,
  today: Date,
): number | null {
  if (!due) return null;
  // `requested_delivery` is a date-only string (YYYY-MM-DD). Parsing it with
  // `new Date()` would treat it as UTC midnight and shift the day backwards in
  // negative-offset timezones, so build a LOCAL date from the parts instead.
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(due);
  if (!match) return null;
  const dueLocal = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  if (Number.isNaN(dueLocal.getTime())) return null;
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  return Math.round(
    (dueLocal.getTime() - startOfToday.getTime()) / 86_400_000,
  );
}

/**
 * Terminal stages/states — work that has finished and can no longer be late.
 *
 * The sandbox has real rows sitting in `Order Close`/`Closed` with a due date
 * in the past (e.g. GC-1014, GC-1015). Ranking those as "at risk" purely on
 * the date would put finished work at the top of the queue, so terminal rows
 * are always on track no matter how old the date is.
 */
const TERMINAL_STAGES = new Set(['Order Close']);
const TERMINAL_STATES = new Set(['Closed', 'Cancelled']);

export function isTerminal(
  stage: string | null,
  state: string | null,
): boolean {
  return (
    (stage !== null && TERMINAL_STAGES.has(stage)) ||
    (state !== null && TERMINAL_STATES.has(state))
  );
}

/**
 * Bucket a row by how close its requested delivery is.
 * Overdue → late; within 3 days (inclusive) → soon; otherwise on track.
 * An unknown/missing date is NOT treated as urgent — it's on track, so a
 * missing field can never manufacture a false alarm. Terminal work is never
 * urgent (see `isTerminal`).
 */
export function urgencyOf(days: number | null, terminal = false): Urgency {
  if (terminal) return 'ontrack';
  if (days === null) return 'ontrack';
  if (days < 0) return 'late';
  if (days <= 3) return 'soon';
  return 'ontrack';
}

/** Short SLA label shown in the pill on the right of a row. */
export function slaLabel(days: number | null): string {
  if (days === null) return 'No date';
  if (days < 0) {
    const late = Math.abs(days);
    return late === 1 ? '1 day late' : `${late} days late`;
  }
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  return `${days} days left`;
}

/** `2026-07-29` → `Jul 29`. Falls back to the raw value when unparseable. */
export function shortDate(due: string | undefined | null): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(due ?? '');
  if (!match) return due ?? '—';
  const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Current workflow stage name, e.g. "Produce". */
export function stageOf(row: TaskBoardRow): string | null {
  return row.tq_instance?.current_task?.tq_sub_task_definition?.name ?? null;
}

/** Current workflow state, e.g. "In Production". */
export function stateOf(row: TaskBoardRow): string | null {
  return row.tq_instance?.current_status?.tq_state_definition?.state ?? null;
}

/**
 * The one-line "what is this" text beside the order code.
 * Briefs in this tenant are frequently empty or placeholder, so fall back to
 * the order type rather than rendering a blank.
 */
export function briefOf(row: TaskBoardRow): string {
  const brief = (row.order_brief ?? '').trim();
  if (brief) return brief;
  const type = (row.order_type ?? '').trim();
  return type ? `${type} order` : 'No brief';
}

export function greetingFor(date: Date): string {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** A row decorated with everything the view needs — computed once, in order. */
export interface DecoratedTask {
  key: string;
  orderId: string | undefined;
  code: string;
  buyer: string;
  brief: string;
  stage: string | null;
  state: string | null;
  days: number | null;
  urgency: Urgency;
  sla: string;
  due: string;
  assigneeLabel: string | null;
  terminal: boolean;
}

/**
 * Decorate + sort rows most-urgent first (soonest requested delivery).
 * Rows with no date sort last — they can't be ranked and shouldn't displace
 * dated work from the top of the queue.
 */
export function decorateTasks(
  rows: TaskBoardRow[] | undefined,
  today: Date,
): DecoratedTask[] {
  return (rows ?? [])
    .map((row, index) => {
      const days = daysUntil(row.requested_delivery, today);
      const assignee = row.tq_instance?.assignee;
      const stage = stageOf(row);
      const state = stateOf(row);
      const terminal = isTerminal(stage, state);
      return {
        key: row.id ?? row.order_code ?? `row-${index}`,
        orderId: row.id,
        code: row.order_code ?? '—',
        buyer: row.buyer_party_id?.name ?? 'Unknown buyer',
        brief: briefOf(row),
        stage,
        state,
        days,
        urgency: urgencyOf(days, terminal),
        sla: terminal ? 'Closed' : slaLabel(days),
        due: shortDate(row.requested_delivery),
        assigneeLabel: assignee
          ? (assignee.full_name || assignee.email || null)
          : null,
        terminal,
      };
    })
    .sort((a, b) => {
      if (a.days === null) return b.days === null ? 0 : 1;
      if (b.days === null) return -1;
      return a.days - b.days;
    });
}

/**
 * The queue: work that still needs a decision.
 *
 * Today is a to-do list, not a register — Orders is the register. Finished
 * orders were being listed under "Your open orders that need a decision today"
 * while the footer said "You're all caught up" in the same view, which is a
 * plain contradiction: whichever the reader believed, the other was a lie.
 *
 * Filtered on the finished STATE, not the terminal stage. `isTerminal` also
 * treats the whole `Order Close` stage as terminal, but an order sitting at
 * `Closing` has NOT been filed yet — somebody still has to close it, and that
 * is exactly the kind of decision this queue exists to surface. Only `Closed`
 * and `Cancelled` are actually done.
 */
export function openTasks(tasks: DecoratedTask[]): DecoratedTask[] {
  return tasks.filter((t) => !isFinishedState(t.state));
}

/** Genuinely finished — no further decision is possible on this order. */
export function isFinishedState(state: string | null): boolean {
  return state !== null && TERMINAL_STATES.has(state);
}

/** How many rows are overdue — the "N at risk" chip. */
export function atRiskCount(tasks: DecoratedTask[]): number {
  return tasks.filter((t) => t.urgency === 'late').length;
}

/** Overdue + due within 3 days — the "N need you today" chip. */
export function needsYouCount(tasks: DecoratedTask[]): number {
  return tasks.filter((t) => t.urgency !== 'ontrack').length;
}
