import { describe, it, expect } from 'vitest';
import type { AgentMessage } from '@/services/chat-service';
import {
  agentChatReducer,
  initialChatState,
  isStaleTurn,
  lastAssistantMessageId,
  type AgentChatState,
  type MessageAction,
  type MessageExtras,
} from './agent-chat-reducer';

const NOW = 1_700_000_000_000;
const REQ = 'req-1';

function apply(state: AgentChatState, ...messages: AgentMessage[]): AgentChatState {
  return messages.reduce(
    (s, message) => agentChatReducer(s, { type: 'agent-event', message, now: NOW }),
    state,
  );
}

function sending(text = 'hello'): AgentChatState {
  return agentChatReducer(initialChatState(), {
    type: 'send',
    requestId: REQ,
    text,
    now: NOW,
  });
}

const stream = (chunk: string, request_id = REQ): AgentMessage => ({
  type: 'stream',
  request_id,
  data: { chunk },
});
const status = (
  step: string,
  detail?: string,
  ctx?: string,
  request_id = REQ,
): AgentMessage => ({ type: 'status', request_id, data: { step, detail, ctx } });
const done = (output?: unknown, request_id = REQ): AgentMessage => ({
  type: 'done',
  request_id,
  data: output === undefined ? {} : { output },
});
const errorEvent = (message?: string, request_id = REQ): AgentMessage => ({
  type: 'error',
  request_id,
  data: message === undefined ? {} : { message },
});

describe('agent-chat-reducer', { tags: ['agent-chat', 'logic'] }, () => {
  describe('send', { tags: ['agent-chat', 'logic'] }, () => {
    it('appends the user message and starts the turn', { tags: ['important'] }, () => {
      const s = sending('what is up');
      expect(s.messages).toHaveLength(1);
      expect(s.messages[0]).toMatchObject({
        id: REQ,
        role: 'user',
        content: 'what is up',
        timestamp: NOW,
      });
      expect(s.isAwaitingResponse).toBe(true);
      expect(s.currentRequestId).toBe(REQ);
      expect(s.error).toBeNull();
    });

    it('leaves statusText empty so the UI shows its Thinking fallback', { tags: ['important'] }, () => {
      expect(sending().statusText).toBe('');
    });

    it('clears prior-turn progress', { tags: ['logic'] }, () => {
      const dirty: AgentChatState = {
        ...initialChatState(),
        todos: [{ content: 'old', status: 'completed' }],
        streamingContent: 'old narration',
        stalled: true,
        toolErrors: [{ tool: 't', errorCode: 'E' }],
      };
      const s = agentChatReducer(dirty, {
        type: 'send',
        requestId: 'req-2',
        text: 'hi',
        now: NOW,
      });
      expect(s.todos).toEqual([]);
      expect(s.streamingContent).toBe('');
      expect(s.stalled).toBe(false);
      expect(s.toolErrors).toEqual([]);
      expect(s.activeTools).toEqual([]);
      expect(s.toolSteps).toEqual([]);
    });
  });

  describe('stream', { tags: ['agent-chat', 'logic'] }, () => {
    it('accumulates chunks', { tags: ['important'] }, () => {
      const s = apply(sending(), stream('Hello '), stream('world'));
      expect(s.streamingContent).toBe('Hello world');
    });

    it('refreshes lastEventAt and clears stalled', { tags: ['logic'] }, () => {
      const s = apply({ ...sending(), stalled: true, lastEventAt: 0 }, stream('x'));
      expect(s.lastEventAt).toBe(NOW);
      expect(s.stalled).toBe(false);
    });

    it('ignores an empty chunk', { tags: ['edge-case'] }, () => {
      const s = apply(sending(), stream('kept'), stream(''));
      expect(s.streamingContent).toBe('kept');
    });
  });

  describe('status', { tags: ['agent-chat', 'logic'] }, () => {
    it('maps model_start to a human label', { tags: ['smoke'] }, () => {
      expect(apply(sending(), status('model_start')).statusText).toBe('Generating response');
    });

    it('parses a JSON todos array', { tags: ['logic'] }, () => {
      const todos = [{ content: 'Step one', status: 'in_progress' }];
      const s = apply(sending(), status('todos', JSON.stringify(todos)));
      expect(s.todos).toEqual(todos);
    });

    it('ignores non-JSON todos detail', { tags: ['edge-case'] }, () => {
      const s = apply(sending(), status('todos', 'not json'));
      expect(s.todos).toEqual([]);
    });

    it('tool_start adds an in_progress step and sets statusText', { tags: ['important'] }, () => {
      const s = apply(sending(), status('tool_start', 'read_file', 'a.csv'));
      expect(s.toolSteps).toHaveLength(1);
      expect(s.toolSteps[0]).toMatchObject({
        name: 'read_file',
        content: 'Reading file: a.csv',
        status: 'in_progress',
      });
      expect(s.activeTools).toHaveLength(1);
      expect(s.statusText).toBe('Reading file: a.csv');
    });

    it('tool_end completes the matching step in place and drops it from activeTools', {
      tags: ['important'],
    }, () => {
      const s = apply(
        sending(),
        status('tool_start', 'read_file', 'a.csv'),
        status('tool_start', 'extract_table', 'b.csv'),
        status('tool_end', 'read_file'),
      );
      expect(s.toolSteps.map((t) => t.name)).toEqual(['read_file', 'extract_table']);
      expect(s.toolSteps[0].status).toBe('completed');
      expect(s.toolSteps[1].status).toBe('in_progress');
      expect(s.activeTools.map((t) => t.name)).toEqual(['extract_table']);
    });

    it('ignores a write_todos tool_start', { tags: ['edge-case'] }, () => {
      const s = apply(sending(), status('tool_start', 'write_todos'));
      expect(s.toolSteps).toEqual([]);
      expect(s.activeTools).toEqual([]);
    });

    it('drops a duplicate tool_start with the same name and ctx', { tags: ['edge-case'] }, () => {
      const s = apply(
        sending(),
        status('tool_start', 'read_file', 'a.csv'),
        status('tool_start', 'read_file', 'a.csv'),
      );
      expect(s.toolSteps).toHaveLength(1);
      expect(s.activeTools).toHaveLength(1);
    });

    it('keeps the previous label when activeTools empties', { tags: ['logic'] }, () => {
      const s = apply(
        sending(),
        status('tool_start', 'read_file', 'a.csv'),
        status('tool_end', 'read_file'),
      );
      expect(s.activeTools).toEqual([]);
      expect(s.statusText).toBe('Reading file: a.csv');
    });
  });

  describe('done', { tags: ['agent-chat', 'logic'] }, () => {
    it('appends the assistant message and ends the turn', { tags: ['important'] }, () => {
      const s = apply(sending(), done({ result: 'the answer' }));
      expect(s.messages).toHaveLength(2);
      expect(s.messages[1]).toMatchObject({ role: 'assistant', content: 'the answer' });
      expect(s.isAwaitingResponse).toBe(false);
      expect(s.currentRequestId).toBeNull();
      expect(s.statusText).toBe('');
      expect(s.resolvedRequestIds).toContain(REQ);
    });

    it('prefers done.output over streamed narration', { tags: ['important'] }, () => {
      const s = apply(sending(), stream('narration'), done({ result: 'final' }));
      expect(s.messages[1].content).toBe('final');
    });

    it('falls back to streamed text when the turn produced no output', { tags: ['important'] }, () => {
      const s = apply(sending(), stream('narrated answer'), done());
      expect(s.messages[1].content).toBe('narrated answer');
    });

    it('coerces a still in_progress tool step to completed', { tags: ['important'] }, () => {
      const s = apply(
        sending(),
        status('tool_start', 'read_file', 'a.csv'),
        done({ result: 'done' }),
      );
      expect(s.messages[1].toolSteps).toEqual([
        { content: 'Reading file: a.csv', status: 'completed' },
      ]);
    });

    it('surfaces a save receipt as pendingAction and renders its message', { tags: ['important'] }, () => {
      const receipt = {
        kind: 'save_receipt',
        operation: 'create',
        artifact_type: 'file_format',
        name: 'acme',
        id: 'ff-1',
        label: 'Acme',
        message: 'Created **Acme**.',
      };
      const s = apply(sending(), done({ result: receipt }));
      expect(s.messages[1].content).toBe('Created **Acme**.');
      expect(s.pendingAction).toMatchObject({
        operation: 'create',
        id: 'ff-1',
        artifactType: 'file_format',
      });
    });

    it('sets no action for a plain answer', { tags: ['logic'] }, () => {
      const s = apply(sending(), done({ result: 'just words' }));
      expect(s.pendingAction).toBeNull();
    });

    it('still emits a bubble for a tool-only turn with no text', { tags: ['edge-case'] }, () => {
      const s = apply(
        sending(),
        status('tool_start', 'read_file', 'a.csv'),
        status('tool_end', 'read_file'),
        done(''),
      );
      expect(s.messages).toHaveLength(2);
      expect(s.messages[1].content).toBe('');
      expect(s.messages[1].toolSteps).toHaveLength(1);
    });

    it('drops a duplicate done for the same request_id', { tags: ['important'] }, () => {
      const completed = apply(sending(), done({ result: 'answer' }));
      const duplicate = apply(completed, done({ result: 'answer' }));
      expect(duplicate).toBe(completed);
      expect(duplicate.messages.filter((m) => m.role === 'assistant')).toHaveLength(1);
    });

    it('records an empty done as a live completion without adding a bubble', {
      tags: ['important', 'edge-case'],
    }, () => {
      const s = apply(sending(), done());
      expect(s.messages).toHaveLength(1);
      expect(s.lastCompletedTurn).toEqual({ requestId: REQ, output: '', raw: undefined });
      expect(s.isAwaitingResponse).toBe(false);
    });

    it('records the parsed text and raw payload for a normal done', {
      tags: ['important'],
    }, () => {
      const raw = { result: 'answer' };
      const s = apply(sending(), done(raw));
      expect(s.lastCompletedTurn).toEqual({ requestId: REQ, output: 'answer', raw });
    });
  });

  describe('error', { tags: ['agent-chat', 'logic'] }, () => {
    it('sets the error and ends the turn', { tags: ['important'] }, () => {
      const s = apply(sending(), errorEvent('agent exploded'));
      expect(s.error).toBe('agent exploded');
      expect(s.isAwaitingResponse).toBe(false);
      expect(s.currentRequestId).toBeNull();
      expect(s.resolvedRequestIds).toContain(REQ);
    });

    it('uses a generic message when data.message is absent', { tags: ['edge-case'] }, () => {
      expect(apply(sending(), errorEvent()).error).toBe('An error occurred');
    });

    it('drops a duplicate error', { tags: ['edge-case'] }, () => {
      const s = apply(sending(), errorEvent('first'), errorEvent('second'));
      expect(s.error).toBe('first');
      expect(s.resolvedRequestIds).toEqual([REQ]);
    });
  });

  describe('stale-turn filtering', { tags: ['agent-chat', 'logic'] }, () => {
    it('ignores a late stream after done', { tags: ['important'] }, () => {
      const s = apply(sending(), done({ result: 'answer' }), stream('too late'));
      expect(s.streamingContent).toBe('');
      expect(s.messages).toHaveLength(2);
    });

    it('ignores a status for a cancelled turn', { tags: ['important'] }, () => {
      const cancelled = agentChatReducer(sending(), { type: 'cancel' });
      const s = apply(cancelled, status('model_start'));
      expect(s.statusText).toBe('');
    });

    it('isStaleTurn accepts only the active unresolved id and id-less events', { tags: ['edge-case'] }, () => {
      const state: AgentChatState = {
        ...initialChatState(),
        currentRequestId: 'req-2',
        resolvedRequestIds: [REQ],
      };
      expect(isStaleTurn(state, { type: 'stream', request_id: REQ })).toBe(true);
      expect(isStaleTurn(state, { type: 'stream', request_id: 'req-2' })).toBe(false);
      expect(isStaleTurn(state, { type: 'stream', request_id: 'other' })).toBe(true);
      expect(isStaleTurn(state, { type: 'stream' })).toBe(false);
    });

    it('does not let another consumer request settle the active turn', {
      tags: ['important'],
    }, () => {
      const s = apply(sending(), done({ result: 'wrong task' }, 'req-other'));
      expect(s.messages).toHaveLength(1);
      expect(s.isAwaitingResponse).toBe(true);
      expect(s.currentRequestId).toBe(REQ);
      expect(s.lastCompletedTurn).toBeNull();
    });
  });

  describe('cancel', { tags: ['agent-chat', 'logic'] }, () => {
    it('preserves messages and resolves the in-flight id', { tags: ['important'] }, () => {
      const s = agentChatReducer(sending('keep me'), { type: 'cancel' });
      expect(s.messages).toHaveLength(1);
      expect(s.messages[0].content).toBe('keep me');
      expect(s.resolvedRequestIds).toEqual([REQ]);
      expect(s.isAwaitingResponse).toBe(false);
    });

    it('drops a late done for a cancelled turn', { tags: ['important'] }, () => {
      const cancelled = agentChatReducer(sending(), { type: 'cancel' });
      const s = apply(cancelled, done({ result: 'late answer' }));
      expect(s).toBe(cancelled);
      expect(s.lastCompletedTurn).toBeNull();
    });
  });

  describe('connection lifecycle', { tags: ['agent-chat', 'logic'] }, () => {
    it('session_subscribed marks the session ready', { tags: ['smoke'] }, () => {
      const initializing = agentChatReducer(initialChatState(), {
        type: 'session-status',
        status: 'initializing',
      });
      expect(initializing.sessionStatus).toBe('initializing');
      expect(apply(initializing, { type: 'session_subscribed' }).sessionStatus).toBe('ready');
    });

    it('the readiness fallback releases only a still-initializing session', {
      tags: ['important'],
    }, () => {
      const initializing = agentChatReducer(initialChatState(), {
        type: 'session-status',
        status: 'initializing',
      });
      const ready = agentChatReducer(initializing, { type: 'session-ready-fallback' });
      const errored = agentChatReducer(initializing, {
        type: 'session-status',
        status: 'error',
        error: 'Connection lost',
      });

      expect(ready.sessionStatus).toBe('ready');
      expect(agentChatReducer(ready, { type: 'session-ready-fallback' })).toBe(ready);
      expect(agentChatReducer(errored, { type: 'session-ready-fallback' })).toBe(errored);
    });

    it('reconnecting then reconnected clears the flag and refreshes lastEventAt', {
      tags: ['logic'],
    }, () => {
      const mid = apply({ ...sending(), stalled: true }, { type: 'reconnecting' });
      expect(mid.reconnecting).toBe(true);
      const s = apply(mid, { type: 'reconnected' });
      expect(s.reconnecting).toBe(false);
      expect(s.stalled).toBe(false);
      expect(s.lastEventAt).toBe(NOW);
    });

    it('disconnected errors the session and ends the turn', { tags: ['important'] }, () => {
      const s = apply(sending(), { type: 'disconnected' });
      expect(s.sessionStatus).toBe('error');
      expect(s.error).toBe('Connection lost — please try again.');
      expect(s.isAwaitingResponse).toBe(false);
    });

    it('session_title captures the sessionId and title', { tags: ['logic'] }, () => {
      const s = apply(initialChatState(), {
        type: 'session_title',
        session_id: 'sess-1',
        title: 'Tax lots',
      });
      expect(s.sessionTitle).toEqual({ sessionId: 'sess-1', title: 'Tax lots' });
      expect(
        apply(initialChatState(), { type: 'session_title', session_id: 'sess-1' }).sessionTitle,
      ).toBeNull();
    });
  });

  describe('stall', { tags: ['agent-chat', 'logic'] }, () => {
    it('flags an in-flight turn', { tags: ['logic'] }, () => {
      expect(agentChatReducer(sending(), { type: 'stall' }).stalled).toBe(true);
    });

    it('never flags an idle chat', { tags: ['edge-case'] }, () => {
      expect(agentChatReducer(initialChatState(), { type: 'stall' }).stalled).toBe(false);
    });
  });

  describe('tool_error', { tags: ['agent-chat', 'logic'] }, () => {
    const toolError = (tool?: string, error_code?: string, message?: string): AgentMessage => ({
      type: 'tool_error',
      request_id: REQ,
      data: { tool, error_code, message },
    });

    it('collects onto the finished message', { tags: ['important'] }, () => {
      const s = apply(
        sending(),
        toolError('read_file', 'ENOENT', 'missing'),
        done({ result: 'partial' }),
      );
      expect(s.messages[1].toolErrors).toEqual([
        { tool: 'read_file', errorCode: 'ENOENT', message: 'missing' },
      ]);
    });

    it('dedupes the same tool + error code', { tags: ['edge-case'] }, () => {
      const s = apply(
        sending(),
        toolError('read_file', 'ENOENT'),
        toolError('read_file', 'ENOENT'),
        toolError('read_file', 'EPERM'),
      );
      expect(s.toolErrors).toHaveLength(2);
    });

    it('ignores an incomplete event', { tags: ['edge-case'] }, () => {
      const s = apply(sending(), toolError(undefined, 'ENOENT'), toolError('read_file'));
      expect(s.toolErrors).toEqual([]);
    });
  });

  describe('load-messages / reset / clear-action', { tags: ['agent-chat', 'logic'] }, () => {
    it('load-messages replaces the transcript and ends the turn', { tags: ['logic'] }, () => {
      const history = [
        { id: 'm1', role: 'user' as const, content: 'old q', timestamp: 1 },
        { id: 'm2', role: 'assistant' as const, content: 'old a', timestamp: 2 },
      ];
      const live = apply(sending(), done({ response: 'new live output' }));
      const s = agentChatReducer(live, { type: 'load-messages', messages: history });
      expect(s.messages).toEqual(history);
      expect(s.isAwaitingResponse).toBe(false);
      expect(s.lastOutput).toBeUndefined();
      expect(s.lastCompletedTurn).toBeNull();
      expect(s.error).toBeNull();
      expect(lastAssistantMessageId(history)).toBe('m2');
      expect(lastAssistantMessageId(history.slice(0, 1))).toBeNull();
    });

    it('reset clears everything but the session status', { tags: ['logic'] }, () => {
      const live = apply({ ...sending(), sessionStatus: 'ready' }, stream('x'));
      const s = agentChatReducer(live, { type: 'reset' });
      expect(s).toEqual({ ...initialChatState(), sessionStatus: 'ready' });
    });

    it('clear-action drops the pending action', { tags: ['logic'] }, () => {
      const withAction = apply(
        sending(),
        done({ result: { kind: 'save_receipt', operation: 'create', id: 'x-1', name: 'x' } }),
      );
      expect(withAction.pendingAction).not.toBeNull();
      expect(agentChatReducer(withAction, { type: 'clear-action' }).pendingAction).toBeNull();
    });
  });
});

describe('message extras (chips + actions)', { tags: ['agent-chat', 'logic'] }, () => {
  const done = (
    output: unknown,
    parseExtras?: (raw: unknown, ctx: { isFirstReply: boolean }) => MessageExtras,
  ) => {
    const awaiting = agentChatReducer(initialChatState(), {
      type: 'send',
      requestId: 'req-1',
      text: 'hi',
      now: 0,
    });
    return agentChatReducer(awaiting, {
      type: 'agent-event',
      now: 1,
      parseExtras,
      message: { type: 'done', request_id: 'req-1', data: { output } } as never,
    });
  };

  it('attaches the chips + actions the page parses off the raw output', () => {
    const state = done(
      { response: 'Six details still need your input.', record: { missing_fields: ['SSN'], actions: [{ id: 'open_wizard', label: 'Directly Edit the Form' }] } },
      (raw) => ({
        chips: (raw as { record?: { missing_fields?: string[] } }).record?.missing_fields,
        actions: (raw as { record?: { actions?: MessageAction[] } }).record?.actions,
      }),
    );
    const last = state.messages[state.messages.length - 1];
    expect(last.chips).toEqual(['SSN']);
    expect(last.actions).toEqual([{ id: 'open_wizard', label: 'Directly Edit the Form' }]);
  });

  it('leaves them undefined when no parser is supplied (unchanged behaviour)', () => {
    const last = done({ result: 'plain answer' }).messages.at(-1)!;
    expect(last.chips).toBeUndefined();
    expect(last.actions).toBeUndefined();
  });

  it('bubbles a turn that carries ONLY chips', { tags: ['edge-case'] }, () => {
    const state = done({ record: { missing_fields: ['SSN'] } }, (raw) => ({
      chips: (raw as { record?: { missing_fields?: string[] } }).record?.missing_fields,
    }));
    expect(state.messages).toHaveLength(2);
    expect(state.messages[1].chips).toEqual(['SSN']);
  });

  it('tells the parser when it is the OPENING reply', { tags: ['important'] }, () => {
    // A page uses this to decorate the first answer only (chips it already knows,
    // before the agent returns them itself).
    const first = done({ result: 'hi' }, (_raw, ctx) => (ctx.isFirstReply ? { chips: ['SSN'] } : {}));
    expect(first.messages.at(-1)!.chips).toEqual(['SSN']);

    // Same turn again, on a state that already HAS an assistant reply.
    const awaitingSecond = agentChatReducer(first, {
      type: 'send',
      requestId: 'req-2',
      text: 'more',
      now: 2,
    });
    const second = agentChatReducer(awaitingSecond, {
      type: 'agent-event',
      now: 3,
      parseExtras: (_raw, ctx) => (ctx.isFirstReply ? { chips: ['SSN'] } : {}),
      message: { type: 'done', request_id: 'req-2', data: { output: { result: 'more' } } } as never,
    });
    expect(second.messages.at(-1)!.chips).toBeUndefined();
  });

  it('drops empty extras rather than storing empty arrays', { tags: ['edge-case'] }, () => {
    const last = done({ result: 'hi' }, () => ({ chips: [], actions: [] })).messages.at(-1)!;
    expect(last.chips).toBeUndefined();
    expect(last.actions).toBeUndefined();
  });
});

describe('hidden turns', { tags: ['agent-chat', 'important'] }, () => {
  const send = (hidden?: boolean) =>
    agentChatReducer(initialChatState(), {
      type: 'send', requestId: 'req-1', text: 'hi', now: 5, hidden,
    });

  it('keeps a hidden turn in state, flagged, so ordering and ids survive', () => {
    const state = send(true);
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({ role: 'user', content: 'hi', hidden: true });
    expect(state.isAwaitingResponse).toBe(true);
  });

  it('a normal turn carries no hidden flag', () => {
    expect(send().messages[0].hidden).toBeUndefined();
    expect(send(false).messages[0].hidden).toBeUndefined();
  });
});

describe('lastOutput', { tags: ['agent-chat', 'important'] }, () => {
  it('keeps the RAW done output so onDone can hand it to the page', () => {
    const output = { response: 'Hi there!', record: { missing_fields: ['SSN'] } };
    const state = agentChatReducer(sending(), {
      type: 'agent-event',
      now: 1,
      message: { type: 'done', request_id: 'req-1', data: { output } } as never,
    });
    expect(state.lastOutput).toEqual(output);
  });

  it('is undefined for a turn that produced no output', { tags: ['edge-case'] }, () => {
    const state = agentChatReducer(sending(), {
      type: 'agent-event',
      now: 1,
      message: { type: 'done', request_id: 'req-1', data: {} } as never,
    });
    expect(state.lastOutput).toBeUndefined();
  });
});

describe('terminal completion interactions', { tags: ['agent-chat', 'logic'] }, () => {
  it('does not complete after a terminal error', { tags: ['important', 'edge-case'] }, () => {
    const failed = apply(sending(), errorEvent('failed'));
    const lateDone = apply(failed, done({ result: 'too late' }));
    expect(lateDone).toBe(failed);
    expect(lateDone.lastCompletedTurn).toBeNull();
  });

  it('keeps the accepted done when a late error arrives', { tags: ['important', 'edge-case'] }, () => {
    const completed = apply(sending(), done({ result: 'answer' }));
    const lateError = apply(completed, errorEvent('too late'));
    expect(lateError).toBe(completed);
    expect(lateError.lastCompletedTurn?.output).toBe('answer');
  });
});
