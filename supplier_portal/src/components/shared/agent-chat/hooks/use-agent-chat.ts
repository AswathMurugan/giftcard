/**
 * `useAgentChat` — drives one agent conversation over the AppSync Events
 * transport.
 *
 * Thin by design: all state rules live in `agent-chat-reducer.ts` (pure, so
 * they're testable in the node vitest env). This file only wires the transport
 * to that reducer — connect/subscribe, publish, and the stall timer.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ChatService, type AgentMessage } from '@/services/chat-service';
import {
  agentChatReducer,
  initialChatState,
  type AgentTurnCompletion,
  type ChatMessage,
  type SessionStatus,
} from './agent-chat-reducer';
import type { AgentMetadata, AgentRequestContext } from '@/components/shared/agent-chat/agent-metadata';
import type { AgentAction } from '@/components/shared/agent-chat/utils/envelope';
import type { ProgressTodo } from '@/components/shared/agent-chat/utils/humanize';
import {
  isCurrentSessionMessage,
  scheduleSessionReadyFallback,
} from '@/components/shared/agent-chat/utils/session-subscription';

/** A turn with no inbound event for this long is treated as stalled. */
const STALL_AFTER_MS = 45_000;
const STALL_CHECK_INTERVAL_MS = 5_000;

export interface SendOptions {
  attachments?: { id: string; filename: string }[];
  /** Extra `inputs` fields (e.g. edit-mode context). */
  extra?: Record<string, unknown>;
  /**
   * Send on the wire WITHOUT a bubble — an opening turn a page fires on the
   * user's behalf (`AgentChat.initialMessage` + `hideInitialMessage`). The
   * payload is identical to a typed turn; only the rendering differs.
   */
  hidden?: boolean;
}

export interface UseAgentChatOptions {
  metadata: AgentMetadata;
  context: AgentRequestContext;
  /** Gate the transport (e.g. until the app scope / user id resolves). */
  enabled?: boolean;
  /** Fired once per agent save. */
  onAction?: (action: AgentAction) => void;
  /**
   * Fired with the final answer of every completed turn: the display text, plus
   * the RAW `done.output` for pages that need the agent's structured payload.
   */
  onDone?: (output: string, raw: unknown) => void;
}

export interface UseAgentChatResult {
  sessionId: string;
  messages: ChatMessage[];
  sessionStatus: SessionStatus;
  isAwaitingResponse: boolean;
  error: string | null;
  statusText: string;
  todos: ProgressTodo[];
  toolSteps: ProgressTodo[];
  stalled: boolean;
  reconnecting: boolean;
  sendMessage: (text: string, opts?: SendOptions) => void;
  /** Stop surfacing the in-flight turn; keeps the conversation. */
  cancel: () => void;
  /** Start a brand-new conversation (fresh session id, cleared thread). */
  startNewSession: () => void;
  /** Open a past chat: adopt its id and show its history. */
  loadSession: (sessionId: string, messages: ChatMessage[]) => void;
  /** Auto-generated title for a session, when the backend sends one. */
  sessionTitle: { sessionId: string; title: string } | null;
}

/** Select only a completion this hook instance has not already reported. */
export function unhandledAgentTurnCompletion(
  completion: AgentTurnCompletion | null,
  handledRequestId: string | null,
): AgentTurnCompletion | null {
  return completion && completion.requestId !== handledRequestId ? completion : null;
}

export function useAgentChat({
  metadata,
  context,
  enabled = true,
  onAction,
  onDone,
}: UseAgentChatOptions): UseAgentChatResult {
  const [state, dispatch] = useReducer(agentChatReducer, undefined, initialChatState);
  // A hook-owned transport is the isolation boundary: concurrent chats/tasks
  // cannot replace each other's subscription, handlers, reconnect, or teardown.
  const [transport] = useState(() => new ChatService());
  const [sessionId, setSessionId] = useState<string>(() => crypto.randomUUID());
  // Synchronous mirror — sendMessage must not read a stale session id.
  const sessionIdRef = useRef<string>(sessionId);
  const isNewSessionRef = useRef(true);

  const { agentId } = metadata;

  const setSession = useCallback((id: string) => {
    sessionIdRef.current = id;
    setSessionId(id);
  }, []);

  // ── Transport: connect + subscribe. Re-runs when the session changes so a
  // loaded/new session re-subscribes to its own channel.
  useEffect(() => {
    if (!enabled || !agentId) return undefined;

    let cancelled = false;
    let cancelReadyFallback: (() => void) | null = null;
    dispatch({ type: 'session-status', status: 'initializing' });

    const init = async () => {
      try {
        await transport.connect();
        if (cancelled) return;
        // Register the session against the agent's OWN app, not the app hosting
        // the chat — an agent is defined in, and routed at, the app that
        // declares it. Falls back to the current app for an unregistered skill.
        await transport.initSession(
          agentId,
          sessionIdRef.current,
          metadata.appDefinition || context.appDefinition,
          context.tenant,
          context.userId,
          metadata.appKey || context.appName,
        );
        if (cancelled) return;
        // Prefer the backend's session-specific acknowledgement, but never let
        // an omitted/malformed ack disable every composer forever. initSession
        // has already awaited AppSync's transport-level subscribe_success.
        cancelReadyFallback = scheduleSessionReadyFallback(() => {
          if (!cancelled) dispatch({ type: 'session-ready-fallback' });
        });
      } catch (err) {
        if (cancelled) return;
        dispatch({
          type: 'session-status',
          status: 'error',
          error: err instanceof Error ? err.message : 'Failed to connect to agent',
        });
      }
    };

    void init();

    return () => {
      cancelled = true;
      cancelReadyFallback?.();
      transport.disconnect();
    };
  }, [
    enabled,
    agentId,
    metadata.appKey,
    metadata.appDefinition,
    sessionId,
    context.appDefinition,
    context.tenant,
    context.userId,
    context.appName,
    transport,
  ]);

  // ── Transport: inbound events → reducer.
  // Held in a ref so the onMessage subscription (below) doesn't re-subscribe
  // when the page passes a fresh `parseResponse` arrow each render — the socket
  // callback reads the current parser without depending on it.
  // Assigned during render ON PURPOSE: the socket callback must read the parser
  // the page passed for THIS render, and an effect-synced ref would leave the
  // first event of a turn parsing with the previous one. Writing a ref (not
  // state) during render triggers no re-render, so the lint rule is waived here.
  /* eslint-disable react-hooks/refs -- deliberate render-time ref sync, see above */
  const parseResponseRef = useRef(metadata.parseResponse);
  parseResponseRef.current = metadata.parseResponse;
  // Same treatment for the chips/actions reader.
  const parseExtrasRef = useRef(metadata.parseExtras);
  parseExtrasRef.current = metadata.parseExtras;
  /* eslint-enable react-hooks/refs */

  useEffect(() => {
    if (!enabled) return undefined;
    return transport.onMessage((message: AgentMessage) => {
      if (!isCurrentSessionMessage(message, agentId, sessionIdRef.current)) return;
      dispatch({
        type: 'agent-event',
        message,
        now: Date.now(),
        // The agent's resolved parser (default + any page override); the
        // reducer stays pure by receiving it rather than importing it.
        parseResponse: parseResponseRef.current,
        parseExtras: parseExtrasRef.current,
      });
    });
  }, [enabled, agentId, transport]);

  // ── Stall watchdog. Advisory only: it never fails the turn (a long turn may
  // still recover), it just lets the UI offer a Stop affordance.
  useEffect(() => {
    if (!state.isAwaitingResponse) return undefined;
    const id = setInterval(() => {
      if (Date.now() - state.lastEventAt > STALL_AFTER_MS) {
        dispatch({ type: 'stall' });
      }
    }, STALL_CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [state.isAwaitingResponse, state.lastEventAt]);

  // ── Surface a completed save to the page, exactly once.
  useEffect(() => {
    if (!state.pendingAction) return;
    onAction?.(state.pendingAction);
    dispatch({ type: 'clear-action' });
  }, [state.pendingAction, onAction]);

  // ── Fire onDone for each accepted LIVE done, even when there is no bubble.
  const lastDoneRequestIdRef = useRef<string | null>(null);
  useEffect(() => {
    const completion = unhandledAgentTurnCompletion(
      state.lastCompletedTurn,
      lastDoneRequestIdRef.current,
    );
    if (!completion) return;
    // Advance even without a callback so adding one later cannot replay an old
    // live completion. Set before invoking so a throwing callback is one-shot.
    lastDoneRequestIdRef.current = completion.requestId;
    onDone?.(completion.output, completion.raw);
  }, [state.lastCompletedTurn, onDone]);

  const sendMessage = useCallback(
    (text: string, opts: SendOptions = {}) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (state.sessionStatus !== 'ready') return;

      const requestId = `req-${Date.now()}`;
      dispatch({
        type: 'send',
        requestId,
        text: trimmed,
        attachments: opts.attachments,
        now: Date.now(),
        hidden: opts.hidden,
      });

      const payload = metadata.buildPayload({
        text: trimmed,
        requestId,
        sessionId: sessionIdRef.current,
        context,
        attachments: opts.attachments,
        newSession: isNewSessionRef.current,
        extra: opts.extra,
      });
      isNewSessionRef.current = false;

      try {
        transport.sendRawMessage(agentId, sessionIdRef.current, payload);
      } catch (err) {
        dispatch({
          type: 'agent-event',
          message: {
            type: 'error',
            request_id: requestId,
            data: {
              message: err instanceof Error ? err.message : 'Failed to send message',
            },
          },
          now: Date.now(),
        });
      }
    },
    [agentId, context, metadata, state.sessionStatus, transport],
  );

  const cancel = useCallback(() => dispatch({ type: 'cancel' }), []);

  const startNewSession = useCallback(() => {
    isNewSessionRef.current = true;
    dispatch({ type: 'reset' });
    setSession(crypto.randomUUID());
  }, [setSession]);

  const loadSession = useCallback(
    (id: string, messages: ChatMessage[]) => {
      if (id === sessionIdRef.current) return;
      isNewSessionRef.current = false;
      dispatch({ type: 'load-messages', messages });
      setSession(id);
    },
    [setSession],
  );

  // Drop the internal id/name matching fields the UI doesn't need.
  const toolSteps = useMemo<ProgressTodo[]>(
    () => state.toolSteps.map(({ content, status }) => ({ content, status })),
    [state.toolSteps],
  );

  return {
    sessionId,
    messages: state.messages,
    sessionStatus: state.sessionStatus,
    isAwaitingResponse: state.isAwaitingResponse,
    error: state.error,
    statusText: state.statusText,
    todos: state.todos,
    toolSteps,
    stalled: state.stalled,
    reconnecting: state.reconnecting,
    sendMessage,
    cancel,
    startNewSession,
    loadSession,
    sessionTitle: state.sessionTitle,
  };
}
