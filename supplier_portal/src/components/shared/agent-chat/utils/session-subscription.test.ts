import { describe, expect, it, vi } from 'vitest';
import {
  isCurrentSessionMessage,
  isCurrentSessionSubscription,
  scheduleSessionReadyFallback,
  SESSION_READY_FALLBACK_MS,
} from './session-subscription';

describe('agent chat session subscription', { tags: ['agent-chat', 'logic'] }, () => {
  it('accepts every event from the active transport-stamped channel', {
    tags: ['important'],
  }, () => {
    expect(isCurrentSessionMessage({
      type: 'done',
      channel: '/default/agentframework/form-agent/session-2',
    }, 'form-agent', 'session-2')).toBe(true);
    expect(isCurrentSessionMessage({
      type: 'reconnecting',
      channel: '/default/agentframework/form-agent/session-2',
    }, 'form-agent', 'session-2')).toBe(true);
  });

  it('rejects terminal and synthetic events from another session', {
    tags: ['important', 'edge-case'],
  }, () => {
    expect(isCurrentSessionMessage({
      type: 'done',
      channel: '/default/agentframework/form-agent/session-1',
    }, 'form-agent', 'session-2')).toBe(false);
    expect(isCurrentSessionMessage({
      type: 'disconnected',
      channel: '/default/agentframework/other-agent/session-2',
    }, 'form-agent', 'session-2')).toBe(false);
  });

  it('rejects an event with no channel or agent/session identity', {
    tags: ['edge-case'],
  }, () => {
    expect(isCurrentSessionMessage({ type: 'done' }, 'form-agent', 'session-2')).toBe(false);
  });

  it('accepts the acknowledgement for the active session', { tags: ['important'] }, () => {
    expect(isCurrentSessionSubscription({
      type: 'session_subscribed',
      channel: '/default/agentframework/form-agent/session-2',
    }, 'form-agent', 'session-2')).toBe(true);
  });

  it('rejects a late acknowledgement from the previous session', { tags: ['edge-case'] }, () => {
    expect(isCurrentSessionSubscription({
      type: 'session_subscribed',
      channel: '/default/agentframework/form-agent/session-1',
    }, 'form-agent', 'session-2')).toBe(false);
  });

  it('accepts a channel-less acknowledgement with the active agent and session', {
    tags: ['important'],
  }, () => {
    expect(isCurrentSessionSubscription({
      type: 'session_subscribed',
      agent_name: 'form-agent',
      session_id: 'session-2',
    }, 'form-agent', 'session-2')).toBe(true);
  });

  it('rejects a channel-less acknowledgement from a previous session', {
    tags: ['edge-case'],
  }, () => {
    expect(isCurrentSessionSubscription({
      type: 'session_subscribed',
      agent_name: 'form-agent',
      session_id: 'session-1',
    }, 'form-agent', 'session-2')).toBe(false);
  });

  it('rejects acknowledgements without channel or session identity', {
    tags: ['edge-case'],
  }, () => {
    expect(isCurrentSessionSubscription({ type: 'session_subscribed' }, 'form-agent', 'session-2'))
      .toBe(false);
  });

  it('releases a silent session after the bounded fallback', { tags: ['important'] }, () => {
    vi.useFakeTimers();
    try {
      const onReady = vi.fn();
      scheduleSessionReadyFallback(onReady);

      vi.advanceTimersByTime(SESSION_READY_FALLBACK_MS - 1);
      expect(onReady).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(onReady).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels the fallback when its session is replaced', { tags: ['edge-case'] }, () => {
    vi.useFakeTimers();
    try {
      const onReady = vi.fn();
      const cancel = scheduleSessionReadyFallback(onReady);
      cancel();

      vi.advanceTimersByTime(SESSION_READY_FALLBACK_MS);
      expect(onReady).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
