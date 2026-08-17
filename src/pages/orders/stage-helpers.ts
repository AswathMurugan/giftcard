/**
 * Stage-strip helpers.
 *
 * `tq_stage_list` returns the 9 stage definitions UNORDERED (the sandbox
 * returns Quote last, for instance), each carrying `previous_task` /
 * `next_task` links. Order is reconstructed by walking that linked list from
 * the `is_initial` stage — never by array position or by name.
 */

/** One row of `tq_stage_list`. */
export interface StageDefinition {
  id?: string;
  name?: string;
  is_initial?: boolean;
  is_final?: boolean;
  next_task?: { id?: string } | null;
  previous_task?: { id?: string } | null;
  states?: Array<{
    id?: string;
    state?: string;
    is_initial?: boolean;
    is_final?: boolean;
  }>;
}

export type StageStatus = 'done' | 'current' | 'todo' | 'failed';

/**
 * The out-of-chain terminal stage an order lands on when a stage's wait times
 * out. Named here rather than matched inline so the one string that couples
 * the strip to the process definition is visible.
 */
export const EXPIRED_STAGE = 'Expired';

/**
 * Which stage an expired order actually died on.
 *
 * `Expired` is where it ended up, not where it went wrong — the order sat on
 * some real stage waiting for a response that never came, and THAT is the one
 * worth showing as failed. It is the last stage entered before Expired.
 *
 * Returns null when the trail shows no expiry, which is how callers tell a
 * normal order from an expired one.
 */
export function failedStageOf(visitedInOrder: readonly string[]): string | null {
  const end = visitedInOrder.lastIndexOf(EXPIRED_STAGE);
  if (end < 0) return null;
  for (let i = end - 1; i >= 0; i -= 1) {
    if (visitedInOrder[i] !== EXPIRED_STAGE) return visitedInOrder[i];
  }
  return null;
}

export interface OrderedStage {
  id: string;
  name: string;
  status: StageStatus;
  /** Render a connector after this one (i.e. it isn't last). */
  connector: boolean;
}

/**
 * Walk `next_task` from the initial stage.
 *
 * Falls back to input order when there's no `is_initial` row, so a
 * mis-configured process still renders something rather than nothing. The
 * `seen` guard stops a cyclic/self-referencing chain from looping forever.
 */
export function orderStages(rows: StageDefinition[] | undefined): StageDefinition[] {
  const list = (rows ?? []).filter((r) => r && r.id);
  if (list.length === 0) return [];

  const byId = new Map<string, StageDefinition>();
  for (const row of list) byId.set(row.id as string, row);

  const start = list.find((r) => r.is_initial) ?? list[0];
  const ordered: StageDefinition[] = [];
  const seen = new Set<string>();

  let cursor: StageDefinition | undefined = start;
  while (cursor?.id && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    ordered.push(cursor);
    const nextId: string | undefined = cursor.next_task?.id;
    cursor = nextId ? byId.get(nextId) : undefined;
  }

  /**
   * Unreached stages: append only the genuinely STANDALONE ones.
   *
   * `tq_stage_list` is unfiltered and returns every stage definition in the
   * tenant, which was unambiguous while there was one process. There are now
   * two — the demand "Gift Card Order" and the supply "Supplier Order" (PO
   * Acknowledge → PO Production → PO Dispatch) — so a blanket append put the
   * PO stages on the end of every client order's strip.
   *
   * A stage that links to another stage belongs to that other chain, and this
   * walk already covers its own. Only a stage with NO links either side is
   * genuinely standalone and reachable from anywhere — which is exactly what
   * `Expired` is, and why it must still appear here.
   */
  for (const row of list) {
    if (!row.id || seen.has(row.id)) continue;
    const linked = Boolean(row.previous_task?.id || row.next_task?.id);
    if (!linked) ordered.push(row);
  }
  return ordered;
}

/**
 * Has the order reached the LAST state of the stage it is sitting on?
 *
 * A stage is normally shown as finished by the order having moved past it, so
 * the stage that is current is never the stage that is done. That rule cannot
 * finish the LAST stage: nothing follows Order Close to push it into the past,
 * so a delivered, invoiced, closed order still showed a gold "in progress" pip
 * on the step that had actually completed.
 *
 * Stages carry their own states — Order Close runs `Closing` → `Closed` — and
 * the final one of those is the real end. Read from the process definition
 * rather than by matching on the name, so a renamed stage or an extra closing
 * state keeps working.
 */
export function isFinalState(
  rows: StageDefinition[] | undefined,
  stageName: string | null | undefined,
  stateName: string | null | undefined,
): boolean {
  if (!stageName || !stateName) return false;
  const stage = (rows ?? []).find((r) => r.name === stageName);
  return (stage?.states ?? []).some((s) => s.state === stateName && s.is_final);
}

/**
 * Decorate the ordered stages against the order's current stage NAME.
 *
 * Everything before the current stage is `done`, the match is `current`, the
 * rest `todo`. An unknown/absent current stage leaves every stage `todo`
 * rather than guessing a position.
 *
 * The current stage is `done` too once the order reaches that stage's final
 * state — see `isFinalState`. Without the state the behaviour is unchanged,
 * so a caller that has only the stage name still gets a sensible strip.
 *
 * `visitedStageNames` — the stages the order ACTUALLY passed through, read
 * off its state trail — takes over from position when supplied. Position is
 * only a proxy for progress, and it breaks the moment a stage sits outside
 * the linear chain: `Expired` is reachable from anywhere, so it has no
 * `previous_task`/`next_task` and lands last. An order that expired at Specs
 * would then show Quote, Award, Produce, Proof, Ship, Bill and Order Close as
 * finished, having never touched one of them. Membership says what happened;
 * an index only says where the row sits.
 */
export function decorateStages(
  rows: StageDefinition[] | undefined,
  currentStageName: string | null | undefined,
  currentStateName?: string | null,
  visitedStageNames?: Iterable<string>,
): OrderedStage[] {
  const allStages = orderStages(rows);
  const trail = visitedStageNames ? [...visitedStageNames] : null;
  const visited = trail ? new Set(trail) : null;
  // Non-null only when the trail records an expiry.
  const failedStage = trail ? failedStageOf(trail) : null;

  /**
   * `Expired` is shown ONLY on an order that actually expired.
   *
   * It is not a step in the lifecycle — it is an outcome reachable from
   * anywhere, which is why it carries no `previous_task`/`next_task` and sorts
   * last. Rendering it on every order put a permanent dead-end pip after Order
   * Close on healthy orders, implying a stage still to come that will never
   * arrive. A closed order's strip should end at Order Close.
   *
   * It stays visible while the order IS expired (current stage) or its trail
   * records an expiry, so the outcome is never hidden on the orders it applies
   * to.
   */
  const ordered = allStages.filter(
    (s) =>
      s.name !== EXPIRED_STAGE ||
      currentStageName === EXPIRED_STAGE ||
      Boolean(failedStage) ||
      Boolean(visited?.has(EXPIRED_STAGE)),
  );

  const currentIndex = currentStageName
    ? ordered.findIndex((s) => s.name === currentStageName)
    : -1;
  const settled = isFinalState(rows, currentStageName, currentStateName);

  return ordered.map((stage, index) => {
    const name = stage.name ?? '—';
    const isCurrent = currentIndex >= 0 && index === currentIndex;

    let status: StageStatus;
    if (failedStage && name === failedStage) {
      // The stage that ran out of time. Red, not green: nothing about it
      // completed.
      status = 'failed';
    } else if (failedStage && name === EXPIRED_STAGE) {
      // Expiry is an outcome, not an accomplishment — never a success tick.
      // The red pip above already says where the order died.
      status = 'todo';
    } else if (isCurrent) {
      status = settled ? 'done' : 'current';
    } else if (visited) {
      // Reached earlier and moved on. Anything never entered stays `todo`,
      // whatever side of the current stage it sits on.
      status = visited.has(name) ? 'done' : 'todo';
    } else {
      status = currentIndex >= 0 && index < currentIndex ? 'done' : 'todo';
    }

    return {
      id: stage.id as string,
      name,
      status,
      connector: index < ordered.length - 1,
    };
  });
}

/** The states allowed on a named stage — used to label the current step. */
export function statesOfStage(
  rows: StageDefinition[] | undefined,
  stageName: string | null | undefined,
): string[] {
  if (!stageName) return [];
  const stage = (rows ?? []).find((r) => r.name === stageName);
  return (stage?.states ?? [])
    .map((s) => s.state)
    .filter((s): s is string => Boolean(s));
}

/**
 * Resolve which stage owns a given STATE name.
 *
 * Needed because `order_list` projects only
 * `tq_instance.current_status.tq_state_definition.state` — it does NOT select
 * `current_task`, so the stage name simply isn't in that response (unlike
 * `task_board`, which does project it). Every state name is unique to one
 * stage in this process, so the state identifies the stage unambiguously.
 *
 * Returns null for an unknown/missing state rather than guessing.
 */
export function stageOfState(
  rows: StageDefinition[] | undefined,
  stateName: string | null | undefined,
): string | null {
  if (!stateName) return null;
  for (const stage of rows ?? []) {
    if ((stage.states ?? []).some((s) => s.state === stateName)) {
      return stage.name ?? null;
    }
  }
  return null;
}

/**
 * Order codes in this tenant run `GC-1001`, `GC-1002`, … Derive the next one
 * from the highest existing code so a new order slots into the same series
 * rather than colliding. Falls back to `GC-1001` when nothing parses.
 */
export function nextOrderCode(existingCodes: Array<string | undefined>): string {
  let max = 1000;
  for (const code of existingCodes) {
    const match = /^GC-(\d+)$/.exec((code ?? '').trim());
    if (!match) continue;
    const n = Number(match[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `GC-${max + 1}`;
}
