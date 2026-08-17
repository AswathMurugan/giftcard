import { describe, expect, it } from 'vitest';
import {
  agentTaskStartError,
  queuedAgentTaskToSend,
  settlePendingAgentTask,
  shouldEnableAgentTask,
} from './use-agent-task';

describe('useAgentTask start guard', { tags: ['agent-chat', 'logic'] }, () => {
  it('fails immediately when the transport already has an error', { tags: ['important'] }, () => {
    expect(agentTaskStartError(false, 'Connection failed')?.message).toBe('Connection failed');
  });

  it('allows a run only when no task or transport error exists', { tags: ['smoke', 'edge-case'] }, () => {
    expect(agentTaskStartError(false, null)).toBeNull();
    expect(agentTaskStartError(false, '')).toBeNull();
    expect(agentTaskStartError(true, null)?.message).toBe('An agent task is already running.');
  });
});

describe('useAgentTask settlement', { tags: ['agent-chat', 'logic'] }, () => {
  it('resolves an empty done result promptly and only once', {
    tags: ['important', 'edge-case'],
  }, async () => {
    let resolve!: (value: { raw: unknown; text: string }) => void;
    let reject!: (error: Error) => void;
    const result = new Promise<{ raw: unknown; text: string }>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const cleared: number[] = [];
    const pendingRef = { current: { resolve, reject, timer: 42 } };

    expect(
      settlePendingAgentTask(
        pendingRef,
        { raw: undefined, text: '' },
        (timer) => cleared.push(timer),
      ),
    ).toBe(true);
    expect(settlePendingAgentTask(pendingRef, { raw: 'duplicate', text: 'duplicate' }, () => {}))
      .toBe(false);
    await expect(result).resolves.toEqual({ raw: undefined, text: '' });
    expect(cleared).toEqual([42]);
  });

  it('rejects an error once instead of resolving a later done', {
    tags: ['important', 'edge-case'],
  }, async () => {
    let resolve!: (value: { raw: unknown; text: string }) => void;
    let reject!: (error: Error) => void;
    const result = new Promise<{ raw: unknown; text: string }>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const pendingRef = { current: { resolve, reject, timer: 7 } };

    expect(settlePendingAgentTask(pendingRef, new Error('failed'), () => {})).toBe(true);
    expect(settlePendingAgentTask(pendingRef, { raw: 'late', text: 'late' }, () => {})).toBe(false);
    await expect(result).rejects.toThrow('failed');
  });
});

describe('useAgentTask lazy queue', { tags: ['agent-chat', 'logic'] }, () => {
  it('does not enable a transport before the first run', { tags: ['important'] }, () => {
    expect(shouldEnableAgentTask(false, 'user-1')).toBe(false);
    expect(shouldEnableAgentTask(true, '')).toBe(false);
    expect(shouldEnableAgentTask(true, 'user-1')).toBe(true);
  });

  it('retains a queued run until readiness and then releases the same work', {
    tags: ['important', 'edge-case'],
  }, () => {
    const queued = { message: 'extract', options: { extra: { schema: 'client' } } };
    expect(queuedAgentTaskToSend(false, queued)).toBeNull();
    expect(queuedAgentTaskToSend(true, queued)).toBe(queued);
    expect(queuedAgentTaskToSend(true, null)).toBeNull();
  });
});
