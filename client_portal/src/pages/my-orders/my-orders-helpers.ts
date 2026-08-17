/**
 * Translating Fiserv's process into the client's.
 *
 * Forge runs nine internal stages — Order, Specs, Quote, Award, Produce,
 * Proof, Ship, Bill, Order Close. A client should not see most of them:
 * "Quote" and "Award" are us shopping their work to suppliers, and naming
 * that on their screen invites a conversation about our margin. Several
 * internal stages collapse into one thing the client actually recognises.
 *
 * Pure functions, no DOM — the vitest environment here is `node`.
 */
import { asText } from '@/lib/runtime';
import type { ClientOrderListRow } from '@/types/saved-queries.generated';

export interface ClientStage {
  label: string;
  blurb: string;
  /** Internal stage names that map to this client-facing step. */
  from: string[];
}

/**
 * Five steps, in order. Everything commercial folds into "Preparing" — the
 * client's question there is "has it started", not "who is making it".
 */
export const CLIENT_STAGES: ClientStage[] = [
  {
    label: 'Received',
    blurb: 'We have your order',
    from: ['Order'],
  },
  {
    label: 'Design',
    blurb: 'Artwork being set up',
    from: ['Specs'],
  },
  {
    label: 'Preparing',
    blurb: 'Getting it ready to print',
    from: ['Quote', 'Award'],
  },
  {
    label: 'In production',
    blurb: 'Being made and proofed',
    from: ['Produce', 'Proof'],
  },
  {
    label: 'On its way',
    blurb: 'Shipping and invoicing',
    from: ['Ship', 'Bill', 'Order Close'],
  },
];

/** The terminal state an order reaches when a stage's wait ran out. */
export const EXPIRED_STATE = 'Expired';

export interface ClientOrderRow {
  id: string;
  code: string;
  brief: string;
  requestedDelivery: string | null;
  /** The client-facing step name, not Forge's. */
  clientStage: string;
  blurb: string;
  stageIndex: number;
  done: boolean;
  expired: boolean;
}

/** Which client-facing step an internal stage belongs to; -1 when unknown. */
export function clientStageIndexOf(internalStage: string): number {
  return CLIENT_STAGES.findIndex((s) => s.from.includes(internalStage));
}

export function decorateClientOrders(
  rows: ClientOrderListRow[] | undefined,
): ClientOrderRow[] {
  return (rows ?? [])
    .filter((r) => r.id)
    .map((r) => {
      const internal = asText(r.tq_instance?.current_task?.tq_sub_task_definition?.name);
      const state = asText(r.tq_instance?.current_status?.tq_state_definition?.state);
      const expired = state === EXPIRED_STATE;
      const index = clientStageIndexOf(internal);
      const stage = index >= 0 ? CLIENT_STAGES[index] : null;
      return {
        id: r.id as string,
        code: asText(r.order_code) || '—',
        brief: asText(r.order_brief) || 'No description',
        requestedDelivery: r.requested_delivery ?? null,
        clientStage: expired ? 'Expired' : (stage?.label ?? 'In progress'),
        blurb: expired
          ? 'This order lapsed — raise a new one'
          : (stage?.blurb ?? 'With your account team'),
        stageIndex: index,
        // Complete only at the END of the last stage, not on arriving at it —
        // an order sitting in Order Close is still being closed.
        done:
          !expired &&
          internal === 'Order Close' &&
          r.tq_instance?.current_status?.tq_state_definition?.is_final === true,
        expired,
      } satisfies ClientOrderRow;
    });
}
