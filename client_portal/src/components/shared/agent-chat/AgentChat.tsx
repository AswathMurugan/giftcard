/**
 * `<AgentChat>` — a full chat with a platform skill (agent) in one line:
 *
 *   <AgentChat skill="ETL-File-Format-Skill" />
 *
 * Everything else derives from the skill's registry entry. The AppSync
 * WebSocket, streaming, tool progress, and chat history all come for free.
 * See `src/queries/AGENT-CHAT.md`.
 *
 * Every mounted chat owns its transport, so it can safely coexist with another
 * chat or a headless `useAgentTask` on the same page.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getAppConfig } from '@/config/api-config';
import type { SkillName } from '@/types/skills.generated';
import {
  buildAgentMetadata,
  buildSessionScope,
  type AgentRequestContext,
  type ExtraInputsContext,
} from './agent-metadata';
import { useAgentChat } from './hooks/use-agent-chat';
import { useUserId } from './hooks/use-agent-identity';
import type { MessageAction, MessageExtras, MessageExtrasContext } from './hooks/agent-chat-reducer';
import { useChatSessions } from './hooks/use-chat-sessions';
import { decideInitialMessageAction } from './utils/initial-message';
import { loadMessages } from '@/services/session-api';
import {
  markInitialMessageSent,
  readStoredSessionId,
  wasInitialMessageSent,
  writeStoredSessionId,
} from './utils/session-store';
import { runSessionRestore } from './utils/session-restore';
import { mapSessionMessages } from './utils/map-session-messages';
import type { AgentAction } from './utils/envelope';
import {
  appearanceStyle,
  resolveIcons,
  type AgentChatAppearance,
} from './appearance';
import { AgentChatWindow } from './AgentChatWindow';
import type { PendingAttachment } from './AgentChatInput';
// Colocated styles (same pattern as DataTable.css) — the body-level layout
// reserve, scrollbars, and keyframes that Tailwind utilities can't express.
import './agent-chat.css';
import {
  readDockMode,
  writeDockMode,
  readDockWidth,
  writeDockWidth,
  applyDockWidth,
  dockWidthFromPointer,
  DOCK_MIN_PX,
  DOCK_MAX_PX,
  type DockMode,
} from './dock-mode';

export interface AgentChatProps {
  /**
   * REQUIRED. The skill's `name` (NOT its label or appKey) — becomes
   * `agent_name` on the wire. `SkillName` gives autocomplete once the registry
   * is populated; the `string` arm keeps it compiling against the empty stub.
   */
  skill: SkillName | (string & {});

  // ── design tuning (all optional; defaults come from the skill) ──
  title?: string;
  description?: string;
  /** Nucleo glyph class, e.g. 'icon_-Tb_robot'. */
  iconName?: string;
  inputPlaceholder?: string;
  welcome?: { title?: string; subtitle?: string; examples?: string[] };

  /**
   * Override how THIS agent's reply becomes the bubble text — for an agent
   * whose `done.output` isn't a plain string or a shape the default handles.
   * Layer it: call the passed `defaultParse` for anything you don't special-case.
   *
   *   parseResponse={(raw, defaultParse) =>
   *     (raw as any)?.output?.response ?? defaultParse(raw)}
   *
   * The connection + default parsing stay in place; this only refines what's
   * displayed for this instance. See AGENT-CHAT.md §Overrides.
   */
  parseResponse?: (raw: unknown, defaultParse: (raw: unknown) => string) => string;

  /**
   * Read the chips + buttons THIS agent attaches to a turn off its raw
   * `done.output` — sibling of `parseResponse`, so a per-agent shape never
   * lands in the transport:
   *
   *   parseExtras={(raw) => ({ chips: raw?.record?.missing_fields,
   *                            actions: raw?.record?.actions })}
   *
   * Chips render as read-only pills under the reply; actions as buttons.
   */
  parseExtras?: (raw: unknown, ctx: MessageExtrasContext) => MessageExtras;

  /**
   * A message action was clicked. `send` posts a turn, so a page can hand a
   * choice back to the agent (`api.send(action.send ?? action.label)`) or
   * handle it locally (navigate, open a form). Omit it and a click sends
   * `action.send ?? action.label`.
   */
  onMessageAction?: (action: MessageAction, api: { send: (text: string) => void }) => void;

  /**
   * Keep the SAME conversation across navigation. The chat unsubscribes when it
   * unmounts, so without this a return mints a new session: the thread is gone
   * and an `initialMessage` fires again. With a key, the session id is
   * remembered for the tab and the next mount re-adopts it and reloads its
   * history. Use one key per flow+context (e.g. `onboarding-summary:<ids>`).
   */
  sessionKey?: string;

  /**
   * An EXTERNALLY owned session to continue — for a page that stores the id with
   * its record, so the conversation survives a new tab, another device, or a
   * colleague picking the case up (not just this tab). Wins over `sessionKey`;
   * its history loads the same way. Must be known at mount — gate the chat on
   * your record being loaded.
   */
  sessionId?: string;

  /** The live session id whenever it is established or changes — persist it. */
  onSessionChange?: (sessionId: string) => void;

  /**
   * Send `initialMessage` even into a restored thread that already has messages
   * — for a page that has detected its CONTEXT changed since the last turn, so
   * the agent needs the new data. Default false: a restored conversation is
   * left exactly as the user left it.
   */
  resendInitialMessage?: boolean;

  /**
   * Opening turn sent ONCE per session, automatically, as soon as it is ready —
   * so the user lands on a conversation that has already started instead of an
   * empty composer. Pair with `hideInitialMessage` to keep it off screen.
   * Never re-sent into a restored thread unless `resendInitialMessage` requests it.
   */
  initialMessage?: string;
  /** Send `initialMessage` on the wire without rendering its bubble. */
  hideInitialMessage?: boolean;

  /**
   * Add extra fields to the invoke payload's `inputs` per turn — e.g. a
   * `schema` on the first message, an id when a file is attached. What to add
   * and when is up to the callback; it's merged OVER the default `inputs` and
   * never appears in the chat bubble. The socket/envelope are untouched.
   *
   *   getExtraInputs={(ctx) => (ctx.isNewSession ? { schema } : {})}
   */
  getExtraInputs?: (ctx: ExtraInputsContext) => Record<string, unknown>;
  /**
   * Per-instance colours + icons. Applied as CSS-variable overrides scoped to
   * this chat, so the app's own theme is untouched. Structure, spacing and type
   * are intentionally not themeable — see `appearance.ts`.
   */
  appearance?: AgentChatAppearance;
  /** 'floating' = FAB + popover (default). 'inline' = fills its parent. */
  variant?: 'floating' | 'inline';
  placement?: 'bottom-right' | 'bottom-left';
  defaultOpen?: boolean;
  /**
   * Gate the opening turn on the page's own readiness (data loaded, a document
   * uploaded). Default true — ignored when `initialMessage` is unset.
   */
  initialMessageReady?: boolean;
  /** Cmd/Ctrl+J toggles, Esc closes. Default true. */
  hotkey?: boolean;

  /**
   * Show each answer's "Generated N steps" tool disclosure. Default true. Turn
   * it off for a chat whose audience is the END USER (an onboarding companion,
   * say): how the answer was produced is operator detail there.
   */
  showToolSteps?: boolean;

  // ── attachments (off unless both are given) ──
  accept?: string[];
  onUpload?: (file: File) => Promise<PendingAttachment>;

  // ── page reactions ──
  /** Structured result when the agent saved something. */
  onAction?: (action: AgentAction) => void;
  /** Final display text + raw `done.output` of every LIVE completed turn. */
  onDone?: (output: string, raw: unknown) => void;
}

export function AgentChat({
  skill,
  title,
  description,
  iconName,
  inputPlaceholder,
  welcome,
  parseResponse,
  parseExtras,
  getExtraInputs,
  appearance,
  variant = 'floating',
  placement = 'bottom-right',
  defaultOpen = false,
  sessionKey,
  sessionId: externalSessionId,
  onSessionChange,
  resendInitialMessage = false,
  initialMessage,
  hideInitialMessage = false,
  initialMessageReady = true,
  hotkey = true,
  showToolSteps = true,
  accept,
  onUpload,
  onAction,
  onMessageAction,
  onDone,
}: AgentChatProps) {
  const [open, setOpen] = useState(defaultOpen || variant === 'inline');
  const [dockMode, setDockMode] = useState<DockMode>(readDockMode);
  const userId = useUserId();

  const [isResizing, setIsResizing] = useState(false);

  /**
   * Closing runs the exit animation BEFORE unmounting: `closing` keeps the
   * panel rendered while the animation plays, and `animationend` clears it.
   * Setting `open=false` directly would remove the node instantly, so the
   * animation would never be seen.
   */
  const [closing, setClosing] = useState(false);

  const beginClose = useCallback(() => {
    // Only animate what's actually on screen; an inline chat never closes.
    setOpen((wasOpen) => {
      if (wasOpen && variant !== 'inline') setClosing(true);
      return wasOpen;
    });
  }, [variant]);

  const finishClose = useCallback(() => {
    setClosing(false);
    setOpen(false);
  }, []);

  /** Open instantly; close through the exit animation. */
  const toggleOpen = useCallback(() => {
    // Mid-close, the panel is still mounted (`open` stays true), so treat a
    // toggle as REOPEN — cancel the exit rather than restarting it.
    if (closing) {
      setClosing(false);
      return;
    }
    setOpen((wasOpen) => {
      if (!wasOpen) return true;
      if (variant !== 'inline') setClosing(true);
      return true; // stay mounted; finishClose unmounts after the animation
    });
  }, [variant, closing]);

  const handleSetDockMode = useCallback((mode: DockMode) => {
    setDockMode(mode);
    writeDockMode(mode);
  }, []);

  // Publish the persisted width once, before the panel first paints, so a
  // restored width doesn't flash at the default first.
  useEffect(() => {
    applyDockWidth(readDockWidth());
  }, []);

  // Drag-to-resize a docked panel. The pointer move writes straight to the CSS
  // variable (no React state per frame — that would re-render the whole thread
  // on every pixel); the final value is committed to localStorage on release.
  useEffect(() => {
    if (!isResizing) return undefined;
    document.body.classList.add('chat-resizing');

    const onMove = (e: PointerEvent) => {
      applyDockWidth(dockWidthFromPointer(e.clientX, dockMode, window.innerWidth));
    };
    const onUp = () => {
      setIsResizing(false);
      const current = getComputedStyle(document.documentElement)
        .getPropertyValue('--agent-chat-dock-width')
        .trim();
      const px = parseFloat(current);
      if (Number.isFinite(px)) writeDockWidth(px);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.classList.remove('chat-resizing');
    };
  }, [isResizing, dockMode]);

  // While docked AND open, tag <body> so the app root reserves width (see the
  // `.chat-docked--*` rules in index.css) and the panel sits beside the content
  // instead of overlaying it. Cleaned up on unmount / close / undock.
  useEffect(() => {
    if (variant === 'inline') return undefined;
    const { classList } = document.body;
    // Drop the reserve the moment closing STARTS, not when it finishes — the
    // page reflows alongside the slide-out instead of snapping after it.
    const reserved = open && !closing;
    classList.toggle('chat-docked--left', reserved && dockMode === 'left');
    classList.toggle('chat-docked--right', reserved && dockMode === 'right');
    return () => {
      classList.remove('chat-docked--left', 'chat-docked--right');
    };
  }, [open, closing, dockMode, variant]);

  // CSS-variable overrides scoped to this chat's roots, and the merged glyph
  // set. Both are stable unless `appearance` changes.
  const themeStyle = useMemo(() => appearanceStyle(appearance), [appearance]);
  const icons = useMemo(() => resolveIcons(appearance?.icons), [appearance]);

  const metadata = useMemo(
    () =>
      buildAgentMetadata(skill, {
        title,
        description,
        iconName,
        inputPlaceholder,
        welcome,
        parseResponse,
        parseExtras,
        getExtraInputs,
      }),
    [skill, title, description, iconName, inputPlaceholder, welcome, parseResponse, parseExtras, getExtraInputs],
  );

  const context = useMemo<AgentRequestContext>(() => {
    const app = getAppConfig();
    return {
      appName: app.appName,
      appDefinition: app.appDefinition,
      tenant: app.tenant,
      env: app.env,
      userId,
    };
  }, [userId]);

  // Connect only once the surface is live: an inline chat is always on; a
  // floating one waits for the first open, so a page that never opens it pays no
  // socket. Also wait for the async user id.
  // Latch DURING RENDER (React's "adjust state while rendering" pattern) rather
  // than in an effect: the socket should come up in the same commit that opens
  // the panel, and a synchronous setState inside an effect costs an extra pass
  // with `enabled` still false.
  const [everOpened, setEverOpened] = useState(open);
  if (open && !everOpened) setEverOpened(true);
  const enabled = everOpened && Boolean(userId);

  const chat = useAgentChat({ metadata, context, enabled, onAction, onDone });

  // The AGENT's own app, matching the invoke payload — see buildSessionScope.
  const sessionScope = useMemo(
    () => buildSessionScope(metadata, context),
    [metadata, context],
  );
  const sessions = useChatSessions(metadata.agentId, sessionScope, enabled);

  /**
   * Re-adopt this page's previous session (see `sessionKey`) and reload its
   * history, so going back to the page continues the conversation instead of
   * starting a new one. Runs once per mount; failures degrade to a new session.
   */
  const { sendMessage, sessionStatus, loadSession, sessionId, messages } = chat;
  // Read tab storage ONCE. A page-owned id may arrive later with an async record;
  // it wins over this mount-time fallback without mistaking the live session id
  // that we subsequently write to storage for history that needs restoring.
  const [storedSessionAtMount] = useState(() => readStoredSessionId(sessionKey ?? ''));
  const externalRestoreTarget = (externalSessionId ?? '').trim();
  const desiredRestoreTarget = externalRestoreTarget || storedSessionAtMount;
  const [restore, setRestore] = useState(() => ({
    target: desiredRestoreTarget,
    pending: Boolean(desiredRestoreTarget),
  }));
  // Async records commonly resolve after the chat mounts. Mark that transition
  // during render so the opening-message effect in this commit sees `restoring`
  // and cannot race the history request.
  if (
    externalRestoreTarget
    && externalRestoreTarget !== sessionId
    && restore.target !== externalRestoreTarget
  ) {
    setRestore({ target: externalRestoreTarget, pending: true });
  }
  const restoring = restore.pending;
  // Page overrides are commonly inline arrows. Keep their latest values without
  // making the restore effect restart whenever a parent renders.
  /* eslint-disable react-hooks/refs -- deliberate render-time ref sync */
  const restoreInputsRef = useRef({
    sessionScope,
    loadSession,
    hiddenFirstMessage: hideInitialMessage ? initialMessage : undefined,
    parseResponse: metadata.parseResponse,
    parseExtras: metadata.parseExtras,
  });
  restoreInputsRef.current = {
    sessionScope,
    loadSession,
    hiddenFirstMessage: hideInitialMessage ? initialMessage : undefined,
    parseResponse: metadata.parseResponse,
    parseExtras: metadata.parseExtras,
  };
  /* eslint-enable react-hooks/refs */
  useEffect(() => {
    if (!enabled || !restore.pending || !restore.target) return undefined;
    const target = restore.target;
    let cancelled = false;
    void runSessionRestore({
      load: () => loadMessages(target, restoreInputsRef.current.sessionScope),
      apply: (history) => {
        const current = restoreInputsRef.current;
        current.loadSession(
          target,
          mapSessionMessages(target, history, {
            hiddenFirstMessage: current.hiddenFirstMessage,
            parseResponse: current.parseResponse,
            parseExtras: current.parseExtras,
          }),
        );
      },
      settle: () => {
        setRestore((current) => current.target === target
          ? { ...current, pending: false }
          : current);
      },
      cancelled: () => cancelled,
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, restore.pending, restore.target]);

  // Remember the live session so the next mount can re-adopt it.
  useEffect(() => {
    if (!restoring && sessionKey && sessionId) writeStoredSessionId(sessionKey, sessionId);
  }, [restoring, sessionKey, sessionId]);
  // …and wherever the page keeps its record (it owns the durable copy).
  useEffect(() => {
    // Do not briefly overwrite a stored id with useAgentChat's fresh placeholder
    // while its real conversation is still loading.
    if (!restoring && sessionId) onSessionChange?.(sessionId);
  }, [restoring, sessionId, onSessionChange]);

  /**
   * Opening turn: sent ONCE per session, as soon as the transport is ready and
   * the page says its context has landed. The per-mount set prevents effect
   * churn; the tab marker closes the remount gap before backend history has
   * checkpointed the turn. `hideInitialMessage` affects rendering only.
   *
   * NOT sent into a thread that already has messages: a restored session is the
   * conversation the user was already having, and re-greeting it would duplicate
   * the turn (and the agent call) every time they navigate back.
  */
  const handledInitialSessionsRef = useRef(new Set<string>());
  useEffect(() => {
    if (!initialMessage) return;
    const action = decideInitialMessageAction({
      hasInitialMessage: true,
      sessionId,
      handledThisMount: handledInitialSessionsRef.current.has(sessionId),
      restoring,
      sessionReady: sessionStatus === 'ready',
      initialMessageReady,
      hasMessages: messages.length > 0,
      resendInitialMessage,
      sentForSession: wasInitialMessageSent(sessionId),
    });
    if (action === 'wait') return;

    handledInitialSessionsRef.current.add(sessionId);
    if (action === 'skip') return;

    // At-most-once is preferable to an ambiguous retry: persist before publish
    // so an immediate route remount cannot race a lagging history checkpoint.
    markInitialMessageSent(sessionId);
    sendMessage(initialMessage, { hidden: hideInitialMessage });
  }, [
    initialMessage, initialMessageReady, hideInitialMessage, resendInitialMessage,
    sessionStatus, sendMessage, restoring, messages.length, sessionId,
  ]);

  /** A message button was clicked: the page decides, else it goes back as a turn. */
  const handleMessageAction = useCallback(
    (action: MessageAction) => {
      const api = { send: (text: string) => sendMessage(text) };
      if (onMessageAction) onMessageAction(action, api);
      else api.send(action.send ?? action.label);
    },
    [onMessageAction, sendMessage],
  );


  /**
   * Refetch the session index when a turn FINISHES (isAwaitingResponse
   * true → false).
   *
   * The backend creates the session record lazily, on the first send — so a
   * brand-new chat has no row until then, and its title/count only exist once
   * the turn completes. Without this the history list never picks up new
   * sessions. Deliberately a refetch, NOT a local optimistic row: inventing one
   * per session id produces phantom duplicates on every open/agent switch. An
   * unsent chat is represented by the welcome panel, not a history row.
   */
  const refreshSessions = sessions.refresh;
  const { isAwaitingResponse } = chat;
  const wasAwaitingRef = useRef(false);
  useEffect(() => {
    if (wasAwaitingRef.current && !isAwaitingResponse) refreshSessions();
    wasAwaitingRef.current = isAwaitingResponse;
  }, [isAwaitingResponse, refreshSessions]);

  // Open a past chat: fetch its checkpoint, then adopt it as the live thread.
  const [openingHistory, setOpeningHistory] = useState(false);
  const openSession = useCallback(
    (sessionId: string) => {
      setOpeningHistory(true);
      void loadMessages(sessionId, sessionScope)
        .then((history) => {
          // Re-hide the page's opening turn on reload (see mapSessionMessages).
          chat.loadSession(
            sessionId,
            mapSessionMessages(sessionId, history, {
              hiddenFirstMessage: hideInitialMessage ? initialMessage : undefined,
              parseResponse: metadata.parseResponse,
              parseExtras: metadata.parseExtras,
            }),
          );
        })
        .catch(() => {
          // Best-effort: a failed history load must not disturb the live chat.
        })
        .finally(() => setOpeningHistory(false));
    },
    [chat, sessionScope, hideInitialMessage, initialMessage, metadata],
  );

  // Keep the history list's title in sync with the backend's auto-titling.
  const { sessionTitle } = chat;
  const { patchTitle } = sessions;
  useEffect(() => {
    if (sessionTitle) patchTitle(sessionTitle.sessionId, sessionTitle.title);
  }, [sessionTitle, patchTitle]);

  // Cmd/Ctrl+J toggles; Esc closes.
  useEffect(() => {
    if (variant === 'inline' || !hotkey) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        toggleOpen();
      } else if (e.key === 'Escape') {
        beginClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [variant, hotkey, toggleOpen, beginClose]);

  const close = beginClose;

  if (variant === 'inline') {
    return (
      <div
        className="h-full min-h-[24rem] overflow-hidden rounded-lg border border-border bg-background"
        style={themeStyle}
      >
        <AgentChatWindow
          metadata={metadata}
          chat={chat}
          sessions={sessions}
          onOpenSession={openSession}
          inline
          accept={accept}
          onUpload={onUpload}
          onMessageAction={handleMessageAction}
          showToolSteps={showToolSteps}
          historyLoading={restoring || openingHistory}
          icons={icons}
        />
      </div>
    );
  }

  const side = placement === 'bottom-left' ? 'left-6' : 'right-6';
  const isDocked = dockMode !== 'float';

  // Portal so the panel can't be clipped by a page's overflow/stacking.
  return createPortal(
    <>
      {/* Full-viewport shield during a drag: keeps the pointer stream alive when
          the cursor crosses an iframe (which would otherwise swallow it). */}
      {isResizing && (
        <div className="fixed inset-0 z-[2147483000] cursor-ew-resize" aria-hidden="true" />
      )}

      {open && (
        <div
          // Keyed by mode so switching dock position REMOUNTS the panel and the
          // enter animation replays — without this React reuses the node and
          // the slide never runs on a mode change.
          key={dockMode}
          onAnimationEnd={(e) => {
            // Only the panel's OWN exit animation ends the close — a child's
            // animation (the history slide) also bubbles here.
            if (closing && e.target === e.currentTarget) finishClose();
          }}
          className={cn(
            'fixed z-50 flex flex-col overflow-hidden border-border bg-background',
            closing
              ? dockMode === 'left'
                ? 'chat-anim-dock-left-out'
                : dockMode === 'right'
                  ? 'chat-anim-dock-right-out'
                  : 'chat-anim-float-out'
              : dockMode === 'left'
                ? 'chat-anim-dock-left'
                : dockMode === 'right'
                  ? 'chat-anim-dock-right'
                  : 'chat-anim-float',
            isDocked
              ? // Full-height rail pinned to one edge. The app root reserves
                // width via the body class, so this sits beside the content.
                [
                  'inset-y-0 h-full max-w-full shadow-lg',
                  dockMode === 'left' ? 'left-0 border-r' : 'right-0 border-l',
                ]
              : // Floating popover above the FAB. The 1.5625rem radius is the
                // platform's — notably rounder than a standard card.
                [
                  // 4rem = mockup FAB offset (0.875) + height (2.25) + gap
                  // (0.875), keeping the panel and launcher aligned as one unit.
                  'bottom-[4rem] h-[32rem] max-h-[calc(100vh-7rem)] w-[25rem]',
                  'max-w-[calc(100vw-3rem)] rounded-[1.5625rem] border shadow-lg',
                  side,
                ],
          )}
          role="dialog"
          aria-label={`${metadata.displayTitle} chat`}
          // Docked width tracks the CSS variable the drag handle writes, so the
          // panel and the app-root reserve stay in lockstep. The floating
          // popover keeps its own fixed width from the classes above.
          style={
            isDocked
              ? { ...themeStyle, width: 'var(--agent-chat-dock-width, 25rem)' }
              : themeStyle
          }
        >
          {isDocked && (
            // Drag-to-resize. The HIT AREA is 0.5rem wide and straddles the
            // panel edge (-0.25rem) so it's easy to grab; the visible HIGHLIGHT
            // is the 2px line inside it. Tinting the whole hit area instead
            // would read as a thick band.
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize chat panel"
              aria-valuemin={DOCK_MIN_PX}
              aria-valuemax={DOCK_MAX_PX}
              onPointerDown={(e) => {
                e.preventDefault();
                setIsResizing(true);
              }}
              className={cn(
                'group absolute inset-y-0 z-10 w-2 cursor-ew-resize touch-none',
                dockMode === 'left' ? '-right-1' : '-left-1',
              )}
            >
              <span
                className={cn(
                  'absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 transition-colors',
                  isResizing ? 'bg-primary-300' : 'bg-transparent group-hover:bg-primary-300',
                )}
                aria-hidden="true"
              />
            </div>
          )}

          <AgentChatWindow
            metadata={metadata}
            chat={chat}
            sessions={sessions}
            onOpenSession={openSession}
            onClose={close}
            accept={accept}
            onUpload={onUpload}
            onMessageAction={handleMessageAction}
            showToolSteps={showToolSteps}
            historyLoading={restoring || openingHistory}
            icons={icons}
            dockMode={dockMode}
            onSetDockMode={handleSetDockMode}
          />
        </div>
      )}

      {/* Hide the bubble while a docked panel is open — the panel's own close
          button takes over, and the FAB would otherwise sit on top of it. */}
      {!(open && isDocked) && (
        <Button
          size="icon"
          aria-label={open ? 'Close agent chat' : `Open ${metadata.displayTitle}`}
          onClick={toggleOpen}
          // The FAB is a portalled SIBLING of the panel, so it needs the theme
          // vars applied separately — it isn't inside the panel's scope.
          style={themeStyle}
          className={cn(
            'fixed bottom-[0.875rem] z-50 size-9 rounded-full shadow-lg',
            side,
          )}
        >
          <i
            className={cn(
              'icon text-[1.125rem]',
              // `iconName` (a per-skill override) still wins over the theme's
              // launcher glyph; the theme is the fallback, not an override.
              open ? icons.close : (iconName ?? appearance?.icons?.launcher ?? metadata.iconName),
            )}
            aria-hidden="true"
          />
        </Button>
      )}
    </>,
    document.body,
  );
}
