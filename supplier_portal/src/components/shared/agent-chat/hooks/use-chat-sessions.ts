/**
 * Per-agent session index backing the chat's history dropdown.
 *
 * Runs over REST (see `@/services/session-api`), not the WebSocket. All
 * mutations are optimistic with rollback so the list stays responsive.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  listSessions,
  renameSession,
  deleteSession,
  type ChatSession,
  type SessionScope,
} from '@/services/session-api';

export interface UseChatSessionsReturn {
  sessions: ChatSession[];
  isLoading: boolean;
  error: string | null;
  /** Re-fetch the index for the current agent. */
  refresh: () => void;
  /** Optimistic rename with rollback on failure. */
  rename: (sessionId: string, title: string) => Promise<void>;
  /** Optimistic delete with rollback on failure. */
  remove: (sessionId: string) => Promise<void>;
  /** In-place title patch for the live `session_title` event (no refetch). */
  patchTitle: (sessionId: string, title: string) => void;
}

/**
 * Merge the freshly-fetched server list with any local-only rows the server
 * hasn't returned yet. Server rows win when ids match.
 *
 * NOTE the transient "New chat" row is NOT created here — it's synthesized
 * per-render by `withActiveGhost` (session-groups.ts) and never stored, which
 * is what keeps it from duplicating across chat opens / agent switches. This
 * guard remains so a server refresh can't drop such a row mid-flight.
 */
function reconcile(server: ChatSession[], current: ChatSession[]): ChatSession[] {
  const serverIds = new Set(server.map((s) => s.session_id));
  const optimisticOnly = current.filter(
    (s) => s.message_count === 0 && !serverIds.has(s.session_id),
  );
  return [...optimisticOnly, ...server];
}

export function useChatSessions(
  agentId: string | null,
  scope: SessionScope,
  /** Gate the fetch until the app scope resolves — the endpoints 400 without it. */
  enabled = true,
): UseChatSessionsReturn {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mirror of sessions so callbacks can read/rollback without depending on the
  // array (which would re-create every callback on each list change).
  const sessionsRef = useRef<ChatSession[]>(sessions);
  // Latest scope without making every callback depend on it.
  const scopeRef = useRef<SessionScope>(scope);

  // Synced after commit, not during render: writing a ref while rendering is a
  // rules-of-React violation (it makes render non-idempotent under concurrent
  // rendering). Every reader below is a callback or an effect, both of which
  // run after commit, so post-commit sync is equivalent here.
  useEffect(() => {
    sessionsRef.current = sessions;
    scopeRef.current = scope;
  });

  const setBoth = useCallback((next: ChatSession[]) => {
    sessionsRef.current = next;
    setSessions(next);
  }, []);

  const fetchedAgentRef = useRef<string | null>(null);

  const load = useCallback(
    (agent: string | null) => {
      if (!agent || !enabled || !scopeRef.current.appName) {
        setBoth([]);
        setError(null);
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      setError(null);
      listSessions(agent, scopeRef.current)
        .then((server) => {
          if (fetchedAgentRef.current !== agent) return;
          setBoth(reconcile(server, sessionsRef.current));
          setIsLoading(false);
        })
        .catch((err: unknown) => {
          if (fetchedAgentRef.current !== agent) return;
          // Best-effort: a failing index must never break the chat itself — the
          // user can still hold a live conversation.
          setError(err instanceof Error ? err.message : 'Failed to load chats');
          setIsLoading(false);
        });
    },
    [setBoth, enabled],
  );

  useEffect(() => {
    fetchedAgentRef.current = agentId;
    load(agentId);
  }, [agentId, load]);

  const refresh = useCallback(() => {
    load(fetchedAgentRef.current);
  }, [load]);

  const patchTitle = useCallback(
    (sessionId: string, title: string) => {
      setBoth(
        sessionsRef.current.map((s) => (s.session_id === sessionId ? { ...s, title } : s)),
      );
    },
    [setBoth],
  );

  const rename = useCallback(
    async (sessionId: string, title: string) => {
      if (!fetchedAgentRef.current) return;
      const prev = sessionsRef.current;
      setBoth(prev.map((s) => (s.session_id === sessionId ? { ...s, title } : s)));
      try {
        await renameSession(sessionId, title, scopeRef.current);
      } catch (err) {
        setBoth(prev);
        setError(err instanceof Error ? err.message : 'Failed to rename chat');
      }
    },
    [setBoth],
  );

  const remove = useCallback(
    async (sessionId: string) => {
      if (!fetchedAgentRef.current) return;
      const prev = sessionsRef.current;
      setBoth(prev.filter((s) => s.session_id !== sessionId));
      try {
        await deleteSession(sessionId, scopeRef.current);
      } catch (err) {
        setBoth(prev);
        setError(err instanceof Error ? err.message : 'Failed to delete chat');
      }
    },
    [setBoth],
  );

  return {
    sessions,
    isLoading,
    error,
    refresh,
    rename,
    remove,
    patchTitle,
  };
}
