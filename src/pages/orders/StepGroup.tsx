/**
 * One step inside a stage's chain, as a labelled section.
 *
 * Headings rather than nested collapsibles: the stage block is already a
 * collapsible, and a second layer inside it meant two clicks to reach the live
 * work. Shared by the Quote chain (Deal Review → Allocation → Proposal →
 * Schedule) so the steps cannot drift into looking like different things.
 */
import { STATE_CLASS, STATE_LABEL, type ChainState } from './deal-helpers';

export function StepGroup({
  title,
  state,
  children,
}: {
  title: string;
  state: ChainState;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3" data-testid={`step-group-${title}`}>
      <div className="flex items-center gap-2 border-b border-border pb-1.5">
        <span className="h-[14px] w-[4px] rounded-[2px] bg-purple-500" aria-hidden="true" />
        <h3 className="text-[13px] font-bold text-foreground">{title}</h3>
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${STATE_CLASS[state]}`}
        >
          {STATE_LABEL[state]}
        </span>
      </div>
      {children}
    </section>
  );
}

export default StepGroup;
