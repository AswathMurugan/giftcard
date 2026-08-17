/**
 * `useAgentTask` — run an agent ONCE, headlessly. No panel, no launcher, no
 * transcript: a page hands the agent some input (typically a document it just
 * uploaded) and awaits the answer.
 *
 * Use it when the agent is a FEATURE of a screen ("read this ID and fill the
 * form"), not a conversation. Use `<AgentChat>` when the user is meant to talk
 * to it. Same transport, same envelope, same session semantics underneath —
 * this only drops the UI.
 *
 *   const extract = useAgentTask('doc-extraction-agent');
 *   const { raw } = await extract.run('Extract the client details.', {
 *     attachments: [{ id: driveFileId, filename }],
 *     extra: { schema },
 *   });
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildAgentMetadata } from '@/components/shared/agent-chat/agent-metadata';
import type { SkillName } from '@/types/skills.generated';
import { useAgentChat } from './use-agent-chat';
import { useAgentRequestContext } from './use-agent-identity';

export interface AgentTaskAttachment {
  id: string;
  filename: string;
}

export interface AgentTaskRunOptions {
  attachments?: AgentTaskAttachment[];
  /** Extra `inputs` fields for this turn (e.g. the schema to fill). */
  extra?: Record<string, unknown>;
}

export interface AgentTaskResult {
  /** The agent's RAW `done.output` — parse it with the page's own reader. */
  raw: unknown;
  /** The same output as display text (the skill's resolved parser). */
  text: string;
}

export interface UseAgentTaskResult {
  run: (message: string, options?: AgentTaskRunOptions) => Promise<AgentTaskResult>;
  /** A run is in flight (connecting, waiting, or streaming). */
  isRunning: boolean;
  /** Last failure, cleared when the next run starts. */
  error: string | null;
}

export interface PendingAgentTask {
  resolve: (result: AgentTaskResult) => void;
  reject: (error: Error) => void;
  timer: number;
}

/** Settle and clear a pending task atomically so every terminal path is one-shot. */
export function settlePendingAgentTask(
  pendingRef: { current: PendingAgentTask | null },
  outcome: AgentTaskResult | Error,
  clearTimer: (timer: number) => void,
): boolean {
  const pending = pendingRef.current;
  if (!pending) return false;
  pendingRef.current = null;
  clearTimer(pending.timer);
  if (outcome instanceof Error) pending.reject(outcome);
  else pending.resolve(outcome);
  return true;
}

/** How long to wait for a turn before giving up. Document reads are slow. */
const DEFAULT_TIMEOUT_MS = 180_000;

/** A run cannot start on top of another run or a failed transport. */
export function agentTaskStartError(hasPendingRun: boolean, chatError: string | null): Error | null {
  if (hasPendingRun) return new Error('An agent task is already running.');
  return chatError ? new Error(chatError) : null;
}

/** A headless task pays for a socket only after its first `run`. */
export function shouldEnableAgentTask(hasRun: boolean, userId: string): boolean {
  return hasRun && Boolean(userId);
}

/** Keep a pre-ready task queued; release it exactly when the session is ready. */
export function queuedAgentTaskToSend<T>(ready: boolean, queued: T | null): T | null {
  return ready ? queued : null;
}

export function useAgentTask(
  skill: SkillName | (string & {}),
  options: { timeoutMs?: number } = {},
): UseAgentTaskResult {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const context = useAgentRequestContext();

  const [isRunning, setIsRunning] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  // Only ever set from callbacks/timers (never inside an effect); a transport
  // failure is surfaced by folding `chat.error` in at the end.
  const [error, setError] = useState<string | null>(null);

  // Nothing to override: the raw output arrives with `onDone` below.
  const metadata = useMemo(() => buildAgentMetadata(skill), [skill]);

  // A run requested before identity/socket readiness waits here.
  const queuedRef = useRef<{ message: string; options?: AgentTaskRunOptions } | null>(null);
  const pendingRef = useRef<PendingAgentTask | null>(null);

  /** Settle the in-flight run exactly once. */
  const settle = useCallback((outcome: AgentTaskResult | Error) => {
    if (!settlePendingAgentTask(pendingRef, outcome, window.clearTimeout)) return;
    queuedRef.current = null;
    setIsRunning(false);
  }, []);

  const onDone = useCallback((text: string, raw: unknown) => {
    settle({ raw, text });
  }, [settle]);

  const enabled = shouldEnableAgentTask(hasRun, context.userId);
  const chat = useAgentChat({ metadata, context, enabled, onDone });
  const { sessionStatus, sendMessage, error: chatError } = chat;

  // A run asked for before the socket is ready waits here; the effect below
  // flushes it on the first ready render, so callers never poll for readiness.
  const [queueTick, setQueueTick] = useState(0);
  useEffect(() => {
    const queued = queuedAgentTaskToSend(sessionStatus === 'ready', queuedRef.current);
    if (!queued) return;
    queuedRef.current = null;
    sendMessage(queued.message, {
      attachments: queued.options?.attachments,
      extra: queued.options?.extra,
      // Nothing renders this thread, but the turn is real — keep it out of any
      // transcript a later `<AgentChat>` might load for this session.
      hidden: true,
    });
  }, [sessionStatus, sendMessage, queueTick]);

  // A transport error fails the run rather than hanging it. No setState here —
  // `chatError` is already state, and it is folded into the returned `error`.
  useEffect(() => {
    if (!chatError) return;
    settle(new Error(chatError));
  }, [chatError, settle]);

  const run = useCallback(
    (message: string, runOptions?: AgentTaskRunOptions) => new Promise<AgentTaskResult>((resolve, reject) => {
      // The chat-error effect only observes CHANGES. If the transport had
      // already failed before this run began, reject here instead of creating a
      // pending task that can only die at the three-minute timeout.
      const startError = agentTaskStartError(Boolean(pendingRef.current), chatError);
      if (startError) {
        reject(startError);
        return;
      }
      setError(null);
      setIsRunning(true);
      setHasRun(true);
      const timer = window.setTimeout(() => {
        setError('The agent took too long to respond.');
        settle(new Error('Agent task timed out.'));
      }, timeoutMs);
      pendingRef.current = { resolve, reject, timer };
      queuedRef.current = { message, options: runOptions };
      // Always queue, then nudge the flush effect: `run` stays independent of
      // the socket's current state, and one path sends every turn.
      setQueueTick((tick) => tick + 1);
    }),
    [chatError, settle, timeoutMs],
  );

  // Never leave a caller awaiting a promise that can no longer settle.
  useEffect(() => () => {
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    window.clearTimeout(pending.timer);
    pending.reject(new Error('The agent task was cancelled.'));
  }, []);

  return { run, isRunning, error: error ?? chatError };
}
