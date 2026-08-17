/**
 * Agent chat transport — AWS AppSync **Events** API over a raw WebSocket.
 *
 * Pub/sub over channels, NOT GraphQL: `subscribe` + `publish` frames on
 * `/default/…` channels, spoken with the `aws-appsync-event-ws` subprotocol.
 *
 * Two hard-won behaviours are preserved verbatim — do not "simplify" them:
 *   - PHX-3878: `unsubscribe` MUST quote the subscribe's own id, else the server
 *     keeps the sub alive, the next subscribe stacks another on the same
 *     channel, and every message is delivered N times.
 *   - PHX-3993: auto-reconnect, because a long agent turn outlives network blips.
 *
 * Each consumer owns one instance. Keeping socket, subscription, reconnect, and
 * handler state together prevents concurrent agent sessions from crossing.
 */

import { getAppSyncEventsConfig, describeConfigFailure } from './appsync-config';
import {
  LISTENER_CHANNEL,
  agentChannelPath,
  createAuthHeader,
  extractHost,
} from './chat-channel';

const APPSYNC_MESSAGE_TYPES = {
  CONNECTION_INIT: 'connection_init',
  SUBSCRIBE: 'subscribe',
  UNSUBSCRIBE: 'unsubscribe',
  PUBLISH: 'publish',
} as const;

const APPSYNC_RESPONSE_TYPES = {
  CONNECTION_ACK: 'connection_ack',
  CONNECTION_ERROR: 'connection_error',
  SUBSCRIBE_SUCCESS: 'subscribe_success',
  SUBSCRIBE_ERROR: 'subscribe_error',
  DATA: 'data',
} as const;

const TIMING = {
  CONNECTION_TIMEOUT: 30_000,
  /** Deferred so a StrictMode double-invoke doesn't tear the socket down. */
  DISCONNECT_DELAY: 100,
} as const;

// Capped exponential backoff; on exhaustion we fall through to manual retry.
const RECONNECT = {
  BASE_DELAY: 500,
  MAX_DELAY: 8_000,
  MAX_ATTEMPTS: 5,
} as const;

export type ChatConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

/** Synthetic connection-lifecycle events pushed to message handlers. */
export type ConnectionEventType = 'reconnecting' | 'reconnected' | 'disconnected';

/** An event published by the agent backend onto the session channel. */
export interface AgentMessage {
  type: string;
  agent_name?: string;
  timestamp?: string;
  data?: {
    output?: unknown;
    message?: string;
    chunk?: string;
    /** `status` — backend phase / node name. */
    step?: string;
    /** `status` — free-form detail (tool name, todos JSON, …). */
    detail?: string;
    /** `status` — optional tool context (e.g. a filename). */
    ctx?: string;
    /** `tool_error` — the tool that failed. */
    tool?: string;
    /** `tool_error` — structured error code. */
    error_code?: string;
  };
  request_id?: string;
  /** Transport-owned source channel, injected from the AppSync data frame. */
  channel?: string;
  /** `session_title` — carried at the top level, not under `data`. */
  session_id?: string;
  title?: string;
}

type MessageHandler = (message: AgentMessage) => void;

interface SubscriptionResolver {
  resolve: () => void;
  reject: (err: Error) => void;
}

interface AppSyncFrame {
  type: string;
  id?: string;
  channel?: string;
  events?: string[];
  event?: string;
  authorization?: { host: string; Authorization: string };
}

let messageIdCounter = 0;

export class ChatService {
  private messageHandlers: Set<MessageHandler> = new Set();
  private connectionStatus: ChatConnectionStatus = 'disconnected';
  private ws: WebSocket | null = null;
  private host = '';
  private authToken = '';
  private currentChannel: string | null = null;
  /**
   * The subscription id used for `currentChannel`. AppSync identifies a
   * subscription by this id, NOT by channel — see `unsubscribeFromCurrentChannel`.
   */
  private currentSubId: string | null = null;
  private activeConnections = 0;
  private connectPromise: Promise<void> | null = null;
  private disconnectTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private pendingSubscriptions = new Map<string, SubscriptionResolver>();
  /** Includes retired ids so late frames keep their original channel identity;
   * bounded by session switches and cleared when this transport disconnects. */
  private subscriptionChannels = new Map<string, string>();
  private intentionalClose = false;
  private reconnecting = false;
  private reconnectAttempt = 0;
  private reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private lastSessionChannel: string | null = null;
  private lastSessionPayload: Record<string, unknown> | null = null;

  async connect(): Promise<void> {
    // An explicit connect supersedes an in-flight auto-reconnect (e.g. the user
    // hit Retry) — otherwise we'd end up with two sockets.
    this.cancelReconnect();

    if (this.disconnectTimeoutId) {
      clearTimeout(this.disconnectTimeoutId);
      this.disconnectTimeoutId = null;
    }

    this.activeConnections++;

    if (this.connectionStatus === 'connected' && this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    if (this.connectPromise) return this.connectPromise;

    this.connectionStatus = 'connecting';
    this.connectPromise = this.establishConnection();
    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  private establishConnection(): Promise<void> {
    const config = getAppSyncEventsConfig();
    if (!config) {
      this.connectionStatus = 'error';
      return Promise.reject(new Error(describeConfigFailure()));
    }

    this.host = extractHost(config.wsUrl);
    this.authToken = config.authToken;

    return new Promise((resolve, reject) => {
      try {
        const authHeader = createAuthHeader(this.host, this.authToken);
        // AppSync smuggles auth through the subprotocol array.
        this.ws = new WebSocket(config.wsUrl, [
          'aws-appsync-event-ws',
          `header-${authHeader}`,
        ]);

        const connectionTimeout = setTimeout(() => {
          if (this.connectionStatus === 'connecting') {
            this.ws?.close();
            reject(new Error('Connection timeout'));
          }
        }, TIMING.CONNECTION_TIMEOUT);

        this.ws.onopen = () => {
          this.ws?.send(JSON.stringify({ type: APPSYNC_MESSAGE_TYPES.CONNECTION_INIT }));
        };

        this.ws.onmessage = (event) => {
          try {
            const frame = JSON.parse(event.data as string) as AppSyncFrame;
            this.handleProtocolMessage(frame, resolve, reject, connectionTimeout);
          } catch {
            // ignore parse errors
          }
        };

        this.ws.onerror = () => {
          clearTimeout(connectionTimeout);
          this.connectionStatus = 'error';
          reject(new Error('WebSocket connection error'));
        };

        this.ws.onclose = () => {
          clearTimeout(connectionTimeout);
          this.connectionStatus = 'disconnected';
          this.rejectPendingSubscriptions(new Error('WebSocket closed while subscribing'));
          this.currentChannel = null;
          this.currentSubId = null;
          this.subscriptionChannels.clear();

          if (this.intentionalClose) {
            this.intentionalClose = false;
            return;
          }
          // Nobody is waiting on the connection — stay silent.
          if (this.activeConnections <= 0) return;
          // Unexpected drop with a live consumer: recover when there's a session
          // to restore; otherwise surface a plain disconnect.
          if (this.lastSessionChannel) {
            this.scheduleReconnect();
          } else {
            this.notifyConnectionEvent('disconnected');
          }
        };
      } catch (error) {
        this.connectionStatus = 'error';
        reject(error);
      }
    });
  }

  private handleProtocolMessage(
    frame: AppSyncFrame,
    resolve: () => void,
    reject: (err: Error) => void,
    connectionTimeout: ReturnType<typeof setTimeout>,
  ): void {
    switch (frame.type) {
      case APPSYNC_RESPONSE_TYPES.CONNECTION_ACK:
        clearTimeout(connectionTimeout);
        this.connectionStatus = 'connected';
        resolve();
        break;

      case APPSYNC_RESPONSE_TYPES.SUBSCRIBE_SUCCESS:
        this.settleSubscription(frame.id, 'resolve');
        break;

      case APPSYNC_RESPONSE_TYPES.SUBSCRIBE_ERROR:
        this.settleSubscription(
          frame.id,
          'reject',
          new Error('Failed to subscribe to agent channel'),
        );
        break;

      case APPSYNC_RESPONSE_TYPES.DATA:
        if (frame.event) {
          try {
            const message = JSON.parse(frame.event) as AgentMessage;
            const channel = this.resolveDataChannel(frame, message);
            // Without a source channel there is no ownership-safe route.
            if (channel) this.notifyHandlers({ ...message, channel });
          } catch {
            // ignore parse errors
          }
        }
        break;

      case APPSYNC_RESPONSE_TYPES.CONNECTION_ERROR:
        clearTimeout(connectionTimeout);
        this.connectionStatus = 'error';
        reject(new Error('Connection error from server'));
        break;

      default:
        // `ka` (keep-alive) and anything unknown — ignore.
        break;
    }
  }

  private resolveDataChannel(
    frame: AppSyncFrame,
    message: AgentMessage,
  ): string | undefined {
    if (frame.id) {
      // The id-to-channel map is authoritative, including for retired ids. A
      // late frame must retain its old identity so the current owner rejects it.
      const subscriptionChannel = this.subscriptionChannels.get(frame.id);
      if (subscriptionChannel) return subscriptionChannel;

      // An unknown id is still identified data: preserve an explicit source if
      // one exists, but never relabel it as this instance's active subscription.
      return frame.channel ?? message.channel;
    }

    const explicitChannel = frame.channel ?? message.channel;
    if (explicitChannel) return explicitChannel;

    // AppSync may omit every source field from DATA frames. This fallback is
    // owner-local because each ChatService has one socket and one active
    // subscription. After a session switch, however, an unidentified late
    // frame is indistinguishable from current-session data and may be attributed
    // to currentChannel; retaining ids above is the only unambiguous stale-frame
    // protection available from the protocol.
    return this.currentChannel ?? undefined;
  }

  private subscribeToChannel(channel: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const subId = `chat-sub-${++messageIdCounter}`;
      // Set channel + subId EAGERLY (before the ack) so a racing unsubscribe
      // quotes the right id. On rejection we roll back — otherwise the
      // initSession idempotency guard would treat a failed channel as
      // "already subscribed" and swallow every retry.
      this.currentChannel = channel;
      this.currentSubId = subId;
      this.subscriptionChannels.set(subId, channel);
      this.pendingSubscriptions.set(subId, {
        resolve,
        reject: (err) => {
          // Only roll back if our subscribe is still the active one — a later
          // subscribe may have superseded it.
          if (this.currentSubId === subId) {
            this.currentChannel = null;
            this.currentSubId = null;
          }
          reject(err);
        },
      });

      const frame: AppSyncFrame = {
        type: APPSYNC_MESSAGE_TYPES.SUBSCRIBE,
        id: subId,
        channel,
        authorization: {
          host: this.host,
          Authorization: `Bearer ${this.authToken}`,
        },
      };
      this.ws?.send(JSON.stringify(frame));
    });
  }

  private unsubscribeFromCurrentChannel(): void {
    const subId = this.currentSubId;
    this.currentChannel = null;
    this.currentSubId = null;

    if (subId) {
      const pending = this.pendingSubscriptions.get(subId);
      this.pendingSubscriptions.delete(subId);
      pending?.reject(new Error('Agent channel subscription was replaced'));
    }

    if (!subId || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    // MUST quote the subscribe's id. Using a fresh id + a `channel` field makes
    // AppSync silently ignore the unsubscribe: the server keeps the sub alive,
    // the next subscribe stacks another on the same channel, and every message
    // is then delivered N times (PHX-3878).
    this.ws.send(JSON.stringify({ type: APPSYNC_MESSAGE_TYPES.UNSUBSCRIBE, id: subId }));
  }

  private publishToChannel<T>(channel: string, message: T): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }
    const frame: AppSyncFrame = {
      type: APPSYNC_MESSAGE_TYPES.PUBLISH,
      id: `chat-pub-${++messageIdCounter}`,
      channel,
      events: [JSON.stringify(message)],
      authorization: {
        host: this.host,
        Authorization: `Bearer ${this.authToken}`,
      },
    };
    this.ws.send(JSON.stringify(frame));
  }

  private notifyConnectionEvent(type: ConnectionEventType): void {
    const channel = this.lastSessionChannel ?? this.currentChannel ?? undefined;
    this.notifyHandlers({ type, channel });
  }

  private settleSubscription(
    frameId: string | undefined,
    outcome: 'resolve' | 'reject',
    error?: Error,
  ): void {
    const id = frameId
      ?? (this.pendingSubscriptions.size === 1
        ? this.pendingSubscriptions.keys().next().value
        : undefined);
    if (!id) return;
    const pending = this.pendingSubscriptions.get(id);
    if (!pending) return;
    this.pendingSubscriptions.delete(id);
    if (outcome === 'resolve') pending.resolve();
    else pending.reject(error ?? new Error('Failed to subscribe to agent channel'));
  }

  private rejectPendingSubscriptions(error: Error): void {
    const pending = [...this.pendingSubscriptions.values()];
    this.pendingSubscriptions.clear();
    pending.forEach(({ reject }) => reject(error));
  }

  /** Single recovery loop after an unexpected close. Idempotent. */
  private scheduleReconnect(): void {
    if (this.reconnecting) return;
    this.reconnecting = true;
    this.reconnectAttempt = 0;
    this.notifyConnectionEvent('reconnecting');
    this.attemptReconnect();
  }

  private attemptReconnect(): void {
    const delay = Math.min(
      RECONNECT.BASE_DELAY * 2 ** this.reconnectAttempt,
      RECONNECT.MAX_DELAY,
    );
    this.reconnectTimeoutId = setTimeout(() => {
      this.reconnectTimeoutId = null;
      // The consumer may have unmounted during the backoff.
      if (this.activeConnections <= 0 || !this.lastSessionChannel) {
        this.cancelReconnect();
        this.notifyConnectionEvent('disconnected');
        return;
      }
      void this.reconnectOnce();
    }, delay);
  }

  private async reconnectOnce(): Promise<void> {
    try {
      this.connectionStatus = 'connecting';
      await this.establishConnection();
      // An explicit connect() may have cancelled this loop while we awaited.
      if (!this.reconnecting) return;
      // Restore the same channel + heartbeat on the fresh socket.
      await this.subscribeToChannel(this.lastSessionChannel as string);
      if (!this.reconnecting) return;
      if (this.lastSessionPayload) {
        this.publishToChannel(LISTENER_CHANNEL, this.lastSessionPayload);
      }
      this.reconnecting = false;
      this.reconnectAttempt = 0;
      this.notifyConnectionEvent('reconnected');
    } catch {
      this.reconnectAttempt++;
      if (this.reconnectAttempt >= RECONNECT.MAX_ATTEMPTS) {
        this.reconnecting = false;
        this.notifyConnectionEvent('disconnected');
        return;
      }
      this.attemptReconnect();
    }
  }

  private cancelReconnect(): void {
    this.reconnecting = false;
    this.reconnectAttempt = 0;
    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }
  }

  /**
   * Subscribe to a session's response channel and register the session with the
   * backend. The `subscribe_session` publish doubles as a TTL heartbeat.
   */
  async initSession(
    agentName: string,
    sessionId: string,
    appDefinition: string,
    tenant: string,
    userId: string,
    appName = '',
  ): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected. Call connect() first.');
    }

    const channel = agentChannelPath(agentName, sessionId);
    const sessionPayload = {
      type: 'subscribe_session',
      agent_name: agentName,
      session_id: sessionId,
      app_name: appName,
      app_definition: appDefinition,
      tenant,
      user_id: userId,
    };

    // Remember the session so an unexpected close can restore it verbatim.
    this.lastSessionChannel = channel;
    this.lastSessionPayload = sessionPayload;

    // Already on this channel → only refresh the TTL heartbeat. Skipping the
    // unsubscribe+resubscribe avoids piling sub_ids on one channel (PHX-3878).
    if (this.currentChannel === channel) {
      this.publishToChannel(LISTENER_CHANNEL, sessionPayload);
      return;
    }

    if (this.currentChannel) this.unsubscribeFromCurrentChannel();

    await this.subscribeToChannel(channel);
    this.publishToChannel(LISTENER_CHANNEL, sessionPayload);
  }

  /** Publish a pre-built invocation payload to the agent's session channel. */
  sendRawMessage(
    agentName: string,
    sessionId: string,
    payload: Record<string, unknown>,
  ): void {
    this.publishToChannel(agentChannelPath(agentName, sessionId), payload);
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  private notifyHandlers(message: AgentMessage): void {
    this.messageHandlers.forEach((handler) => handler(message));
  }

  /** Refcounted. The real teardown is deferred so StrictMode remounts survive. */
  disconnect(): void {
    this.activeConnections = Math.max(0, this.activeConnections - 1);
    if (this.activeConnections > 0) return;

    this.disconnectTimeoutId = setTimeout(() => {
      this.disconnectTimeoutId = null;
      this.performDisconnect();
    }, TIMING.DISCONNECT_DELAY);
  }

  private performDisconnect(): void {
    if (this.activeConnections > 0) return;

    this.cancelReconnect();
    this.unsubscribeFromCurrentChannel();
    this.rejectPendingSubscriptions(new Error('Agent chat disconnected'));
    this.subscriptionChannels.clear();
    this.lastSessionChannel = null;
    this.lastSessionPayload = null;

    if (this.ws) {
      this.intentionalClose = true;
      this.ws.close();
      this.ws = null;
    }
    this.connectionStatus = 'disconnected';
  }

  isConnected(): boolean {
    return (
      this.connectionStatus === 'connected' && this.ws?.readyState === WebSocket.OPEN
    );
  }

  getConnectionStatus(): ChatConnectionStatus {
    return this.connectionStatus;
  }
}
