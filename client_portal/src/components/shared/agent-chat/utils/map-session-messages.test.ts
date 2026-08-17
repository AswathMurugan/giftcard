import { describe, it, expect } from 'vitest';
import { mapSessionMessages } from './map-session-messages';
import type { SessionMessage } from '@/services/session-api';

const human = (data: string): SessionMessage => ({ role: 'user', type: 'str', data });
const ai = (data: string): SessionMessage => ({ role: 'ai', type: 'str', data });

describe('mapSessionMessages', { tags: ['agent-chat', 'logic'] }, () => {
  it('maps roles and content in order', () => {
    const messages = mapSessionMessages('s1', [human('hi'), ai('hello')]);
    expect(messages.map((m) => [m.role, m.content])).toEqual([
      ['user', 'hi'],
      ['assistant', 'hello'],
    ]);
    expect(messages.every((m) => m.hidden === undefined)).toBe(true);
  });

  describe('a page opening turn', { tags: ['important'] }, () => {
    it('is re-hidden on reload so the transcript matches the live view', () => {
      const messages = mapSessionMessages('s1', [human('hi'), ai('hello')], { hiddenFirstMessage: 'hi' });
      expect(messages[0].hidden).toBe(true);
      expect(messages[1].hidden).toBeUndefined();
    });

    it('matches on trimmed text', { tags: ['edge-case'] }, () => {
      expect(mapSessionMessages('s1', [human('  hi \n')], { hiddenFirstMessage: 'hi' })[0].hidden).toBe(true);
    });

    it('only ever hides the FIRST turn, and only a user one', { tags: ['edge-case'] }, () => {
      // The same text later in the conversation is the user really saying it.
      const messages = mapSessionMessages('s1', [human('other'), ai('x'), human('hi')], { hiddenFirstMessage: 'hi' });
      expect(messages.map((m) => m.hidden)).toEqual([undefined, undefined, undefined]);
      expect(mapSessionMessages('s1', [ai('hi')], { hiddenFirstMessage: 'hi' })[0].hidden).toBeUndefined();
    });

    it('hides nothing when the page sent no opening turn', () => {
      expect(mapSessionMessages('s1', [human('hi')])[0].hidden).toBeUndefined();
      expect(mapSessionMessages('s1', [human('hi')], { hiddenFirstMessage: '   ' })[0].hidden).toBeUndefined();
    });
  });

  describe('agent overrides on reload', { tags: ['important'] }, () => {
    const dict = (data: Record<string, unknown>): SessionMessage => ({ role: 'ai', type: 'dict', data });

    it('renders a structured reply through the page parser, not as raw JSON', () => {
      const [msg] = mapSessionMessages('s1', [dict({ response: 'Hi there!', record: null })], {
        parseResponse: (raw) => String((raw as { response?: string }).response ?? ''),
      });
      expect(msg.content).toBe('Hi there!');
      expect(msg.content).not.toContain('```json');
    });

    it('restores the chips + buttons the live turn had', () => {
      const [msg] = mapSessionMessages('s1', [dict({ record: { missing_fields: ['SSN'] } })], {
        parseExtras: (raw) => ({
          chips: (raw as { record?: { missing_fields?: string[] } }).record?.missing_fields,
          actions: [{ id: 'open_wizard', label: 'Directly Edit the Form' }],
        }),
      });
      expect(msg.chips).toEqual(['SSN']);
      expect(msg.actions).toEqual([{ id: 'open_wizard', label: 'Directly Edit the Form' }]);
    });

    it('flags only the FIRST assistant entry as the opening reply', { tags: ['edge-case'] }, () => {
      const opening: boolean[] = [];
      mapSessionMessages('s1', [human('hi'), dict({ a: 1 }), dict({ a: 2 })], {
        parseExtras: (_raw, ctx) => { opening.push(ctx.isFirstReply); return {}; },
      });
      expect(opening).toEqual([true, false]);
    });

    it('leaves plain-string entries alone (no raw output to parse)', { tags: ['edge-case'] }, () => {
      const [msg] = mapSessionMessages('s1', [ai('plain text')], {
        parseResponse: () => 'SHOULD NOT BE USED',
        parseExtras: () => ({ chips: ['nope'] }),
      });
      expect(msg.content).toBe('plain text');
      expect(msg.chips).toBeUndefined();
    });
  });
});
