import type { AgentMessage } from '@/services/chat-service';
import { agentChannelPath } from '@/services/chat-channel';

/** Do not leave every composer disabled forever when the backend omits its ack. */
export const SESSION_READY_FALLBACK_MS = 5_000;

/**
 * True only for an event owned by the currently active agent session. The
 * transport stamps data and synthetic lifecycle events with their source
 * channel; agent/session fields remain a compatibility fallback.
 */
export function isCurrentSessionMessage(
  message: AgentMessage,
  agentName: string,
  sessionId: string,
): boolean {
  const expectedChannel = agentChannelPath(agentName, sessionId);
  if (message.channel) return message.channel === expectedChannel;
  return message.agent_name === agentName && message.session_id === sessionId;
}

/** Compatibility alias for callers that only validate the readiness event. */
export function isCurrentSessionSubscription(
  message: AgentMessage,
  agentName: string,
  sessionId: string,
): boolean {
  return message.type === 'session_subscribed'
    && (message.channel === agentChannelPath(agentName, sessionId)
      || (message.agent_name === agentName && message.session_id === sessionId));
}

/** Schedule the bounded fallback and return its cleanup for session changes. */
export function scheduleSessionReadyFallback(
  onReady: () => void,
  delay: number = SESSION_READY_FALLBACK_MS,
): () => void {
  const timeoutId = setTimeout(onReady, delay);
  return () => clearTimeout(timeoutId);
}
