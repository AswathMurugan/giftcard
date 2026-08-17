/**
 * One chat bubble — user or assistant, with the turn's tool steps and any tool
 * failures.
 *
 * Built from the starter's own primitives + design tokens (DESIGN.md): no
 * hard-coded colours, `rounded-lg` surfaces, 4-pt spacing, borders for
 * separation rather than shadows.
 *
 * Agent replies render as markdown (tables, lists, code); the user's own text is
 * shown verbatim so a message containing `*` or `|` isn't mangled.
 * See AGENT-CHAT.md.
 */
import { memo, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ChatMessage, MessageAction } from './hooks/agent-chat-reducer';
import type { ProgressTodo } from './utils/humanize';
import { AttachmentCard } from './AttachmentCard';
import { chipListMaxHeight, collapsedChipLayout } from './utils/chip-overflow';
import './markdown-body.css';

/**
 * GFM is what enables TABLES (plus strikethrough, task lists, autolinks) —
 * none of those are in base CommonMark, and agents lean on tables heavily.
 * Hoisted to a module constant so the array identity is stable across renders.
 */
const MARKDOWN_PLUGINS = [remarkGfm];

/**
 * One step marker. Completed is a gold FILLED circle with a white check;
 * active is a gold arc; pending a faint hollow ring.
 */
function StepMarker({ status }: { status: ProgressTodo['status'] }) {
  if (status === 'completed') {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <i className="icon icon_-Tb_check text-[0.875rem]" aria-hidden="true" />
      </span>
    );
  }
  if (status === 'in_progress') {
    return (
      <span
        className="size-5 shrink-0 animate-spin rounded-full border-2 border-primary-100 border-t-primary"
        aria-hidden="true"
      />
    );
  }
  return (
    <span
      className="size-5 shrink-0 rounded-full border-2 border-grayscale-300"
      aria-hidden="true"
    />
  );
}

/**
 * The turn's tool activity, collapsed under a "Generated N steps" summary.
 *
 * Header: a clipboard glyph + label on the left, a down-chevron on the right
 * (rotates 180° when open). The WHOLE header row toggles.
 */
function UsedTools({ steps }: { steps: ProgressTodo[] }) {
  const [open, setOpen] = useState(false);
  if (steps.length === 0) return null;

  return (
    // Full-width across the chat window. Only the HEADER carries the grey pill
    // fill; the expanded step rows sit on the plain chat background beneath it
    // (platform parity — the steps are NOT inside the grey band).
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="my-1.5 self-stretch"
    >
      <CollapsibleTrigger
        aria-label={open ? 'Hide steps' : 'Show steps'}
        className="flex w-full items-center gap-2.5 rounded-3xl bg-grayscale-100 px-4 py-2.5 text-left"
      >
        <i
          className="icon icon_-Tb_clipboard_text shrink-0 text-[1.125rem] text-grayscale-700"
          aria-hidden="true"
        />
        {/* grayscale-700 — a step below body text, so the disclosure reads as
            secondary chrome rather than competing with the answer. */}
        <span className="flex-1 text-sm font-medium text-grayscale-700">
          Generated {steps.length} {steps.length === 1 ? 'step' : 'steps'}
        </span>
        <i
          className={cn(
            'icon icon_-Tb_chevron_down shrink-0 text-[1.125rem] text-grayscale-600',
            'transition-transform duration-150',
            open && 'rotate-180',
          )}
          aria-hidden="true"
        />
      </CollapsibleTrigger>

      {/* Rows sit on the plain chat background below the pill — no fill, no
          borders. Left inset (pl-4) aligns the marker under the header label. */}
      <CollapsibleContent>
        <ul className="flex flex-col gap-3 px-4 pb-1 pt-3">
          {steps.map((step, i) => (
            <li key={i} className="flex items-start gap-2.5">
              {/* mt-0.5 sits the marker on the first line of wrapping step
                  text (paths/filenames wrap), matching the platform. */}
              <span className="mt-0.5 flex shrink-0">
                <StepMarker status={step.status} />
              </span>
              {/* The gold marker alone signals the active step — labels stay a
                  subtle grey, dimmer still while pending. */}
              <span
                className={cn(
                  'text-[0.9375rem] leading-[1.3]',
                  step.status === 'pending' ? 'text-grayscale-400' : 'text-grayscale-700',
                )}
              >
                {step.content}
              </span>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Structured tool failures reported during the turn. */
function ToolErrors({ errors }: { errors: NonNullable<ChatMessage['toolErrors']> }) {
  if (errors.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-col gap-1">
      {errors.map((e, i) => (
        <li
          key={i}
          className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1.5"
          role="alert"
        >
          <i
            className="icon icon_-Tb_alert_circle mt-0.5 shrink-0 text-[1.125rem] text-destructive"
            aria-hidden="true"
          />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-xs text-foreground">
              {e.tool} failed{e.errorCode ? ` (${e.errorCode})` : ''}
            </span>
            {e.message && (
              <span className="break-words text-[0.6875rem] text-muted-foreground">
                {e.message}
              </span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Read-only pills under a reply — the agent naming the things it is talking
 * about (the fields still missing, the documents it read). Not interactive: the
 * choices are the buttons below.
 *
 * Design: the reference's `.aichat-badge` — warning-tinted pill, 13px/600,
 * 2px×10px, fully rounded, 8px gaps, in a `2px 0 4px` band. It reads as "these
 * are outstanding", which is why it is warning and not the accent.
 */
/** Chip row metrics — 3 rows of pills plus the 2 gaps between them. */
const CHIP_ROW = '1.625rem';
const CHIP_GAP = '0.5rem';
const CHIP_MAX_ROWS = 3;
const CHIP_COLLAPSED_HEIGHT =
  `calc(${CHIP_MAX_ROWS} * ${CHIP_ROW} + ${CHIP_MAX_ROWS - 1} * ${CHIP_GAP})`;

function MessageChips({ chips }: { chips: string[] }) {
  const listRef = useRef<HTMLUListElement>(null);
  const [expanded, setExpanded] = useState(false);
  // Kept while expanded because the full-height list naturally has no clipping;
  // it is recalculated whenever the collapsed layout changes.
  const [layout, setLayout] = useState<{ maxHeight: number; hiddenCount: number } | null>(null);

  useEffect(() => {
    const el = listRef.current;
    if (!el || expanded) return undefined;
    const measure = () => {
      const listTop = el.getBoundingClientRect().top;
      const items = Array.from(el.children, (child) => {
        const rect = child.getBoundingClientRect();
        return { top: rect.top - listTop, bottom: rect.bottom - listTop };
      });
      setLayout(collapsedChipLayout(items, CHIP_MAX_ROWS));
    };
    // Both callbacks are asynchronous, avoiding a synchronous state write in
    // the effect while still measuring the first paint and later panel resizes.
    const frame = requestAnimationFrame(measure);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [chips, expanded]);

  const maxHeight = chipListMaxHeight(expanded, layout, CHIP_COLLAPSED_HEIGHT);

  return (
    <div className="my-0.5 flex flex-col items-start gap-1.5">
      <ul
        ref={listRef}
        role="list"
        className="flex flex-wrap gap-2 overflow-hidden"
        style={maxHeight === undefined ? undefined : { maxHeight }}
      >
        {chips.map((chip, index) => (
          <li
            key={`${chip}-${index}`}
            data-testid={`chat-chip-${chip}`}
            className="inline-flex items-center gap-[0.3125rem] rounded-full border border-warning-200 bg-warning-50 px-2.5 py-0.5 text-[0.8125rem] font-semibold text-warning-600"
          >
            {chip}
          </li>
        ))}
      </ul>
      {(layout?.hiddenCount ?? 0) > 0 && (
        <button
          type="button"
          data-testid="chat-chips-toggle"
          aria-expanded={expanded}
          aria-label={expanded ? 'Show fewer items' : `Show all ${chips.length} items`}
          onClick={() => setExpanded((open) => !open)}
          className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-[0.8125rem] font-semibold text-primary-600 hover:bg-primary-50"
        >
          {!expanded && <span>{`+${layout?.hiddenCount ?? 0}`}</span>}
          <i
            className={cn(
              'icon text-[1.125rem]',
              expanded ? 'icon_-Tb_chevron_up' : 'icon_-Tb_chevron_down',
            )}
            aria-hidden="true"
          />
        </button>
      )}
    </div>
  );
}

/**
 * The choices the agent offered with a turn.
 *
 * Design: the reference's `.aichat-choice` — white, primary-500 hairline,
 * primary-600 label at 16px/700, 8px×16px in a 10px radius capped at 40px tall,
 * 12px apart, cream on hover.
 */
function MessageActions({
  actions,
  onAction,
}: {
  actions: MessageAction[];
  onAction?: (action: MessageAction) => void;
}) {
  return (
    <div className="my-1.5 flex flex-row flex-wrap items-center gap-3">
      {actions.map((action) => (
        <Button
          key={action.id}
          type="button"
          variant="tertiary"
          data-testid={`chat-action-${action.id}`}
          onClick={() => onAction?.(action)}
          className="h-[2.5rem] rounded-[0.625rem] border-primary-500 bg-background px-4 py-2 text-[1rem] font-bold text-primary-600 hover:border-primary-500 hover:bg-primary-50"
        >
          {action.label}
        </Button>
      ))}
    </div>
  );
}

export const AgentChatMessage = memo(function AgentChatMessage({
  message,
  onAction,
  showToolSteps = true,
}: {
  message: ChatMessage;
  /** Fired when one of `message.actions` is clicked. */
  onAction?: (action: MessageAction) => void;
  /** Show the "Generated N steps" disclosure. Off for a chat whose audience
   *  doesn't care how the answer was produced. */
  showToolSteps?: boolean;
}) {
  const isUser = message.role === 'user';

  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'flex min-w-0 flex-col gap-2',
          // The agent's column spans the chat width so the full-width steps
          // disclosure can stretch across it; the user's hugs its bubble.
          isUser ? 'max-w-full items-end' : 'w-full items-start',
        )}
      >
        {/* Attachments sit ABOVE the bubble as a SIBLING, not inside it — the
            cards are full-width tiles while the text bubble hugs its content,
            so nesting them would stretch the bubble to the card's width. */}
        {message.attachments && message.attachments.length > 0 && (
          <ul className="flex flex-col gap-2" role="list">
            {message.attachments.map((a) => (
              <li key={a.id}>
                {/* Same card as the composer tray, always 'ready' (it was sent)
                    and non-removable. */}
                <AttachmentCard filename={a.filename} />
              </li>
            ))}
          </ul>
        )}

        {/* The user's turn is a bordered grey bubble with the top-RIGHT corner
            squared off where it meets the edge. The agent's is bare text on the
            panel — no bubble, no fill. */}
        <div
          className={cn(
            'max-w-full break-words',
            isUser && 'rounded-[0.625rem] rounded-tr-none border border-input bg-muted px-5 py-3.5',
          )}
        >
          {/* The user's own text is shown verbatim — rendering it as markdown
              would mangle anything containing *, _, # or a pipe. Only the
              AGENT's reply is markdown (it authors it deliberately). */}
          {isUser ? (
            <p className="whitespace-pre-wrap break-words text-base leading-[1.375rem] text-foreground">
              {message.content}
            </p>
          ) : (
            <div className="markdown-body break-words">
              <ReactMarkdown remarkPlugins={MARKDOWN_PLUGINS}>
                {message.content}
              </ReactMarkdown>
            </div>
          )}
        </div>

        {/* Chips + choices the agent attached to this turn (see
            `AgentChat.parseExtras`). Siblings of the bubble, so they span the
            agent's full column instead of stretching the text bubble. */}
        {message.chips && message.chips.length > 0 && <MessageChips chips={message.chips} />}
        {message.actions && message.actions.length > 0 && (
          <MessageActions actions={message.actions} onAction={onAction} />
        )}

        {message.toolErrors && <ToolErrors errors={message.toolErrors} />}
        {showToolSteps && message.toolSteps && <UsedTools steps={message.toolSteps} />}
      </div>
    </div>
  );
});
