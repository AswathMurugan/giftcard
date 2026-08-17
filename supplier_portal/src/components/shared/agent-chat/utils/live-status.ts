/**
 * The live status line's label.
 *
 * One line that swaps in place ("Thinking…" → "Listing apps…" → "Reading
 * file…") rather than a growing list of steps — completed work collapses into
 * the "Used N tools" disclosure once the turn finishes.
 */
import type { ProgressTodo } from './humanize';

export const IDLE_STATUS_LABEL = 'Thinking';

/**
 * The label to show right now: the latest IN-PROGRESS tool, else the backend's
 * status text, else the idle label.
 *
 * Only in-progress steps count — once a tool ticks to completed it stops
 * driving the label, so a finished step never sits there reading as live.
 */
export function deriveStatusLabel(
  statusText: string,
  toolSteps: ProgressTodo[],
): string {
  for (let i = toolSteps.length - 1; i >= 0; i -= 1) {
    if (toolSteps[i].status === 'in_progress') return toolSteps[i].content;
  }
  return statusText || IDLE_STATUS_LABEL;
}
