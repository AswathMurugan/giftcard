import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isCurrentSessionMessage } from '@/components/shared/agent-chat/utils/session-subscription';
import { agentChannelPath } from './chat-channel';
import { ChatService, type AgentMessage } from './chat-service';

vi.mock('./appsync-config', () => ({
  getAppSyncEventsConfig: () => ({
    wsUrl: 'wss://events.example.com/event/realtime',
    authToken: 'test-token',
  }),
  describeConfigFailure: () => 'Missing test config',
}));

interface TestFrame {
  type: string;
  id?: string;
  channel?: string;
  event?: string;
}

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readonly sent: TestFrame[] = [];
  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  readonly url: string;
  readonly protocols: string[];

  constructor(url: string, protocols: string[]) {
    this.url = url;
    this.protocols = protocols;
    MockWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as TestFrame);
  }

  open(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  receive(frame: TestFrame): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  close(): void {
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

async function connect(service: ChatService): Promise<MockWebSocket> {
  const connection = service.connect();
  const socket = MockWebSocket.instances.at(-1);
  if (!socket) throw new Error('Expected a WebSocket');
  socket.open();
  socket.receive({ type: 'connection_ack' });
  await connection;
  return socket;
}

async function initSession(
  service: ChatService,
  socket: MockWebSocket,
  agent: string,
  session: string,
): Promise<{ channel: string; subscriptionId: string }> {
  const initialized = service.initSession(agent, session, 'app-definition', 'tenant', 'user');
  const subscribe = socket.sent.filter((frame) => frame.type === 'subscribe').at(-1);
  if (!subscribe?.id || !subscribe.channel) throw new Error('Expected a subscribe frame');
  socket.receive({ type: 'subscribe_success', id: subscribe.id });
  await initialized;
  return { channel: subscribe.channel, subscriptionId: subscribe.id };
}

function emit(
  socket: MockWebSocket,
  subscriptionId: string,
  message: AgentMessage,
): void {
  socket.receive({
    type: 'data',
    id: subscriptionId,
    event: JSON.stringify(message),
  });
}

function receiveData(
  socket: MockWebSocket,
  message: AgentMessage,
  source: Pick<TestFrame, 'id' | 'channel'> = {},
): void {
  socket.receive({
    type: 'data',
    ...source,
    event: JSON.stringify(message),
  });
}

describe('ChatService consumer isolation', { tags: ['agent-chat', 'important'] }, () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('keeps concurrent consumers on independent sockets and channels', {
    tags: ['smoke'],
  }, async () => {
    const chat = new ChatService();
    const task = new ChatService();
    const chatSocket = await connect(chat);
    const taskSocket = await connect(task);
    const chatSession = await initSession(chat, chatSocket, 'chat-agent', 'chat-session');
    const taskSession = await initSession(task, taskSocket, 'task-agent', 'task-session');
    const chatMessages: AgentMessage[] = [];
    const taskMessages: AgentMessage[] = [];
    chat.onMessage((message) => chatMessages.push(message));
    task.onMessage((message) => taskMessages.push(message));

    emit(chatSocket, chatSession.subscriptionId, {
      type: 'done',
      request_id: 'chat-request',
      data: { output: 'chat answer' },
    });

    expect(chatMessages).toEqual([expect.objectContaining({ channel: chatSession.channel })]);
    expect(taskMessages).toEqual([]);

    emit(taskSocket, taskSession.subscriptionId, {
      type: 'done',
      request_id: 'task-request',
      data: { output: 'task answer' },
    });

    expect(taskMessages).toEqual([expect.objectContaining({ channel: taskSession.channel })]);
    expect(chatMessages).toHaveLength(1);
  });

  it('uses the subscription id map as the authoritative data-frame channel', {
    tags: ['important'],
  }, async () => {
    const service = new ChatService();
    const socket = await connect(service);
    const session = await initSession(service, socket, 'agent', 'session');
    const messages: AgentMessage[] = [];
    service.onMessage((message) => messages.push(message));

    receiveData(
      socket,
      { type: 'stream', channel: '/default/payload-channel' },
      { id: session.subscriptionId, channel: '/default/frame-channel' },
    );

    expect(messages).toEqual([
      expect.objectContaining({ channel: session.channel, type: 'stream' }),
    ]);
  });

  it('uses an explicit data-frame channel when no subscription id is present', {
    tags: ['important'],
  }, async () => {
    const service = new ChatService();
    const socket = await connect(service);
    await initSession(service, socket, 'agent', 'session');
    const messages: AgentMessage[] = [];
    service.onMessage((message) => messages.push(message));

    receiveData(socket, { type: 'stream' }, { channel: '/default/frame-channel' });

    expect(messages).toEqual([
      expect.objectContaining({ channel: '/default/frame-channel', type: 'stream' }),
    ]);
  });

  it('preserves a payload channel instead of replacing it with the active channel', {
    tags: ['important', 'edge-case'],
  }, async () => {
    const service = new ChatService();
    const socket = await connect(service);
    await initSession(service, socket, 'agent', 'session');
    const messages: AgentMessage[] = [];
    service.onMessage((message) => messages.push(message));

    receiveData(socket, { type: 'stream', channel: '/default/payload-channel' });

    expect(messages).toEqual([
      expect.objectContaining({ channel: '/default/payload-channel', type: 'stream' }),
    ]);
  });

  it('falls back unidentified data to only the active consumer-local channel', {
    tags: ['important', 'edge-case'],
  }, async () => {
    const chat = new ChatService();
    const task = new ChatService();
    const chatSocket = await connect(chat);
    const taskSocket = await connect(task);
    const chatSession = await initSession(chat, chatSocket, 'chat-agent', 'chat-session');
    await initSession(task, taskSocket, 'task-agent', 'task-session');
    const chatMessages: AgentMessage[] = [];
    const taskMessages: AgentMessage[] = [];
    chat.onMessage((message) => chatMessages.push(message));
    task.onMessage((message) => taskMessages.push(message));

    receiveData(chatSocket, { type: 'stream', data: { chunk: 'owner only' } });

    expect(chatMessages).toEqual([
      expect.objectContaining({ channel: chatSession.channel, type: 'stream' }),
    ]);
    expect(taskMessages).toEqual([]);
  });

  it('drops unidentified data when the consumer has no active channel', {
    tags: ['important', 'edge-case'],
  }, async () => {
    const service = new ChatService();
    const socket = await connect(service);
    const messages: AgentMessage[] = [];
    service.onMessage((message) => messages.push(message));

    receiveData(socket, { type: 'stream', data: { chunk: 'unowned' } });

    expect(messages).toEqual([]);
  });

  it('drops an unknown subscription id instead of assigning it to the active channel', {
    tags: ['important', 'edge-case'],
  }, async () => {
    const service = new ChatService();
    const socket = await connect(service);
    await initSession(service, socket, 'agent', 'session');
    const messages: AgentMessage[] = [];
    service.onMessage((message) => messages.push(message));

    receiveData(socket, { type: 'stream' }, { id: 'unknown-subscription' });

    expect(messages).toEqual([]);
  });

  it('stamps late frames with their original channel so stale done is rejected', {
    tags: ['important', 'edge-case'],
  }, async () => {
    const service = new ChatService();
    const socket = await connect(service);
    const oldSession = await initSession(service, socket, 'agent', 'old-session');
    const currentSession = await initSession(service, socket, 'agent', 'current-session');
    const received: AgentMessage[] = [];
    const accepted: AgentMessage[] = [];
    service.onMessage((message) => {
      received.push(message);
      if (isCurrentSessionMessage(message, 'agent', 'current-session')) accepted.push(message);
    });

    emit(socket, oldSession.subscriptionId, {
      type: 'done',
      request_id: 'old-request',
      data: { output: 'wrong task' },
    });
    emit(socket, currentSession.subscriptionId, {
      type: 'done',
      request_id: 'current-request',
      data: { output: 'right task' },
    });

    expect(received).toEqual([
      expect.objectContaining({
        channel: agentChannelPath('agent', 'old-session'),
        request_id: 'old-request',
      }),
      expect.objectContaining({
        channel: agentChannelPath('agent', 'current-session'),
        request_id: 'current-request',
      }),
    ]);
    expect(accepted).toEqual([
      expect.objectContaining({
        channel: agentChannelPath('agent', 'current-session'),
        request_id: 'current-request',
      }),
    ]);
  });

  it('disconnecting one consumer leaves the other transport subscribed', {
    tags: ['important'],
  }, async () => {
    const chat = new ChatService();
    const task = new ChatService();
    const chatSocket = await connect(chat);
    const taskSocket = await connect(task);
    const chatSession = await initSession(chat, chatSocket, 'chat-agent', 'chat-session');
    const taskSession = await initSession(task, taskSocket, 'task-agent', 'task-session');
    const taskMessages: AgentMessage[] = [];
    task.onMessage((message) => taskMessages.push(message));

    chat.disconnect();
    vi.advanceTimersByTime(100);

    expect(chatSocket.readyState).toBe(MockWebSocket.CLOSED);
    expect(chatSocket.sent).toContainEqual({ type: 'unsubscribe', id: chatSession.subscriptionId });
    expect(taskSocket.readyState).toBe(MockWebSocket.OPEN);
    expect(taskSocket.sent.some((frame) => frame.type === 'unsubscribe')).toBe(false);

    emit(taskSocket, taskSession.subscriptionId, { type: 'stream', data: { chunk: 'still live' } });
    expect(taskMessages).toEqual([expect.objectContaining({ channel: taskSession.channel })]);
  });

  it('routes synthetic reconnect events to the owning session channel', {
    tags: ['important', 'edge-case'],
  }, async () => {
    const chat = new ChatService();
    const task = new ChatService();
    const chatSocket = await connect(chat);
    const taskSocket = await connect(task);
    const chatSession = await initSession(chat, chatSocket, 'chat-agent', 'chat-session');
    await initSession(task, taskSocket, 'task-agent', 'task-session');
    const chatMessages: AgentMessage[] = [];
    const taskMessages: AgentMessage[] = [];
    chat.onMessage((message) => chatMessages.push(message));
    task.onMessage((message) => taskMessages.push(message));

    chatSocket.close();

    expect(chatMessages).toEqual([{ type: 'reconnecting', channel: chatSession.channel }]);
    expect(taskMessages).toEqual([]);
    expect(taskSocket.readyState).toBe(MockWebSocket.OPEN);
  });

  it('cancels deferred teardown when StrictMode immediately reconnects', {
    tags: ['edge-case'],
  }, async () => {
    const service = new ChatService();
    const socket = await connect(service);
    await initSession(service, socket, 'agent', 'session');

    service.disconnect();
    await service.connect();
    vi.advanceTimersByTime(100);

    expect(socket.readyState).toBe(MockWebSocket.OPEN);
    expect(socket.sent.some((frame) => frame.type === 'unsubscribe')).toBe(false);
  });
});
