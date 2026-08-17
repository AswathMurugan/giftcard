import { describe, expect, it } from 'vitest';
import { unhandledAgentTurnCompletion } from './use-agent-chat';
import type { AgentTurnCompletion } from './agent-chat-reducer';

describe('useAgentChat completion delivery', { tags: ['agent-chat', 'logic'] }, () => {
  const completion: AgentTurnCompletion = {
    requestId: 'req-1',
    output: '',
    raw: undefined,
  };

  it('surfaces an empty live completion once by request id', {
    tags: ['important', 'edge-case'],
  }, () => {
    expect(unhandledAgentTurnCompletion(completion, null)).toBe(completion);
    expect(unhandledAgentTurnCompletion(completion, 'req-1')).toBeNull();
  });

  it('does not surface history or an absent completion', {
    tags: ['important', 'edge-case'],
  }, () => {
    expect(unhandledAgentTurnCompletion(null, null)).toBeNull();
    expect(unhandledAgentTurnCompletion(null, 'req-1')).toBeNull();
  });
});
