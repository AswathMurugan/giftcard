import { describe, it, expect } from 'vitest';
import { isLocalDevHost, readWebsocketUrl, resolveAuthToken } from './appsync-config';

describe('isLocalDevHost', { tags: ['agent-chat', 'logic'] }, () => {
  it('matches the two local origins that use an API key', () => {
    expect(isLocalDevHost('localhost')).toBe(true);
    expect(isLocalDevHost('127.0.0.1')).toBe(true);
  });

  it('treats every deployed host as non-local', { tags: ['important'] }, () => {
    expect(isLocalDevHost('testapp-exxonmobil.us.sandbox.phoenix.jiffy.ai')).toBe(false);
    // Guard against a naive substring match.
    expect(isLocalDevHost('localhost.evil.com')).toBe(false);
  });
});

describe('readWebsocketUrl', { tags: ['agent-chat', 'important'] }, () => {
  it('normalizes a bare host from the auth config', () => {
    expect(readWebsocketUrl({ websocket_url: 'abc.example.com' })).toBe(
      'wss://abc.example.com/event/realtime',
    );
  });

  it('passes a full wss:// url through', () => {
    const url = 'wss://abc.appsync-realtime-api.us-east-1.amazonaws.com/event/realtime';
    expect(readWebsocketUrl({ websocket_url: url })).toBe(url);
  });

  it('returns empty when websocket_url is absent', { tags: ['edge-case'] }, () => {
    expect(readWebsocketUrl({})).toBe('');
    expect(readWebsocketUrl(null)).toBe('');
  });

  it('returns empty for a non-string websocket_url', { tags: ['edge-case'] }, () => {
    // The field is untyped on the wire, so a non-string must not blow up.
    expect(readWebsocketUrl({ websocket_url: 123 })).toBe('');
    expect(readWebsocketUrl({ websocket_url: null })).toBe('');
  });
});

describe('resolveAuthToken', { tags: ['agent-chat', 'important'] }, () => {
  it('uses the API key on localhost', () => {
    expect(resolveAuthToken('localhost', 'cognito-token', 'da2-key')).toBe('da2-key');
  });

  it('uses the Cognito token on a deployed host — never the API key', () => {
    expect(
      resolveAuthToken('testapp-exxonmobil.us.sandbox.phoenix.jiffy.ai', 'cognito-token', 'da2-key'),
    ).toBe('cognito-token');
  });

  it('returns empty when the needed credential is missing', { tags: ['edge-case'] }, () => {
    // The documented local-dev failure: VITE_APPSYNC_API_KEY not set.
    expect(resolveAuthToken('localhost', 'cognito-token', undefined)).toBe('');
    expect(resolveAuthToken('app.phoenix.jiffy.ai', null, 'da2-key')).toBe('');
  });
});
