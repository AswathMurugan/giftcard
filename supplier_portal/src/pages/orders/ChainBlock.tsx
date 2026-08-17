/**
 * One step of a stage chain, as a collapsible block.
 *
 * Shared by the Quote decision chain (Deal Review / Allocation / Proposal) and
 * the fulfilment stages (Award / Produce / Proof / Ship / Bill). Both are
 * SEQUENCES: only one step is ever the work, and the rest are either a record
 * of what was decided or a preview of what is coming. Kept in one place so the
 * two never drift into behaving differently — an operator walks straight from
 * one into the other.
 *
 * A shut block still opens on click, and its header carries the outcome, so
 * collapsing never hides the answer — only the detail behind it.
 */
import { STATE_CLASS, STATE_LABEL, type ChainState } from './deal-helpers';

/**
 * One step of the chain as a collapsible block.
 *
 * The active step is open and the rest are shut, because the chain is a
 * SEQUENCE: only one step is ever the work, and the others are either a
 * record of what was decided or a preview of what is coming. Showing all
 * three expanded made the page a wall in which the live task was the hardest
 * thing to find. A shut block still opens on click — looking back at the deal
 * while allocating is normal, and hiding it outright would be worse.
 */
export function ChainBlock({
  title,
  state,
  summary,
  open,
  onToggle,
  children,
}: {
  title: string;
  state: ChainState;
  summary: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`overflow-hidden rounded-xl border bg-card ${
        state === 'current' ? 'border-teal-200' : 'border-border'
      }`}
      data-testid={`chain-block-${title}`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={`${open ? 'Collapse' : 'Expand'} ${title}`}
        data-testid={`chain-block-toggle-${title}`}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
      >
        <i
          className={`icon icon_-Tb_chevron_right text-[1.125rem] text-muted-foreground transition-transform ${
            open ? 'rotate-90' : ''
          }`}
          aria-hidden="true"
        />
        <span className="text-[13.5px] font-bold text-foreground">{title}</span>
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${STATE_CLASS[state]}`}
          data-testid={`chain-block-state-${title}`}
        >
          {STATE_LABEL[state]}
        </span>
        <span className="ml-auto truncate text-[12px] text-muted-foreground">{summary}</span>
      </button>
      {open ? <div className="flex flex-col gap-4 border-t border-border p-4">{children}</div> : null}
    </div>
  );
}
