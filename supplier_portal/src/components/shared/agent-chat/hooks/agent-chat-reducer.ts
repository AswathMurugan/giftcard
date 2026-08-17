/**
 * The agent-chat state machine, as a PURE reducer.
 *
 * Why: the starter's vitest runs in a NODE environment (no DOM, no
 * @testing-library), so a hook full of state can't be tested directly. Modeling
 * the machine as `(state, event) => state` makes every rule — dedup, streaming,
 * tool pairing, done-wins-over-stream — testable as a plain function call, and
 * leaves `use-agent-chat.ts` as thin transport wiring.
 *
 * Rules preserved verbatim:
 *   - A terminal (`done`/`error`) resolves a request_id; later events for that
 *     id are dropped. AppSync can deliver duplicates (PHX-3878), and a cancelled
 *     turn keeps streaming server-side (PHX-4035).
 *   - `done.output` is authoritative; streamed narration is only a fallback for
 *     a turn that produced no output (PHX-4004).
 *   - A tool still `in_progress` at `done` is coerced to `completed` — a
 *     finished turn must never show a spinner.
 */

import type { AgentMessage } from '@/services/chat-service';
import { humanizeStep, humanizeTool, aggregateActiveTools } from '@/components/shared/agent-chat/utils/humanize';
import type { ActiveTool, ProgressTodo } from '@/components/shared/agent-chat/utils/humanize';
import { parseAgentOutput, extractAgentAction, type AgentAction } from '@/components/shared/agent-chat/utils/envelope';

export interface ToolError {
  tool: string;
  errorCode: string;
  message?: string;
}

/**
 * A choice the agent offers with a turn — rendered as a button under the reply.
 * `send` is the text posted back when the choice simply continues the
 * conversation; a page that handles the action itself can ignore it.
 */
export interface MessageAction {
  /** Stable id the page switches on. */
  id: string;
  label: string;
  /** Text to send as the next turn (default click behaviour). */
  send?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  attachments?: { id: string; filename: string }[];
  /** Tool steps captured on `done`, shown as a "Used N tools" disclosure. */
  toolSteps?: ProgressTodo[];
  /** Structured tool failures reported during the turn. */
  toolErrors?: ToolError[];
  /** Read-only pills under the reply (e.g. the fields still missing). */
  chips?: string[];
  /** Buttons under the reply. */
  actions?: MessageAction[];
  /**
   * Sent on the wire but NOT rendered — an opening turn a page fires on the
   * user's behalf (`AgentChat.initialMessage` + `hideInitialMessage`). Kept in
   * state so the turn still owns its request id and ordering.
   */
  hidden?: boolean;
}

/** Last assistant turn in a transcript, used to suppress history replay events. */
export function lastAssistantMessageId(messages: readonly ChatMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'assistant') return messages[index].id;
  }
  return null;
}

/** What a page's `parseExtras` override can attach to an assistant turn. */
export interface MessageExtras {
  chips?: string[];
  actions?: MessageAction[];
}

/** Context for `parseExtras`, so it can treat the opening reply differently. */
export interface MessageExtrasContext {
  /** This is the FIRST assistant turn of the conversation. */
  isFirstReply: boolean;
}

export type SessionStatus = 'idle' | 'initializing' | 'ready' | 'error';

/** Internal tool step — keeps `name` so tool_end can match its tool_start. */
interface InternalToolStep {
  id: string;
  name: string;
  content: string;
  status: ProgressTodo['status'];
}

export interface AgentChatState {
  messages: ChatMessage[];
  /**
   * RAW `done.output` of the last completed turn. Kept so consumers can react to
   * the agent's STRUCTURED answer (`onDone`'s second argument) without having to
   * intercept `parseResponse`, which exists to produce display text.
   */
  lastOutput?: unknown;
  /**
   * Accepted `done` for the current live request. This is separate from the
   * transcript because a valid terminal event may have nothing to render.
   */
  lastCompletedTurn: AgentTurnCompletion | null;
  sessionStatus: SessionStatus;
  isAwaitingResponse: boolean;
  error: string | null;
  statusText: string;
  todos: ProgressTodo[];
  activeTools: ActiveTool[];
  toolSteps: InternalToolStep[];
  toolErrors: ToolError[];
  /** Streamed narration, kept only as a fallback (PHX-4004). */
  streamingContent: string;
  reconnecting: boolean;
  stalled: boolean;
  /** request_id of the in-flight turn; null when idle. */
  currentRequestId: string | null;
  /** request_ids whose terminal event already rendered — dedup guard. */
  resolvedRequestIds: string[];
  /** Wall-clock of the last inbound event; the stall watchdog reads it. */
  lastEventAt: number;
  /** Set on `done` when the agent reported a save. Consumed then cleared. */
  pendingAction: AgentAction | null;
  /** Title the backend auto-generated for this session, if any. */
  sessionTitle: { sessionId: string; title: string } | null;
}

export interface AgentTurnCompletion {
  requestId: string;
  /** Final display text, including the valid empty-string result. */
  output: string;
  /** RAW `done.output`, including `undefined` when the payload omitted it. */
  raw: unknown;
}

export function initialChatState(): AgentChatState {
  return {
    messages: [],
    lastCompletedTurn: null,
    sessionStatus: 'idle',
    isAwaitingResponse: false,
    error: null,
    statusText: '',
    todos: [],
    activeTools: [],
    toolSteps: [],
    toolErrors: [],
    streamingContent: '',
    reconnecting: false,
    stalled: false,
    currentRequestId: null,
    resolvedRequestIds: [],
    lastEventAt: 0,
    pendingAction: null,
    sessionTitle: null,
  };
}

export type ChatAction =
  | {
      type: 'agent-event';
      message: AgentMessage;
      now: number;
      /**
       * How to turn `done.output` into the bubble text. The hook passes
       * `metadata.parseResponse` (which already layers any page override over
       * the default); omitted in tests, where it defaults to `parseAgentOutput`.
       */
      parseResponse?: (raw: unknown) => string;
      /**
       * How to read this agent's chips/actions off `done.output`. Sibling of
       * `parseResponse` — per-agent output shapes stay in the page, not here.
       */
      parseExtras?: (raw: unknown, ctx: MessageExtrasContext) => MessageExtras;
    }
  | {
      type: 'send';
      requestId: string;
      text: string;
      attachments?: { id: string; filename: string }[];
      now: number;
      /** Wire-only turn: no bubble (see {@link ChatMessage.hidden}). */
      hidden?: boolean;
    }
  | { type: 'session-status'; status: SessionStatus; error?: string }
  | { type: 'session-ready-fallback' }
  | { type: 'stall' }
  | { type: 'cancel' }
  | { type: 'reset' }
  | { type: 'load-messages'; messages: ChatMessage[] }
  | { type: 'clear-action' };

/** Cleanup shared by every "turn is over" path so they can't drift apart. */
function endTurn(state: AgentChatState): AgentChatState {
  return {
    ...state,
    isAwaitingResponse: false,
    statusText: '',
    todos: [],
    activeTools: [],
    toolSteps: [],
    toolErrors: [],
    streamingContent: '',
    stalled: false,
    currentRequestId: null,
  };
}

/** True when an event belongs to another, already-finished, or cancelled turn. */
export function isStaleTurn(state: AgentChatState, message: AgentMessage): boolean {
  const id = message.request_id;
  if (!id) return false;
  return state.currentRequestId !== id || state.resolvedRequestIds.includes(id);
}

function handleStatus(state: AgentChatState, message: AgentMessage): AgentChatState {
  const step = message.data?.step;
  const detail = message.data?.detail;
  const ctx = message.data?.ctx;

  if (step === 'todos') {
    try {
      const parsed = typeof detail === 'string' ? JSON.parse(detail) : detail;
      if (Array.isArray(parsed)) return { ...state, todos: parsed as ProgressTodo[] };
    } catch {
      // non-JSON detail — ignore
    }
    return state;
  }

  if (step === 'tool_start') {
    if (!detail || detail === 'write_todos') return state;
    // Guard against a duplicated tool_start: same name + ctx already running.
    const alreadyRunning = state.toolSteps.some(
      (s) => s.name === detail && s.status === 'in_progress' && s.content.includes(ctx ?? ''),
    );
    if (alreadyRunning) return state;

    const label = humanizeTool(detail);
    const activeTools = [
      ...state.activeTools,
      { id: `${detail}-${state.toolSteps.length}`, name: detail, ctx },
    ];
    return {
      ...state,
      activeTools,
      statusText: aggregateActiveTools(activeTools),
      toolSteps: [
        ...state.toolSteps,
        {
          id: `${detail}-${state.toolSteps.length}`,
          name: detail,
          content: ctx ? `${label}: ${ctx}` : label,
          status: 'in_progress',
        },
      ],
    };
  }

  if (step === 'tool_end') {
    const idx = state.toolSteps.findIndex(
      (s) => s.name === detail && s.status === 'in_progress',
    );
    const toolSteps =
      idx === -1
        ? state.toolSteps
        : state.toolSteps.map((s, i) =>
            i === idx ? { ...s, status: 'completed' as const } : s,
          );
    const removeIdx = state.activeTools.findIndex((t) => t.name === detail);
    const activeTools =
      removeIdx === -1
        ? state.activeTools
        : [
            ...state.activeTools.slice(0, removeIdx),
            ...state.activeTools.slice(removeIdx + 1),
          ];
    return {
      ...state,
      toolSteps,
      activeTools,
      // Keep the previous label when the list empties, so it doesn't flash blank
      // between tool_end and the next status event.
      statusText:
        activeTools.length > 0 ? aggregateActiveTools(activeTools) : state.statusText,
    };
  }

  return { ...state, statusText: humanizeStep(step, detail) };
}

function handleDone(
  state: AgentChatState,
  message: AgentMessage,
  requestId: string,
  parseResponse: (raw: unknown) => string = parseAgentOutput,
  parseExtras?: (raw: unknown, ctx: MessageExtrasContext) => MessageExtras,
): AgentChatState {
  const rawOutput = message.data?.output;

  // `done.output` is authoritative; streamed narration is the fallback only when
  // the turn produced no output at all (PHX-4004). `parseResponse` is the
  // agent's resolved parser (default + any page override); falls back to the
  // built-in when the caller didn't supply one (tests).
  const content =
    rawOutput !== undefined ? parseResponse(rawOutput) : state.streamingContent;

  // The turn is over: a step still in_progress had its tool_end dropped —
  // coerce it so a finished turn never renders a spinner.
  const stepsForMsg: ProgressTodo[] | undefined =
    state.toolSteps.length > 0
      ? state.toolSteps.map(({ content: c, status }) => ({
          content: c,
          status: status === 'in_progress' ? ('completed' as const) : status,
        }))
      : undefined;

  const toolErrors = state.toolErrors.length > 0 ? state.toolErrors : undefined;

  // Chips + buttons this agent attached to the turn. Read from the SAME raw
  // output `parseResponse` sees, through the page's `parseExtras` override, so
  // no agent-specific key lands in the transport.
  // `isFirstReply` lets a page decorate the OPENING answer only (e.g. supply
  // chips the agent doesn't send yet) without repeating them every turn.
  const extras: MessageExtras =
    rawOutput !== undefined && parseExtras
      ? (parseExtras(rawOutput, {
        isFirstReply: !state.messages.some((m) => m.role === 'assistant'),
      }) ?? {})
      : {};
  const chips = extras.chips?.length ? extras.chips : undefined;
  const actions = extras.actions?.length ? extras.actions : undefined;

  // Gate includes steps/errors/extras so a turn with only chips still bubbles.
  const messages =
    content || toolErrors || stepsForMsg || chips || actions
      ? [
          ...state.messages,
          {
            id: `${requestId}-res`,
            role: 'assistant' as const,
            content,
            timestamp: Date.now(),
            toolSteps: stepsForMsg,
            toolErrors,
            chips,
            actions,
          },
        ]
      : state.messages;

  const action = rawOutput !== undefined ? extractAgentAction(rawOutput) : null;

  return endTurn({
    ...state,
    messages,
    lastOutput: rawOutput,
    lastCompletedTurn: { requestId, output: content, raw: rawOutput },
    pendingAction: action,
    resolvedRequestIds: [...state.resolvedRequestIds, requestId],
  });
}

/** Resolve an id-less terminal against the active turn; reject idle/foreign ones. */
function acceptedTerminalRequestId(
  state: AgentChatState,
  message: AgentMessage,
): string | null {
  const requestId = message.request_id ?? state.currentRequestId;
  if (!requestId || requestId !== state.currentRequestId) return null;
  return state.resolvedRequestIds.includes(requestId) ? null : requestId;
}

export function agentChatReducer(
  state: AgentChatState,
  action: ChatAction,
): AgentChatState {
  switch (action.type) {
    case 'send':
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            id: action.requestId,
            role: 'user',
            content: action.text,
            timestamp: action.now,
            attachments: action.attachments?.length ? action.attachments : undefined,
            // A hidden turn stays in state (ordering, request id, history) but
            // renders nothing — the window filters on this flag.
            hidden: action.hidden || undefined,
          },
        ],
        isAwaitingResponse: true,
        error: null,
        currentRequestId: action.requestId,
        // Reset per-turn progress. statusText stays empty so the UI shows its
        // "Thinking…" fallback until the first status event lands.
        statusText: '',
        todos: [],
        activeTools: [],
        toolSteps: [],
        toolErrors: [],
        streamingContent: '',
        stalled: false,
        reconnecting: false,
        lastEventAt: action.now,
      };

    case 'session-status':
      return {
        ...state,
        sessionStatus: action.status,
        error: action.error ?? (action.status === 'error' ? state.error : null),
      };

    case 'session-ready-fallback':
      // A late fallback must not clear a connection error or disturb an acked
      // session. It only releases a session still waiting on the backend ack.
      return state.sessionStatus === 'initializing'
        ? { ...state, sessionStatus: 'ready' }
        : state;

    case 'stall':
      return state.isAwaitingResponse ? { ...state, stalled: true } : state;

    case 'cancel':
      // Stop surfacing the in-flight turn WITHOUT destroying the conversation:
      // mark it resolved so its late done/error is dropped. messages/session are
      // intentionally preserved (PHX-4035).
      return endTurn({
        ...state,
        resolvedRequestIds: state.currentRequestId
          ? [...state.resolvedRequestIds, state.currentRequestId]
          : state.resolvedRequestIds,
      });

    case 'reset':
      return { ...initialChatState(), sessionStatus: state.sessionStatus };

    case 'load-messages':
      return {
        ...endTurn(state),
        messages: action.messages,
        // History carries display messages, not a new live `done.output`.
        lastOutput: undefined,
        lastCompletedTurn: null,
        error: null,
      };

    case 'clear-action':
      return { ...state, pendingAction: null };

    case 'agent-event': {
      const { message, now, parseResponse } = action;

      switch (message.type) {
        case 'session_subscribed':
          return { ...state, sessionStatus: 'ready' };

        case 'reconnecting':
          return { ...state, reconnecting: true };

        case 'reconnected':
          // Refresh the heartbeat so the reconnect gap doesn't trip the stall.
          return { ...state, reconnecting: false, stalled: false, lastEventAt: now };

        case 'disconnected':
          return endTurn({
            ...state,
            reconnecting: false,
            sessionStatus: 'error',
            error: 'Connection lost — please try again.',
          });

        case 'session_title':
          return message.session_id && message.title
            ? {
                ...state,
                sessionTitle: { sessionId: message.session_id, title: message.title },
              }
            : state;

        case 'status': {
          if (isStaleTurn(state, message)) return state;
          const next = handleStatus(state, message);
          return { ...next, lastEventAt: now, stalled: false };
        }

        case 'stream': {
          if (isStaleTurn(state, message)) return state;
          const chunk = message.data?.chunk;
          if (!chunk) return { ...state, lastEventAt: now, stalled: false };
          return {
            ...state,
            streamingContent: state.streamingContent + chunk,
            lastEventAt: now,
            stalled: false,
          };
        }

        case 'tool_error': {
          if (isStaleTurn(state, message)) return state;
          const tool = message.data?.tool;
          const errorCode = message.data?.error_code;
          if (!tool || !errorCode) return { ...state, lastEventAt: now, stalled: false };
          // Drop duplicates delivered by a stacked subscription (PHX-3878).
          const exists = state.toolErrors.some(
            (e) => e.tool === tool && e.errorCode === errorCode,
          );
          return {
            ...state,
            toolErrors: exists
              ? state.toolErrors
              : [...state.toolErrors, { tool, errorCode, message: message.data?.message }],
            lastEventAt: now,
            stalled: false,
          };
        }

        case 'done': {
          // Terminal events self-guard: the FIRST one per request_id wins.
          const requestId = acceptedTerminalRequestId(state, message);
          if (!requestId) return state;
          return handleDone(state, message, requestId, parseResponse, action.parseExtras);
        }

        case 'error': {
          const requestId = acceptedTerminalRequestId(state, message);
          if (!requestId) return state;
          return endTurn({
            ...state,
            error: message.data?.message ?? 'An error occurred',
            resolvedRequestIds: [...state.resolvedRequestIds, requestId],
          });
        }

        default:
          return state;
      }
    }

    default:
      return state;
  }
}
