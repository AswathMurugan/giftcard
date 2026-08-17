/**
 * The supplier's purchase orders, and what they can do next.
 *
 * Supply orders run their own three-stage process — PO Acknowledge →
 * PO Production → PO Dispatch — separate from the nine-stage demand process a
 * client's order runs through. They are PO-prefixed because
 * `tq_sub_task_add` resolves a sub-task by name with `limit 1` across the
 * whole tenant: a stage called plain "Produce" would collide with the demand
 * process and silently advance the wrong thing.
 *
 * Pure functions, no DOM — the vitest environment here is `node`.
 */
import { asText } from '@/lib/runtime';
import type { SupplierPoListRow } from '@/types/saved-queries.generated';

/** The supply-order lifecycle, in order. */
export const PO_STAGES = ['PO Acknowledge', 'PO Production', 'PO Dispatch'] as const;

/**
 * What the supplier is being asked to do at each state, and what happens when
 * they do it. `null` means the ball is not in their court.
 *
 * Keyed by STATE rather than stage because a stage has two states — arriving
 * at PO Production is not the same as having finished it.
 */
export const NEXT_ACTION: Record<
  string,
  { label: string; toStage: string; toState: string; blurb: string } | null
> = {
  'PO Raised': {
    label: 'Acknowledge order',
    toStage: 'PO Acknowledge',
    toState: 'PO Acknowledged',
    blurb: 'Confirm you have the order and will produce it.',
  },
  'PO Acknowledged': {
    label: 'Start production',
    toStage: 'PO Production',
    toState: 'PO In Production',
    blurb: 'Move the order onto the press.',
  },
  'PO In Production': {
    label: 'Mark produced',
    toStage: 'PO Production',
    toState: 'PO Produced',
    blurb: 'Cards are made and ready to pack.',
  },
  'PO Produced': {
    label: 'Ready to ship',
    toStage: 'PO Dispatch',
    toState: 'PO Ready to Ship',
    blurb: 'Packed and waiting on a carrier.',
  },
  'PO Ready to Ship': {
    label: 'Mark shipped',
    toStage: 'PO Dispatch',
    toState: 'PO Shipped',
    blurb: 'Despatched — this closes the order.',
  },
  'PO Shipped': null,
};

export interface PoRow {
  id: string;
  code: string;
  /** The demand order this PO was raised against, e.g. GC-1002 from GC-1002-PO1. */
  parentCode: string;
  brief: string;
  requestedDelivery: string | null;
  instanceId: string | null;
  stage: string;
  state: string;
  /** Position in PO_STAGES, or -1 when the stage is unknown. */
  stageIndex: number;
  done: boolean;
  next: (typeof NEXT_ACTION)[string];
}

/**
 * A PO code is its parent plus a suffix — `GC-1002-PO1`. Deriving the parent
 * by trimming the suffix avoids a second query purely to show which client
 * order the work belongs to.
 */
export function parentOf(code: string): string {
  const m = /^(.*)-PO\d+$/.exec(code);
  return m ? m[1] : code;
}

export function decoratePos(rows: SupplierPoListRow[] | undefined): PoRow[] {
  return (rows ?? [])
    .filter((r) => r.id)
    .map((r) => {
      const code = asText(r.order_code) || '—';
      const stage = asText(r.tq_instance?.current_task?.tq_sub_task_definition?.name);
      const state = asText(r.tq_instance?.current_status?.tq_state_definition?.state);
      return {
        id: r.id as string,
        code,
        parentCode: parentOf(code),
        brief: asText(r.order_brief) || 'No brief',
        requestedDelivery: r.requested_delivery ?? null,
        instanceId: r.tq_instance?.id ?? null,
        stage: stage || '—',
        state: state || 'Unknown',
        stageIndex: PO_STAGES.indexOf(stage as (typeof PO_STAGES)[number]),
        // Read off the process definition rather than matching on the name, so
        // renaming the last state does not quietly leave orders looking open.
        done: r.tq_instance?.current_status?.tq_state_definition?.is_final === true &&
          stage === 'PO Dispatch',
        next: NEXT_ACTION[state] ?? null,
      } satisfies PoRow;
    });
}

/** POs still needing something from the supplier. */
export function openCount(rows: PoRow[]): number {
  return rows.filter((r) => r.next !== null).length;
}
