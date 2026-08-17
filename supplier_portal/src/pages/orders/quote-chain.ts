/**
 * Quote-stage decision chain.
 *
 * The Quote stage is the only one with real internal structure. Its eight
 * states (from `tq_stage_list`) are a linear run of three decision steps, each
 * an enter/complete pair, bracketed by the stage's own open and close:
 *
 *   Quote Requested
 *     → Deal Review  → Deal Review Completed
 *     → Allocation   → Allocation Completed
 *     → Proposal     → Proposal Completed
 *   → Quote Approved
 *
 * That maps onto the demo's "Decision chain" strip: one card per step, each
 * showing whether it is still pending, in progress, or settled.
 */

/** Quote's states in workflow order. Index = how far the stage has run. */
export const QUOTE_STATE_ORDER = [
  'Quote Requested',
  'Deal Review',
  'Deal Review Completed',
  'Allocation',
  'Allocation Completed',
  'Proposal',
  'Proposal Completed',
  'Quote Approved',
] as const;

export type ChainStatus = 'pending' | 'current' | 'approved';

export interface ChainStep {
  name: string;
  /** Nucleo glyph class. */
  icon: string;
  status: ChainStatus;
  /** One-line explanation of where this step stands. */
  detail: string;
}

interface StepSpec {
  name: string;
  icon: string;
  enter: string;
  done: string;
  pendingDetail: string;
  currentDetail: string;
  doneDetail: string;
}

const STEP_SPECS: StepSpec[] = [
  {
    name: 'Deal Review',
    icon: 'icon_-Tb_calculator',
    enter: 'Deal Review',
    done: 'Deal Review Completed',
    pendingDetail: 'Not run yet',
    currentDetail: 'Margin under review',
    doneDetail: 'Margin cleared',
  },
  {
    name: 'Allocation',
    icon: 'icon_-Tb_arrow_guide',
    enter: 'Allocation',
    done: 'Allocation Completed',
    pendingDetail: 'Awaiting deal review',
    currentDetail: 'Splitting across suppliers',
    doneDetail: 'Allocated',
  },
  {
    name: 'Proposal',
    icon: 'icon_-Tb_file_dollar',
    enter: 'Proposal',
    done: 'Proposal Completed',
    pendingDetail: 'Awaiting allocation',
    currentDetail: 'Priced, ready to send',
    doneDetail: 'Sent to client',
  },
];

/** Position of a state in the Quote run, or -1 when it isn't a Quote state. */
export function quoteStateIndex(state: string | null | undefined): number {
  if (!state) return -1;
  return (QUOTE_STATE_ORDER as readonly string[]).indexOf(state);
}

/**
 * Build the three decision-chain cards for the Quote stage.
 *
 * `stageName` decides the baseline: before Quote every step is pending, after
 * Quote every step is settled. Within Quote, each step is compared against the
 * current state's position — so a step whose `done` state has been passed
 * reads as approved even though the stage has moved on.
 */
export function buildQuoteChain(
  stageName: string | null | undefined,
  stateName: string | null | undefined,
  stageOrder: string[],
): ChainStep[] {
  const quoteIndex = stageOrder.indexOf('Quote');
  const currentStageIndex = stageName ? stageOrder.indexOf(stageName) : -1;

  // The order hasn't reached Quote yet → nothing decided.
  if (quoteIndex >= 0 && currentStageIndex >= 0 && currentStageIndex < quoteIndex) {
    return STEP_SPECS.map((spec) => ({
      name: spec.name,
      icon: spec.icon,
      status: 'pending' as ChainStatus,
      detail: spec.pendingDetail,
    }));
  }

  // Past Quote → every step settled.
  if (quoteIndex >= 0 && currentStageIndex > quoteIndex) {
    return STEP_SPECS.map((spec) => ({
      name: spec.name,
      icon: spec.icon,
      status: 'approved' as ChainStatus,
      detail: spec.doneDetail,
    }));
  }

  const position = quoteStateIndex(stateName);
  return STEP_SPECS.map((spec) => {
    const enterAt = quoteStateIndex(spec.enter);
    const doneAt = quoteStateIndex(spec.done);
    if (position < 0 || position < enterAt) {
      return {
        name: spec.name,
        icon: spec.icon,
        status: 'pending' as ChainStatus,
        detail: spec.pendingDetail,
      };
    }
    if (position >= doneAt) {
      return {
        name: spec.name,
        icon: spec.icon,
        status: 'approved' as ChainStatus,
        detail: spec.doneDetail,
      };
    }
    return {
      name: spec.name,
      icon: spec.icon,
      status: 'current' as ChainStatus,
      detail: spec.currentDetail,
    };
  });
}
