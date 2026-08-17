/**
 * The chat window: header, history list, message thread, live progress, status
 * banners, and the composer.
 *
 * Presentational — every piece of state arrives via props.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { DOCK_MENU_ITEMS, DOCK_TRIGGER_ICON, type DockMode } from './dock-mode';
import type { AgentMetadata } from './agent-metadata';
import type { UseAgentChatResult } from './hooks/use-agent-chat';
import type { MessageAction } from './hooks/agent-chat-reducer';
import type { UseChatSessionsReturn } from './hooks/use-chat-sessions';
import type { AgentChatIcons } from './appearance';
import {
  groupSessions,
  hasVisibleUserMessage,
  sessionLabel,
  formatRelativeTime,
  withActiveGhost,
} from './utils/session-groups';
import { deriveStatusLabel, IDLE_STATUS_LABEL } from './utils/live-status';
import { scrollPinAfterScroll } from './utils/scroll-position';
import { AgentChatMessage } from './AgentChatMessage';
import { AgentChatInput, type PendingAttachment } from './AgentChatInput';

export interface AgentChatWindowProps {
  metadata: AgentMetadata;
  chat: UseAgentChatResult;
  sessions?: UseChatSessionsReturn;
  /** Load a past chat's messages, then hand them to `chat.loadSession`. */
  onOpenSession?: (sessionId: string) => void;
  onClose?: () => void;
  /** Drops the dock menu + close button (an inline chat has no popover chrome). */
  inline?: boolean;
  accept?: string[];
  onUpload?: (file: File) => Promise<PendingAttachment>;
  /** A message's action button was clicked (already resolved by `AgentChat`). */
  onMessageAction?: (action: MessageAction) => void;
  /** Show each turn's "Generated N steps" disclosure. */
  showToolSteps?: boolean;
  /** The active/restored conversation is being loaded from session history. */
  historyLoading?: boolean;
  /** Themed glyph set — already merged over the defaults by `AgentChat`. */
  icons: Required<AgentChatIcons>;
  /** Current window position. Omit (with `onSetDockMode`) to hide the menu. */
  dockMode?: DockMode;
  onSetDockMode?: (mode: DockMode) => void;
}

/**
 * Header icon buttons: grey glyph, grey circular hover.
 *
 * The starter's `ghost` variant is GOLD text with no hover background — the
 * opposite of the chat header's treatment — so the colour and the hover fill
 * are both overridden here rather than forking the Button primitive.
 */
const HEADER_ICON_BTN =
  'size-[1.875rem] rounded-full text-muted-foreground hover:bg-muted hover:text-muted-foreground';

/**
 * Header glyph size — 1.5rem (24px), matching the platform's `<Icon size="md">`
 * (its `md` is 24px, NOT 20px). Nucleo glyphs also fill only ~80% of their em
 * box, so 1.25rem here rendered visibly smaller than the platform's icons.
 * The close X is the exception: `size="sm"` = 1rem.
 */
const HEADER_GLYPH = 'text-[1.5rem]';

/**
 * Toggled-on state (history panel open / dock menu open) — cream gold circle.
 * `primary-50` is the design token for that fill; `primary/10` only approximates
 * it and reads as a washed-out grey against the panel.
 */
const HEADER_ICON_BTN_ACTIVE =
  'bg-primary-50 text-primary hover:bg-primary-50 hover:text-primary';

/**
 * Window-position menu: Floating / Dock left / Dock right.
 *
 * The trigger is just the mode glyph — no chevron — with a circular highlight
 * (gold while open, grey on hover). That's why this is a bare div rather than
 * an icon `<Button>`.
 */
function DockMenu({
  dockMode,
  onSetDockMode,
}: {
  dockMode: DockMode;
  onSetDockMode: (mode: DockMode) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Window position"
          className="flex h-[1.875rem] shrink-0 cursor-pointer items-center rounded-full text-muted-foreground"
        >
          <span
            className={cn(
              'flex size-[1.875rem] items-center justify-center rounded-full transition-colors',
              open ? HEADER_ICON_BTN_ACTIVE : 'hover:bg-muted',
            )}
          >
            <i
              className={cn('icon', HEADER_GLYPH, DOCK_TRIGGER_ICON[dockMode])}
              aria-hidden="true"
            />
          </span>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        sideOffset={6}
        // gap-1 between rows; the 1rem panel padding is the platform's.
        className="flex w-[12.375rem] flex-col gap-1 rounded-[0.875rem] p-4"
      >
        {DOCK_MENU_ITEMS.map((item) => {
          const active = item.value === dockMode;
          return (
            <DropdownMenuItem
              key={item.value}
              onSelect={() => onSetDockMode(item.value)}
              className={cn(
                'w-full cursor-pointer gap-3 rounded-lg px-2.5 py-2 text-base',
                // DropdownMenuItem carries `focus:**:text-accent-foreground`,
                // which recolours EVERY descendant when the row is highlighted
                // (Radix highlights on pointer-over, so it fires constantly).
                // Pin the GLYPH's colour through that state explicitly — an
                // earlier `focus:**:text-inherit` failed because the icon then
                // inherited the row's own dark text instead of keeping its own.
                active
                  // Active mode is a soft gold pill: gold GLYPH, dark label
                  // (only bolder). The label never turns gold.
                  ? 'bg-primary-50 font-semibold focus:bg-primary-50'
                  : 'font-medium hover:bg-muted focus:bg-muted',
              )}
            >
              {/* `!` beats DropdownMenuItem's `focus:**:text-accent-foreground`,
                  which otherwise recolours this glyph on hover (Radix
                  highlights on pointer-over, not just keyboard focus). */}
              <i
                className={cn(
                  'icon',
                  HEADER_GLYPH,
                  item.icon,
                  active ? '!text-primary' : '!text-muted-foreground',
                )}
                aria-hidden="true"
              />
              {item.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Show `label`, but fall back to `idle` when it stops changing for `quietMs`.
 *
 * Without this the line keeps showing the last tool's name after that tool has
 * finished, which reads as though it were still running.
 */
function useQuietFallback(label: string, idle: string, quietMs = 3000): string {
  const [current, setCurrent] = useState(label);
  // Adjust DURING RENDER when the label changes (React's documented pattern for
  // "state derived from props"), not in the effect: a synchronous setState in an
  // effect renders the stale label for one frame first, and costs a second pass.
  const [shownLabel, setShownLabel] = useState(label);
  if (label !== shownLabel) {
    setShownLabel(label);
    setCurrent(label);
  }
  // The effect now owns only the timer — the quiet-period fallback.
  useEffect(() => {
    const id = setTimeout(() => setCurrent(idle), quietMs);
    return () => clearTimeout(id);
  }, [label, idle, quietMs]);
  return current;
}

/**
 * Live turn status: a thin gold arc + a single grey label that swaps in place
 * ("Thinking…" → "Reading file…" → back to "Thinking…").
 *
 * Deliberately NOT a card and NOT a list — no surface, no percentage, no
 * progress bar, and no stacked steps. Completed work collapses into the
 * "Used N tools" disclosure on the finished message instead.
 */
function ProgressCard({ chat }: { chat: UseAgentChatResult }) {
  // Todos are the agent's own plan; tool steps are the fallback trace.
  const steps = chat.todos.length > 0 ? chat.todos : chat.toolSteps;
  const label = useQuietFallback(
    deriveStatusLabel(chat.statusText, steps),
    IDLE_STATUS_LABEL,
  );

  return (
    <div className="flex flex-col gap-1.5 self-start py-1" role="status" aria-live="polite">
      <div className="flex items-center gap-2">
        <span
          className="size-[0.9375rem] shrink-0 animate-spin rounded-full border-2 border-primary-100 border-t-primary"
          aria-hidden="true"
        />
        <span className="text-[0.9375rem] text-muted-foreground">{label}…</span>
      </div>
    </div>
  );
}

/**
 * Chat history — a full-body view that REPLACES the thread (a side-nav swap,
 * not a floating menu). The thread keeps running underneath; the back arrow
 * returns to it.
 */
function SessionList({
  sessions,
  activeSessionId,
  onOpen,
  onClose,
  onNewSession,
  isActiveUnsent,
  closing = false,
}: {
  sessions: UseChatSessionsReturn;
  activeSessionId: string;
  onOpen: (id: string) => void;
  onClose: () => void;
  /** Called when the ACTIVE chat is deleted — the thread needs replacing. */
  onNewSession: () => void;
  /**
   * The active chat is brand-new with no user message yet. Shows a single
   * transient "New chat" row so the in-progress chat is listed before the
   * backend persists it.
   */
  isActiveUnsent: boolean;
  /** Playing the exit animation; still mounted until the parent's timer fires. */
  closing?: boolean;
}) {
  const [search, setSearch] = useState('');
  /** The row being renamed inline, with its in-progress title. */
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const groups = useMemo(
    () =>
      groupSessions(
        withActiveGhost(sessions.sessions, activeSessionId, isActiveUnsent),
        search,
      ),
    [sessions.sessions, activeSessionId, isActiveUnsent, search],
  );

  const commitRename = () => {
    if (!renaming) return;
    const title = renaming.title.trim();
    // Empty or unchanged — just close the editor, don't round-trip.
    if (title) void sessions.rename(renaming.id, title);
    setRenaming(null);
  };

  const isEmpty = !sessions.isLoading && !sessions.error && groups.length === 0;
  const emptyText = sessions.sessions.length === 0 ? 'No chats yet' : 'No matching chats';

  return (
    <div
      className={cn(
        'flex min-h-0 flex-1 flex-col overflow-hidden',
        closing ? 'chat-anim-history-out' : 'chat-anim-history',
      )}
    >
      {/* Back arrow + title */}
      <div className="flex shrink-0 items-center gap-1 px-4 pb-4">
        <button
          type="button"
          aria-label="Back to chat"
          onClick={onClose}
          className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <i className="icon icon_-Tb_chevron_left text-[1rem]" aria-hidden="true" />
        </button>
        <span className="text-lg font-semibold">Chat History</span>
      </div>

      {/* Search */}
      <div className="relative mx-4 flex shrink-0 items-center">
        <i
          className="icon icon_-Tb_search pointer-events-none absolute left-4 z-[1] text-[1.25rem] text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search"
          aria-label="Search chats"
          // Input's default focus is a teal tint; the platform's search keeps a
          // neutral border and background, so that treatment is overridden here.
          className="rounded-[0.625rem] bg-background pl-10 font-normal focus-visible:border-input focus-visible:bg-background"
        />
      </div>

      {sessions.isLoading && (
        <p className="px-4 py-5 text-center text-base text-muted-foreground">Loading…</p>
      )}
      {sessions.error && (
        <p className="px-4 py-5 text-center text-base text-muted-foreground">
          {sessions.error}
        </p>
      )}
      {isEmpty && (
        <p className="px-4 py-5 text-center text-base text-muted-foreground">{emptyText}</p>
      )}

      <div className="chat-scroll chat-scroll-fade flex flex-col overflow-y-auto px-4 pb-1.5">
        {groups.map((group) => (
          // gap-1 between rows so the cards don't touch (the platform runs them
          // flush; we space them slightly).
          <div className="flex flex-col gap-1" key={group.key}>
            <span className="sticky top-0 z-[1] block bg-background p-4 pb-2 text-base font-semibold text-muted-foreground">
              {group.label}
            </span>
            {group.sessions.map((s) => {
              const label = sessionLabel(s);
              const active = s.session_id === activeSessionId;
              // The unsent "New chat" ghost has no backend record yet, so
              // rename/delete would 404 — only persisted rows get the actions.
              const isPersisted = s.message_count > 0;
              return (
                <div
                  key={s.session_id}
                  className={cn(
                    'group relative flex items-stretch rounded-lg transition-colors',
                    active ? 'bg-primary-50' : 'hover:bg-muted',
                  )}
                >
                  {renaming?.id === s.session_id ? (
                    <div className="flex min-w-0 flex-1 flex-col gap-[0.1875rem] px-4 py-2">
                      <Input
                        autoFocus
                        value={renaming.title}
                        aria-label="Chat title"
                        onChange={(e) =>
                          setRenaming({ id: s.session_id, title: e.target.value })
                        }
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename();
                          if (e.key === 'Escape') setRenaming(null);
                        }}
                        className="h-7 rounded-md px-2 py-1 text-base"
                      />
                      <span className="whitespace-nowrap text-sm leading-[1.2] text-muted-foreground">
                        {formatRelativeTime(s.updated_at)}
                      </span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onOpen(s.session_id)}
                      className="flex min-w-0 flex-1 cursor-pointer flex-col items-start gap-[0.1875rem] px-4 py-2 text-left"
                    >
                      <span
                        className={cn(
                          'w-full truncate text-base font-medium leading-[1.3]',
                          active && 'text-primary',
                        )}
                      >
                        {label}
                      </span>
                      <span className="whitespace-nowrap text-sm leading-[1.2] text-muted-foreground">
                        {formatRelativeTime(s.updated_at)}
                      </span>
                    </button>
                  )}

                  {/* Overlaid so showing them doesn't reflow the title/time.
                      Hidden while renaming — they'd sit on top of the input. */}
                  {isPersisted && (
                  <div
                    className={cn(
                      'pointer-events-none absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity',
                      !renaming && 'group-hover:pointer-events-auto group-hover:opacity-100',
                    )}
                  >
                    <button
                      type="button"
                      aria-label={`Rename ${label}`}
                      onClick={() => setRenaming({ id: s.session_id, title: label })}
                      className="flex size-8 cursor-pointer items-center justify-center rounded-md p-[0.3125rem] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <i className="icon icon_-Tb_pencil text-[1.25rem]" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${label}`}
                      onClick={() => {
                        void sessions.remove(s.session_id);
                        // Deleting the chat you're IN leaves the thread pointing
                        // at a dead session — mint a fresh one.
                        if (s.session_id === activeSessionId) onNewSession();
                      }}
                      className="flex size-8 cursor-pointer items-center justify-center rounded-md p-[0.3125rem] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <i className="icon icon_-Tb_trash text-[1.25rem]" aria-hidden="true" />
                    </button>
                  </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export function AgentChatWindow({
  metadata,
  chat,
  sessions,
  onOpenSession,
  onClose,
  inline = false,
  accept,
  onUpload,
  onMessageAction,
  showToolSteps = true,
  historyLoading = false,
  icons,
  dockMode = 'float',
  onSetDockMode,
}: AgentChatWindowProps) {
  const [historyOpen, setHistoryOpen] = useState(false);
  // While closing, the panel stays mounted with the exit class so the animation
  // can play; a timer (matched to the 0.16s animation) unmounts it.
  const [historyClosing, setHistoryClosing] = useState(false);
  const historyCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Close the history view, optionally running `onClosed` after the exit. */
  const closeHistory = useCallback((onClosed?: () => void) => {
    setHistoryOpen((open) => {
      if (!open) {
        // Nothing to animate — still honour the callback.
        onClosed?.();
        return open;
      }
      setHistoryClosing(true);
      if (historyCloseTimer.current) clearTimeout(historyCloseTimer.current);
      historyCloseTimer.current = setTimeout(() => {
        setHistoryOpen(false);
        setHistoryClosing(false);
        onClosed?.();
      }, 160);
      return open; // stay mounted until the timer fires
    });
  }, []);

  const toggleHistory = useCallback(() => {
    if (historyOpen) closeHistory();
    else setHistoryOpen(true);
  }, [historyOpen, closeHistory]);

  // Clear a pending close on unmount so it can't fire into a dead component.
  useEffect(
    () => () => {
      if (historyCloseTimer.current) clearTimeout(historyCloseTimer.current);
    },
    [],
  );

  /**
   * New chat: close the history view, then mint a fresh thread. Matches the
   * platform — starting a new chat from inside history returns you to it.
   */
  const handleNewChat = useCallback(() => {
    closeHistory();
    chat.startNewSession();
  }, [closeHistory, chat]);
  const endRef = useRef<HTMLDivElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const pinnedToEndRef = useRef(true);
  const programmaticScrollRef = useRef(false);

  const scrollThreadToEnd = useCallback((behavior: ScrollBehavior) => {
    const viewport = scrollViewportRef.current;
    if (!viewport) return;
    pinnedToEndRef.current = true;
    programmaticScrollRef.current = true;
    viewport.scrollTo({ top: viewport.scrollHeight, behavior });
  }, []);

  // Whether a turn is in flight — read inside the status effect without making
  // it a dependency, so that effect fires ONLY on a status tick, never on the
  // awaiting flip (the flip lands in the same render as a new message, where an
  // `auto` scroll would cancel the message effect's smooth animation below).
  // Written during render ON PURPOSE (see above): a ref write triggers no
  // re-render, and syncing it in an effect would leave the status effect reading
  // the PREVIOUS turn's flag for one tick — exactly the scroll bug this avoids.
  const awaitingRef = useRef(chat.isAwaitingResponse);
  // eslint-disable-next-line react-hooks/refs -- deliberate render-time ref sync
  awaitingRef.current = chat.isAwaitingResponse;

  // Smooth-scroll when a message lands — the visible motion the platform
  // animates. Keyed on message COUNT only: the progress line + final answer are
  // both distinct messages, so this covers turn start and finish.
  useEffect(() => {
    scrollThreadToEnd('smooth');
  }, [chat.messages.length, scrollThreadToEnd]);

  // The live status label ticks rapidly DURING a turn ("Thinking…" →
  // "Reading file…"); animating each would queue overlapping scrolls, so track
  // it INSTANTLY (the platform uses `behavior: 'auto'` for its equally-frequent
  // streaming case). Only while awaiting — the turn-end tick shares a render
  // with the new message, and an `auto` scroll there would kill its animation.
  useEffect(() => {
    if (awaitingRef.current) {
      scrollThreadToEnd('auto');
    }
  }, [chat.statusText, scrollThreadToEnd]);

  // Returning from history REMOUNTS the thread (the history view replaced it),
  // so it comes back scrolled to the top. Glide to the newest message when the
  // thread reappears.
  useEffect(() => {
    if (!historyOpen) scrollThreadToEnd('smooth');
  }, [historyOpen, scrollThreadToEnd]);

  // Chips and markdown can change height after the message-count effect has
  // already run. Keep the newest turn pinned, but preserve a deliberate scroll
  // upward by the user.
  useEffect(() => {
    const thread = threadRef.current;
    const viewport = scrollViewportRef.current;
    if (!thread || !viewport || historyOpen || typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const observer = new ResizeObserver(() => {
      if (pinnedToEndRef.current) viewport.scrollTop = viewport.scrollHeight;
    });
    observer.observe(thread);
    // Composer growth and panel resizing change the viewport without changing
    // the thread. Keep the same bottom pin through those size changes too.
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [historyOpen, chat.messages.length]);

  // Hidden turns (a page's opening message) never render, so they must not
  // count towards "there is a transcript" either — otherwise a chat whose only
  // turn is hidden would replace the welcome screen with an empty log. The
  // in-flight case still counts, so the progress card takes over immediately.
  const visibleMessages = chat.messages.filter((m) => !m.hidden);
  const hasMessages = visibleMessages.length > 0 || chat.isAwaitingResponse;
  // A chat with no visible USER message yet is "unsent" — neither the agent's
  // greeting nor a page-sent hidden opening turn counts as user activity.
  const hasUserMessages = hasVisibleUserMessage(chat.messages);
  const disabled = historyLoading || chat.sessionStatus !== 'ready' || chat.isAwaitingResponse;
  const examples = metadata.welcome.examples;
  // Inline chats fill their parent, so they get the full-height treatment too.
  const isDocked = inline || dockMode !== 'float';

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header — actions only, right-aligned. The platform shows no title or
          agent icon here; the welcome screen carries the identity instead. */}
      <div className="flex shrink-0 items-center justify-end gap-2 pb-1 pl-4 pr-6 pt-4">
        <Button
          variant="ghost"
          size="icon"
          className={HEADER_ICON_BTN}
          aria-label="New chat"
          onClick={handleNewChat}
        >
          <i className={cn('icon', HEADER_GLYPH, icons.newChat)} aria-hidden="true" />
        </Button>
        {sessions && (
          <Button
            variant="ghost"
            size="icon"
            aria-pressed={historyOpen}
            className={cn(HEADER_ICON_BTN, historyOpen && HEADER_ICON_BTN_ACTIVE)}
            aria-label="Chat history"
            onClick={toggleHistory}
          >
            <i className={cn('icon', HEADER_GLYPH, icons.history)} aria-hidden="true" />
          </Button>
        )}
        {!inline && onSetDockMode && (
          <DockMenu dockMode={dockMode} onSetDockMode={onSetDockMode} />
        )}
        {/* DOCKED only. A floating popover is toggled by its own FAB, which
            stays visible beside it — a close button there would be a second
            control for the same thing. Docked hides the FAB, so the panel must
            carry its own way out. */}
        {!inline && isDocked && onClose && (
          <Button
            variant="ghost"
            size="icon"
            className={HEADER_ICON_BTN}
            aria-label="Close chat"
            onClick={onClose}
          >
            {/* Sized WITH the other header glyphs. The platform declares
                size="sm" here, but its `close_x` is a different asset than
                Nucleo's Tabler `x` — at 1rem this one reads visibly lighter
                than its neighbours, so match by rendered weight, not by the
                declared value. */}
            <i className={cn('icon', HEADER_GLYPH, icons.close)} aria-hidden="true" />
          </Button>
        )}
      </div>

      {/* Body */}
      {historyOpen && sessions ? (
        <SessionList
          sessions={sessions}
          activeSessionId={chat.sessionId}
          closing={historyClosing}
          isActiveUnsent={!hasUserMessages}
          onNewSession={chat.startNewSession}
          onClose={() => closeHistory()}
          onOpen={(id) => {
            onOpenSession?.(id);
            closeHistory();
          }}
        />
      ) : (
        // px-4 py-3 = the platform's 0.75rem/1rem message-area padding. `p-3`
        // left only 12px at the sides, so text sat tight to the panel edge.
        <div
          ref={scrollViewportRef}
          className="chat-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3"
          aria-busy={historyLoading}
          onScroll={(event) => {
            const viewport = event.currentTarget;
            const next = scrollPinAfterScroll(viewport, programmaticScrollRef.current);
            pinnedToEndRef.current = next.pinned;
            programmaticScrollRef.current = next.programmatic;
          }}
          onWheel={() => { programmaticScrollRef.current = false; }}
          onTouchStart={() => { programmaticScrollRef.current = false; }}
          onPointerDown={() => { programmaticScrollRef.current = false; }}
        >
          {historyLoading ? (
            <div
              className="flex h-full items-center justify-center gap-2 text-muted-foreground"
              role="status"
              data-testid="chat-history-loading"
            >
              <span
                className="size-[0.9375rem] shrink-0 animate-spin rounded-full border-2 border-primary-100 border-t-primary"
                aria-hidden="true"
              />
              <span className="text-[0.9375rem]">Loading chat history…</span>
            </div>
          ) : hasMessages ? (
            <div
              ref={threadRef}
              className="flex flex-col gap-2"
              role="log"
              aria-live="polite"
            >
              {/* A hidden turn (a page's opening message) is on the wire and in
                  state, but never rendered. */}
              {visibleMessages.map((m) => (
                <AgentChatMessage
                  key={m.id}
                  message={m}
                  onAction={onMessageAction}
                  showToolSteps={showToolSteps}
                />
              ))}
              {chat.isAwaitingResponse && <ProgressCard chat={chat} />}
            </div>
          ) : (
            // Docked panels run the full viewport height, so the welcome block
            // centers in the space; a short floating popover pins it to the top
            // instead (matching the platform).
            <div
              className={cn(
                // gap-0: the examples label owns the spacing via its own
                // margins (mt-10/mb-3), matching the platform. A container gap
                // would stack on top of those.
                'flex h-full flex-col items-center text-center',
                isDocked ? 'justify-center' : 'justify-start',
              )}
            >
              <div>
                <p className="text-lg font-semibold">{metadata.welcome.title}</p>
                {metadata.welcome.subtitle && (
                  <p className="mx-auto mt-2 max-w-[22rem] text-sm text-muted-foreground">
                    {metadata.welcome.subtitle}
                  </p>
                )}
              </div>

              {examples.length > 0 && (
                <div className="w-full">
                  {/* 2.5rem above / 0.75rem below — the platform's spacing,
                      which sits the prompts well clear of the greeting. */}
                  <p className="mb-3 mt-10 text-[0.8125rem] text-muted-foreground">
                    Things you could ask:
                  </p>
                  {/* Gold-outlined pills that HUG their text (width: auto,
                      centered) rather than filling the column, and take a cream
                      fill on hover. */}
                  <ul className="flex w-full flex-col items-center gap-2.5">
                    {examples.map((ex) => (
                      <li key={ex} className="max-w-full">
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => chat.sendMessage(ex)}
                          className={cn(
                            'flex min-h-11 max-w-full items-center justify-center',
                            'rounded-xl border border-primary-300 bg-background px-4 py-2.5',
                            'text-base font-semibold leading-[1.3] text-primary-600',
                            'transition-colors duration-150',
                            'hover:border-primary-400 hover:bg-primary-50',
                            'disabled:cursor-not-allowed disabled:opacity-60',
                          )}
                        >
                          {ex}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          <div ref={endRef} />
        </div>
      )}

      {/* Transient banners */}
      {!historyOpen && chat.reconnecting && (
        <p className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
          Reconnecting…
        </p>
      )}
      {!historyOpen && chat.error && (
        <p
          className="flex items-start gap-2 border-t border-border px-3 py-1.5 text-xs text-destructive"
          role="alert"
        >
          <i
            className="icon icon_-Tb_alert_circle mt-0.5 shrink-0 text-[1.125rem]"
            aria-hidden="true"
          />
          {chat.error}
        </p>
      )}
      {/* Long-turn hint: the turn is still alive but slow. `cancel` only stops
          WAITING on it — it must never clear the conversation (PHX-4035 data
          loss). Gated to not overlap the reconnecting banner. */}
      {!historyOpen && chat.stalled && chat.isAwaitingResponse && !chat.reconnecting && (
        <div
          className="flex items-center justify-between gap-2 border-t border-border bg-grayscale-100 px-4 py-2"
          role="status"
        >
          <span className="text-[0.8125rem] text-grayscale-600">
            Still working — this is taking longer than expected.
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-auto shrink-0 px-1.5 py-0.5 text-[0.8125rem] font-medium text-primary-600 hover:text-primary-700"
            onClick={chat.cancel}
          >
            Stop
          </Button>
        </div>
      )}

      {/* NOT gated on `historyOpen` — the composer stays mounted while browsing
          history, so a message typed there still goes to the LIVE session (the
          thread keeps running underneath). Sending returns to it. Only the
          status banners above hide. */}
      <AgentChatInput
        placeholder={metadata.inputPlaceholder}
        disabled={disabled}
        accept={accept}
        onUpload={onUpload}
        icons={icons}
        onSend={(text, attachments) => {
          // Close FIRST so the thread is already on screen when the turn
          // starts — matching the platform's handleSendMessage.
          closeHistory();
          chat.sendMessage(text, { attachments });
        }}
      />
    </div>
  );
}
