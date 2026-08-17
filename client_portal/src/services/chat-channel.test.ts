import { describe, it, expect } from 'vitest';
import {
  sanitizeChannelSegment,
  buildChannelPath,
  agentChannelPath,
  extractHost,
  createAuthHeader,
  normalizeWsUrl,
  LISTENER_CHANNEL,
} from './chat-channel';

describe('sanitizeChannelSegment', { tags: ['agent-chat', 'logic'] }, () => {
  it('passes through already-legal segments', () => {
    expect(sanitizeChannelSegment('ETL-File-Format-Skill')).toBe('ETL-File-Format-Skill');
  });

  it('replaces illegal characters and collapses runs', () => {
    expect(sanitizeChannelSegment('a.b_c')).toBe('a-b-c');
    expect(sanitizeChannelSegment('a...b')).toBe('a-b');
  });

  it('trims leading and trailing dashes', () => {
    expect(sanitizeChannelSegment('---a---')).toBe('a');
  });

  it('falls back to "default" when nothing survives', { tags: ['edge-case'] }, () => {
    expect(sanitizeChannelSegment('')).toBe('default');
    expect(sanitizeChannelSegment('...')).toBe('default');
  });

  it('applies maxLength and re-trims a trailing dash', { tags: ['edge-case'] }, () => {
    expect(sanitizeChannelSegment('abcdefghij', 4)).toBe('abcd');
    expect(sanitizeChannelSegment('abc-defg', 4)).toBe('abc');
  });

  it('preserves a uuid session id (dashes are legal)', () => {
    const uuid = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
    expect(sanitizeChannelSegment(uuid)).toBe(uuid);
  });
});

describe('buildChannelPath / agentChannelPath', { tags: ['agent-chat', 'important'] }, () => {
  it('matches the wire contract /default/agentframework/{agent}/{session}', () => {
    expect(agentChannelPath('ETL-File-Format-Skill', 'sess-1')).toBe(
      '/default/agentframework/ETL-File-Format-Skill/sess-1',
    );
  });

  it('is always under the /default namespace (AppSync 401s otherwise)', () => {
    expect(agentChannelPath('x', 'y').startsWith('/default/')).toBe(true);
  });

  it('sanitizes every segment', () => {
    expect(buildChannelPath('default', 'agent.framework', 'my_skill')).toBe(
      '/default/agent-framework/my-skill',
    );
  });

  it('exposes the shared invoke channel', { tags: ['smoke'] }, () => {
    expect(LISTENER_CHANNEL).toBe('/default/agents/invoke');
  });
});

describe('extractHost', { tags: ['agent-chat', 'important'] }, () => {
  it('rewrites the realtime host to the api host', () => {
    expect(
      extractHost('wss://abc.appsync-realtime-api.us-east-1.amazonaws.com/event/realtime'),
    ).toBe('abc.appsync-api.us-east-1.amazonaws.com');
  });

  it('leaves a non-realtime host untouched', () => {
    expect(extractHost('wss://abc.example.com/event/realtime')).toBe('abc.example.com');
  });
});

describe('createAuthHeader', { tags: ['agent-chat', 'important'] }, () => {
  it('is base64url — no +, / or = characters', { tags: ['edge-case'] }, () => {
    // A payload chosen to force + and / in standard base64.
    expect(createAuthHeader('host??>>', 'tok??>>')).not.toMatch(/[+/=]/);
  });

  it('round-trips back to the signed header object', () => {
    const encoded = createAuthHeader('h.example.com', 'my-token');
    const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    expect(JSON.parse(atob(b64))).toEqual({
      host: 'h.example.com',
      Authorization: 'Bearer my-token',
    });
  });
});

describe('normalizeWsUrl', { tags: ['agent-chat', 'logic'] }, () => {
  it('passes a full wss:// url through unchanged', () => {
    const url = 'wss://abc.appsync-realtime-api.us-east-1.amazonaws.com/event/realtime';
    expect(normalizeWsUrl(url)).toBe(url);
  });

  it('adds scheme + realtime path to a bare host', () => {
    expect(normalizeWsUrl('abc.example.com')).toBe('wss://abc.example.com/event/realtime');
  });

  it('trims whitespace and handles empty input', { tags: ['edge-case'] }, () => {
    expect(normalizeWsUrl('  abc.example.com  ')).toBe(
      'wss://abc.example.com/event/realtime',
    );
    expect(normalizeWsUrl('   ')).toBe('');
  });
});
