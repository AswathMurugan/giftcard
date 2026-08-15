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

export type StageStatus = 'done' | 'current' | 'todo';

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

  // Any stage not reachable from the head (broken link) still gets shown,
  // appended in input order, so the strip never silently drops a stage.
  for (const row of list) {
    if (row.id && !seen.has(row.id)) ordered.push(row);
  }
  return ordered;
}

/**
 * Decorate the ordered stages against the order's current stage NAME.
 *
 * Everything before the current stage is `done`, the match is `current`, the
 * rest `todo`. An unknown/absent current stage leaves every stage `todo`
 * rather than guessing a position.
 */
export function decorateStages(
  rows: StageDefinition[] | undefined,
  currentStageName: string | null | undefined,
): OrderedStage[] {
  const ordered = orderStages(rows);
  const currentIndex = currentStageName
    ? ordered.findIndex((s) => s.name === currentStageName)
    : -1;

  return ordered.map((stage, index) => ({
    id: stage.id as string,
    name: stage.name ?? '—',
    status:
      currentIndex < 0
        ? 'todo'
        : index < currentIndex
          ? 'done'
          : index === currentIndex
            ? 'current'
            : 'todo',
    connector: index < ordered.length - 1,
  }));
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
