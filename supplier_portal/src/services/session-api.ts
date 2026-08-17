/**
 * Chat session REST API — the history dropdown's data source.
 *
 * Runs over the `agentframework` service (registered in `api-config.ts`), NOT
 * the WebSocket: the live send+stream path is AppSync; this is just the list of
 * past chats and their checkpoints.
 *
 * Scope headers: the api-manager's auth provider injects `Authorization` and the
 * tenant header centrally; the app/user scope headers are per-call and added
 * here (the endpoints 400 without them).
 */

import { apiManager } from '@/services/api-manager';

const AGENT_FRAMEWORK_KEY = 'agentframework';

/** Scope every session call needs beyond what the auth provider injects. */
export interface SessionScope {
  /** Sent as x-jiffy-app-name — required by the session endpoints. */
  appName: string;
  /** Sent as x-jiffy-app-definition-key for finer scoping. */
  appDefinition: string;
  userId: string;
}

/** A row in the session index. `title` is null until auto-titling fills it in. */
export interface ChatSession {
  session_id: string;
  title: string | null;
  preview: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

/**
 * One decoded checkpoint message. `type` decides rendering:
 * 'str' → text, 'dict' → structured payload (e.g. a save receipt).
 */
export interface SessionMessage {
  role: 'user' | 'ai';
  data: string | Record<string, unknown>;
  type: 'str' | 'dict';
}

// ── Endpoints ───────────────────────────────────────────────────────────────

/** Sessions are scoped by headers, so only the agent name is in the path. */
const sessionsEndpoint = (agentName: string): string =>
  `/agents/${encodeURIComponent(agentName)}/sessions`;

/** Load/rename/delete resolve the session from its id alone. */
const sessionByIdEndpoint = (sessionId: string): string =>
  `/sessions/${encodeURIComponent(sessionId)}`;

const sessionMessagesEndpoint = (sessionId: string): string =>
  `/sessions/${encodeURIComponent(sessionId)}/messages`;

/** Best-effort message from an axios-style error. */
function apiErrorMessage(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: unknown } } | undefined)?.response?.data;
  if (typeof data === 'string' && data) return data;
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    for (const key of ['message', 'error', 'detail']) {
      if (typeof d[key] === 'string' && d[key]) return d[key] as string;
    }
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

function scopeHeaders(scope: SessionScope): Record<string, string> {
  const headers: Record<string, string> = {};
  if (scope.appName) headers['x-jiffy-app-name'] = scope.appName;
  if (scope.appDefinition) headers['x-jiffy-app-definition-key'] = scope.appDefinition;
  if (scope.userId) headers['x-jiffy-user-id'] = scope.userId;
  return headers;
}

// ── Calls ───────────────────────────────────────────────────────────────────

/** List an agent's sessions, newest-first (the backend sorts by updated_at). */
export async function listSessions(
  agentName: string,
  scope: SessionScope,
): Promise<ChatSession[]> {
  try {
    const response = await apiManager.get(
      AGENT_FRAMEWORK_KEY,
      sessionsEndpoint(agentName),
      scopeHeaders(scope),
    );
    const data = response?.data as { sessions?: ChatSession[] } | undefined;
    return Array.isArray(data?.sessions) ? data.sessions : [];
  } catch (err) {
    throw new Error(apiErrorMessage(err, 'Failed to load chats'));
  }
}

/** Load a session's conversation by id. */
export async function loadMessages(
  sessionId: string,
  scope: SessionScope,
): Promise<SessionMessage[]> {
  try {
    const response = await apiManager.get(
      AGENT_FRAMEWORK_KEY,
      sessionMessagesEndpoint(sessionId),
      scopeHeaders(scope),
    );
    const data = response?.data as { messages?: SessionMessage[] } | undefined;
    return Array.isArray(data?.messages) ? data.messages : [];
  } catch (err) {
    throw new Error(apiErrorMessage(err, 'Failed to load chat history'));
  }
}

/** Rename a chat. `PATCH /sessions/{id}` with `{ title }`. */
export async function renameSession(
  sessionId: string,
  title: string,
  scope: SessionScope,
): Promise<ChatSession> {
  try {
    const response = await apiManager.patch(
      AGENT_FRAMEWORK_KEY,
      sessionByIdEndpoint(sessionId),
      { title },
      scopeHeaders(scope),
    );
    return response?.data as ChatSession;
  } catch (err) {
    throw new Error(apiErrorMessage(err, 'Failed to rename chat'));
  }
}

/** Delete a chat. `DELETE /sessions/{id}`. */
export async function deleteSession(
  sessionId: string,
  scope: SessionScope,
): Promise<void> {
  try {
    await apiManager.delete(
      AGENT_FRAMEWORK_KEY,
      sessionByIdEndpoint(sessionId),
      scopeHeaders(scope),
    );
  } catch (err) {
    throw new Error(apiErrorMessage(err, 'Failed to delete chat'));
  }
}
