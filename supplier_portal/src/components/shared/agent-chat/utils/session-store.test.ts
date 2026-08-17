import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  readStoredSessionId,
  writeStoredSessionId,
  markInitialMessageSent,
  wasInitialMessageSent,
} from './session-store';

const INITIAL_MESSAGE_SENT_KEY = 'agent-chat:initial-message-sent:v1';
const INITIAL_MESSAGE_SENT_LIMIT = 100;

/** Minimal in-memory sessionStorage (the vitest env is node — there is none). */
function installStorage(impl?: Partial<Storage>) {
  const data = new Map<string, string>();
  const storage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    ...impl,
  } as Storage;
  vi.stubGlobal('window', { sessionStorage: storage });
  return data;
}

function readInitialMessageMarkers(data: Map<string, string>): string[] {
  return JSON.parse(data.get(INITIAL_MESSAGE_SENT_KEY) ?? '[]') as string[];
}

describe('session-store', { tags: ['agent-chat', 'logic'] }, () => {
  beforeEach(() => installStorage());
  afterEach(() => vi.unstubAllGlobals());

  it('round-trips a session id under its page key', { tags: ['important'] }, () => {
    writeStoredSessionId('summary:1,2', 'sess-abc');
    expect(readStoredSessionId('summary:1,2')).toBe('sess-abc');
  });

  it('keys are independent, so two flows never adopt each other', () => {
    writeStoredSessionId('summary:1', 'sess-1');
    writeStoredSessionId('add-client', 'sess-2');
    expect(readStoredSessionId('summary:1')).toBe('sess-1');
    expect(readStoredSessionId('add-client')).toBe('sess-2');
  });

  it('returns "" for an unknown key \u2014 the caller starts a new session', () => {
    expect(readStoredSessionId('nothing-here')).toBe('');
  });

  it('persists an opening-turn marker by live session id', { tags: ['important'] }, () => {
    const stored = installStorage();
    expect(wasInitialMessageSent('opening-session-a')).toBe(false);
    markInitialMessageSent('opening-session-a');
    expect(readInitialMessageMarkers(stored)).toContain('opening-session-a');
    expect(wasInitialMessageSent('opening-session-a')).toBe(true);
  });

  it('does not suppress an opening turn for a different session', { tags: ['important'] }, () => {
    markInitialMessageSent('opening-session-b');
    expect(wasInitialMessageSent('opening-session-b')).toBe(true);
    expect(wasInitialMessageSent('opening-session-c')).toBe(false);
  });

  it('keeps only the most recent opening-turn markers', { tags: ['important', 'edge-case'] }, () => {
    const stored = installStorage();
    for (let index = 0; index <= INITIAL_MESSAGE_SENT_LIMIT; index += 1) {
      markInitialMessageSent(`bounded-session-${index}`);
    }

    const markers = readInitialMessageMarkers(stored);
    expect([...stored.keys()]).toEqual([INITIAL_MESSAGE_SENT_KEY]);
    expect(markers).toHaveLength(INITIAL_MESSAGE_SENT_LIMIT);
    expect(markers[0]).toBe('bounded-session-1');
    expect(markers.at(-1)).toBe(`bounded-session-${INITIAL_MESSAGE_SENT_LIMIT}`);
    expect(wasInitialMessageSent('bounded-session-0')).toBe(false);
    expect(wasInitialMessageSent(`bounded-session-${INITIAL_MESSAGE_SENT_LIMIT}`)).toBe(true);
  });

  it('stores a duplicate marker once and refreshes its recency', { tags: ['edge-case'] }, () => {
    const stored = installStorage();
    markInitialMessageSent('duplicate-session');
    markInitialMessageSent('newer-session');
    markInitialMessageSent('duplicate-session');

    const markers = readInitialMessageMarkers(stored);
    expect(markers.filter((id) => id === 'duplicate-session')).toHaveLength(1);
    expect(markers.at(-1)).toBe('duplicate-session');
  });

  it('ignores malformed marker storage and repairs it on mark', { tags: ['edge-case'] }, () => {
    const stored = installStorage();
    stored.set(INITIAL_MESSAGE_SENT_KEY, '{not-json');

    expect(wasInitialMessageSent('malformed-storage-session')).toBe(false);
    markInitialMessageSent('malformed-storage-session');
    expect(readInitialMessageMarkers(stored)).toContain('malformed-storage-session');
  });

  it('ignores empty keys / ids rather than writing junk', { tags: ['edge-case'] }, () => {
    writeStoredSessionId('', 'sess-abc');
    writeStoredSessionId('k', '');
    expect(readStoredSessionId('')).toBe('');
    expect(readStoredSessionId('k')).toBe('');
  });

  it('survives storage that throws (private mode, sandboxed iframe)', { tags: ['edge-case', 'error-boundary'] }, () => {
    installStorage({
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
      removeItem: () => { throw new Error('denied'); },
    });
    expect(() => writeStoredSessionId('storage-error-key', 'sess')).not.toThrow();
    expect(readStoredSessionId('storage-error-key')).toBe('sess');
    expect(wasInitialMessageSent('storage-error-session')).toBe(false);
    expect(() => markInitialMessageSent('storage-error-session')).not.toThrow();
    expect(wasInitialMessageSent('storage-error-session')).toBe(true);
  });

  it('keeps the in-memory marker when storage writes fail', { tags: ['edge-case', 'error-boundary'] }, () => {
    installStorage({ setItem: () => { throw new Error('denied'); } });

    expect(() => markInitialMessageSent('storage-write-error-session')).not.toThrow();
    expect(wasInitialMessageSent('storage-write-error-session')).toBe(true);
  });

  it('survives a non-browser environment', { tags: ['edge-case'] }, () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('window', undefined);
    expect(readStoredSessionId('k')).toBe('');
    expect(() => writeStoredSessionId('k', 'sess')).not.toThrow();
    expect(readStoredSessionId('k')).toBe('sess');
    expect(wasInitialMessageSent('node-session')).toBe(false);
    expect(() => markInitialMessageSent('node-session')).not.toThrow();
    expect(wasInitialMessageSent('node-session')).toBe(true);
  });
});
