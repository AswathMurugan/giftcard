import { describe, it, expect } from 'vitest';
import {
  ALL_TYPES,
  SAVED_QUERY_TYPES,
  buildLogsFixItPayload,
  computePagination,
  deriveMessage,
  filterEvents,
  formatRelative,
  highlightJson,
  humanizeLogType,
  iconForType,
  levelStyles,
  mergePendingEvents,
  normalizeTypeFilter,
} from './LogViewerPage';
import type { LogEvent, LogLevel } from '@/utils/logger';

function makeEvent(payload: unknown, type = 't:test', level: LogLevel = 'info', id = 'id-1'): LogEvent {
  return {
    id,
    level,
    type,
    payload,
    timestamp: '2026-01-01T00:00:00.000Z',
  };
}

describe('LogViewerPage', { tags: ['log-viewer', 'logic'] }, () => {
  describe('deriveMessage', { tags: ['important'] }, () => {
    it('prefers payload.error over payload.message', () => {
      expect(
        deriveMessage(makeEvent({ error: 'E', message: 'M', reason: 'R' })),
      ).toBe('E');
    });

    it('falls back to payload.message when no error', () => {
      expect(deriveMessage(makeEvent({ message: 'M', reason: 'R' }))).toBe('M');
    });

    it('falls back to payload.reason then payload.summary', () => {
      expect(deriveMessage(makeEvent({ reason: 'R', summary: 'S' }))).toBe('R');
      expect(deriveMessage(makeEvent({ summary: 'S' }))).toBe('S');
    });

    it('serialises arbitrary objects as JSON', () => {
      expect(deriveMessage(makeEvent({ a: 1, b: 'x' }))).toBe(
        '{"a":1,"b":"x"}',
      );
    });

    it('returns empty string for null and undefined payloads', { tags: ['edge-case'] }, () => {
      expect(deriveMessage(makeEvent(null))).toBe('');
      expect(deriveMessage(makeEvent(undefined))).toBe('');
    });

    it('passes through string payloads as-is', { tags: ['edge-case'] }, () => {
      expect(deriveMessage(makeEvent('hello'))).toBe('hello');
    });

    it('stringifies primitive non-string payloads', { tags: ['edge-case'] }, () => {
      expect(deriveMessage(makeEvent(42))).toBe('42');
      expect(deriveMessage(makeEvent(true))).toBe('true');
      expect(deriveMessage(makeEvent(false))).toBe('false');
    });

    it('ignores empty-string error/message fields', { tags: ['edge-case'] }, () => {
      // empty error falls through to message
      expect(deriveMessage(makeEvent({ error: '', message: 'M' }))).toBe('M');
      // nothing usable → JSON dump
      expect(deriveMessage(makeEvent({ error: '', other: 1 }))).toBe(
        '{"error":"","other":1}',
      );
    });
  });

  describe('iconForType', { tags: ['smoke'] }, () => {
    it('maps known prefixes to the expected Nucleo glyph class', () => {
      expect(iconForType('fix-it')).toBe('icon_-Tb_sparkles');
      expect(iconForType('error:uncaught')).toBe('icon_-Tb_alert_triangle');
      expect(iconForType('error:boundary-caught')).toBe('icon_-Tb_alert_triangle');
      expect(iconForType('entity:list:request')).toBe('icon_-Tb_database');
      expect(iconForType('saved-query:list:success')).toBe('icon_-Tb_database');
      expect(iconForType('workflow:execute:request')).toBe('icon_-Tb_sitemap');
      expect(iconForType('app:boot')).toBe('icon_-Tb_rocket');
      expect(iconForType('partner-module:foo')).toBe('icon_-Tb_plug');
      expect(iconForType('partner-category:bar')).toBe('icon_-Tb_plug');
    });

    it('falls back to the activity glyph for unknown types', { tags: ['edge-case'] }, () => {
      expect(iconForType('something:custom')).toBe('icon_-Tb_activity');
      expect(iconForType('')).toBe('icon_-Tb_activity');
    });
  });

  describe('filterEvents', { tags: ['important'] }, () => {
    const events = [
      makeEvent({ name: 'sr_detail', hasResult: true }, 'saved-query:single:success', 'info', 'a'),
      makeEvent({ error: 'PHX-ERR-500' }, 'saved-query:list:error', 'error', 'b'),
      makeEvent('booted', 'app:boot', 'debug', 'c'),
    ];

    it('passes everything through with default filters', { tags: ['smoke'] }, () => {
      const out = filterEvents(events, { level: 'all', type: ALL_TYPES, query: '' });
      expect(out).toHaveLength(3);
    });

    it('filters by level', () => {
      const out = filterEvents(events, { level: 'error', type: ALL_TYPES, query: '' });
      expect(out.map((e) => e.id)).toEqual(['b']);
    });

    it('filters by exact type', () => {
      const out = filterEvents(events, { level: 'all', type: 'app:boot', query: '' });
      expect(out.map((e) => e.id)).toEqual(['c']);
    });

    it('filters all saved-query event variants as one category', () => {
      const out = filterEvents(events, {
        level: 'all',
        type: SAVED_QUERY_TYPES,
        query: '',
      });
      expect(out.map((e) => e.id)).toEqual(['a', 'b']);
    });

    it('searches the type string case-insensitively', () => {
      const out = filterEvents(events, { level: 'all', type: ALL_TYPES, query: 'SAVED-QUERY' });
      expect(out.map((e) => e.id)).toEqual(['a', 'b']);
    });

    it('searches inside the JSON-serialised payload', () => {
      const out = filterEvents(events, { level: 'all', type: ALL_TYPES, query: 'sr_detail' });
      expect(out.map((e) => e.id)).toEqual(['a']);
      const err = filterEvents(events, { level: 'all', type: ALL_TYPES, query: 'phx-err-500' });
      expect(err.map((e) => e.id)).toEqual(['b']);
    });

    it('combines level + type + query', () => {
      const out = filterEvents(events, {
        level: 'error',
        type: 'saved-query:list:error',
        query: 'phx',
      });
      expect(out.map((e) => e.id)).toEqual(['b']);
      const none = filterEvents(events, {
        level: 'info',
        type: 'saved-query:list:error',
        query: 'phx',
      });
      expect(none).toHaveLength(0);
    });

    it('treats whitespace-only queries as no query', { tags: ['edge-case'] }, () => {
      const out = filterEvents(events, { level: 'all', type: ALL_TYPES, query: '   ' });
      expect(out).toHaveLength(3);
    });

    it('does not throw on circular payloads', { tags: ['edge-case'] }, () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      const list = [makeEvent(circular, 'x:y')];
      expect(() =>
        filterEvents(list, { level: 'all', type: ALL_TYPES, query: 'zzz' }),
      ).not.toThrow();
    });
  });

  describe('normalizeTypeFilter', { tags: ['log-viewer', 'logic'] }, () => {
    it('restores the saved-query selection', { tags: ['smoke'] }, () => {
      expect(normalizeTypeFilter(SAVED_QUERY_TYPES)).toBe(SAVED_QUERY_TYPES);
    });

    it('falls back to all for missing or stale values', { tags: ['edge-case'] }, () => {
      expect(normalizeTypeFilter(null)).toBe(ALL_TYPES);
      expect(normalizeTypeFilter('saved-query:single:success')).toBe(ALL_TYPES);
    });
  });

  describe('humanizeLogType', { tags: ['smoke'] }, () => {
    it('uses the curated label for app:boot', () => {
      expect(humanizeLogType('app:boot')).toBe('App Started');
    });

    it('title-cases generic colon/hyphen/underscore types', () => {
      expect(humanizeLogType('saved-query:list:success')).toBe(
        'Saved Query List Success',
      );
      expect(humanizeLogType('fix-it')).toBe('Fix It');
      expect(humanizeLogType('log_viewer:ask_jiffy')).toBe(
        'Log Viewer Ask Jiffy',
      );
    });

    it('handles empty and single-word types', { tags: ['edge-case'] }, () => {
      expect(humanizeLogType('')).toBe('');
      expect(humanizeLogType('boot')).toBe('Boot');
    });
  });

  describe('computePagination', { tags: ['important', 'logic'] }, () => {
    it('returns a zeroed window for an empty set', { tags: ['edge-case'] }, () => {
      expect(computePagination(0, 25, 0)).toEqual({
        currentPage: 0,
        totalPages: 0,
        rangeStart: 0,
        rangeEnd: 0,
      });
    });

    it('computes pages and 1-indexed ranges', () => {
      expect(computePagination(30, 25, 0)).toEqual({
        currentPage: 0,
        totalPages: 2,
        rangeStart: 1,
        rangeEnd: 25,
      });
      expect(computePagination(30, 25, 1)).toEqual({
        currentPage: 1,
        totalPages: 2,
        rangeStart: 26,
        rangeEnd: 30,
      });
    });

    it('handles exact multiples of the page size', { tags: ['edge-case'] }, () => {
      expect(computePagination(50, 25, 1)).toEqual({
        currentPage: 1,
        totalPages: 2,
        rangeStart: 26,
        rangeEnd: 50,
      });
    });

    it('clamps an out-of-range requested page (filters shrank the set)', { tags: ['edge-case'] }, () => {
      expect(computePagination(30, 25, 99).currentPage).toBe(1);
      expect(computePagination(30, 25, -5).currentPage).toBe(0);
      expect(computePagination(10, 25, 3)).toEqual({
        currentPage: 0,
        totalPages: 1,
        rangeStart: 1,
        rangeEnd: 10,
      });
    });
  });

  describe('mergePendingEvents', { tags: ['logic'] }, () => {
    it('prepends buffered events newest-first', () => {
      const visible = [makeEvent(null, 't', 'info', 'old-2'), makeEvent(null, 't', 'info', 'old-1')];
      // pending is in ARRIVAL order: p1 arrived first, p2 last (newest)
      const pending = [makeEvent(null, 't', 'info', 'p1'), makeEvent(null, 't', 'info', 'p2')];
      const out = mergePendingEvents(pending, visible);
      expect(out.map((e) => e.id)).toEqual(['p2', 'p1', 'old-2', 'old-1']);
    });

    it('returns the visible list untouched when nothing is pending', { tags: ['edge-case'] }, () => {
      const visible = [makeEvent(null, 't', 'info', 'a')];
      expect(mergePendingEvents([], visible)).toBe(visible);
    });

    it('does not mutate the pending buffer', { tags: ['edge-case'] }, () => {
      const pending = [makeEvent(null, 't', 'info', 'p1'), makeEvent(null, 't', 'info', 'p2')];
      mergePendingEvents(pending, []);
      expect(pending.map((e) => e.id)).toEqual(['p1', 'p2']);
    });
  });

  describe('highlightJson', { tags: ['logic'] }, () => {
    it('classifies keys, string values, numbers, and literals', () => {
      const text = '{\n  "name": "sr_detail",\n  "count": 25,\n  "ok": true\n}';
      const tokens = highlightJson(text);
      const byKind = (kind: string) =>
        tokens.filter((t) => t.kind === kind).map((t) => t.text);
      expect(byKind('key')).toEqual(['"name"', '"count"', '"ok"']);
      expect(byKind('string')).toEqual(['"sr_detail"']);
      expect(byKind('number')).toEqual(['25']);
      expect(byKind('literal')).toEqual(['true']);
    });

    it('round-trips: concatenated token texts reproduce the input', () => {
      const text = JSON.stringify(
        { a: 'x', n: -1.5e3, flag: false, nil: null, nested: { b: [1, 2] } },
        null,
        2,
      );
      const tokens = highlightJson(text);
      expect(tokens.map((t) => t.text).join('')).toBe(text);
    });

    it('keeps escaped quotes inside strings as one token', { tags: ['edge-case'] }, () => {
      const text = '{ "msg": "say \\"hi\\" now" }';
      const tokens = highlightJson(text);
      expect(tokens.map((t) => t.text).join('')).toBe(text);
      expect(tokens.find((t) => t.kind === 'string')?.text).toBe(
        '"say \\"hi\\" now"',
      );
    });

    it('handles empty and non-JSON input without throwing', { tags: ['edge-case'] }, () => {
      expect(highlightJson('')).toEqual([]);
      const tokens = highlightJson('plain text, no json here');
      expect(tokens.map((t) => t.text).join('')).toBe(
        'plain text, no json here',
      );
    });
  });

  describe('formatRelative', { tags: ['logic'] }, () => {
    const base = Date.parse('2026-01-01T12:00:00.000Z');

    it('returns "just now" for sub-minute deltas', () => {
      expect(formatRelative('2026-01-01T12:00:00.000Z', base)).toBe('just now');
      expect(formatRelative('2026-01-01T11:59:01.000Z', base)).toBe('just now');
    });

    it('returns Nm ago between 1 and 59 minutes', () => {
      expect(formatRelative('2026-01-01T11:59:00.000Z', base)).toBe('1m ago');
      expect(formatRelative('2026-01-01T11:01:00.000Z', base)).toBe('59m ago');
    });

    it('returns Nh ago between 1 and 23 hours', () => {
      expect(formatRelative('2026-01-01T11:00:00.000Z', base)).toBe('1h ago');
      expect(formatRelative('2025-12-31T13:00:00.000Z', base)).toBe('23h ago');
    });

    it('returns Nd ago for 24 hours and beyond', () => {
      expect(formatRelative('2025-12-31T12:00:00.000Z', base)).toBe('1d ago');
      expect(formatRelative('2025-12-25T12:00:00.000Z', base)).toBe('7d ago');
    });

    it('clamps future timestamps to "just now"', { tags: ['edge-case'] }, () => {
      expect(formatRelative('2026-01-01T12:00:30.000Z', base)).toBe('just now');
    });

    it('returns empty string for an unparseable timestamp', { tags: ['edge-case'] }, () => {
      expect(formatRelative('not-a-date', base)).toBe('');
    });
  });

  describe('levelStyles', { tags: ['smoke'] }, () => {
    it('returns distinct class strings per level', () => {
      const error = levelStyles('error');
      const warn = levelStyles('warn');
      const info = levelStyles('info');
      const debug = levelStyles('debug');
      expect(new Set([error.badge, warn.badge, info.badge, debug.badge]).size).toBe(4);
      expect(new Set([error.dot, warn.dot, info.dot, debug.dot]).size).toBe(4);
    });

    it('uses design tokens, not hard-coded palette colors', () => {
      for (const level of ['error', 'warn', 'info', 'debug'] as const) {
        const s = levelStyles(level);
        expect(s.badge).not.toMatch(/(red|amber|blue)-\d/);
        expect(s.dot).not.toMatch(/(red|amber|blue)-\d/);
      }
    });
  });

  describe('buildLogsFixItPayload', { tags: ['important', 'log-viewer'] }, () => {
    const ctx = { url: 'u', userAgent: 'ua', now: () => new Date('2026-01-01T00:00:00.000Z') };

    it('produces the platform-expected fix-it fields (message/stack/etc.)', () => {
      const p = buildLogsFixItPayload([makeEvent({ a: 1 }, 'x:y')], ctx);
      // These are the fields the platform bridge reads — must be non-empty.
      expect(p.message).toBe('1 log event selected from /logs');
      expect(p.name).toBe('LogSelection');
      expect(p.stack).toContain('x:y');
      expect(p.stack).toContain('"a": 1');
      expect(p).toHaveProperty('componentStack');
      expect(p.url).toBe('u');
      expect(p.userAgent).toBe('ua');
      expect(p.source).toBe('log-viewer');
    });

    it('pluralises the summary and keeps every selected log', () => {
      const p = buildLogsFixItPayload(
        [makeEvent({ a: 1 }, 'one'), makeEvent({ b: 2 }, 'two')],
        ctx,
      );
      expect(p.message).toBe('2 log events selected from /logs');
      expect(p.logs).toHaveLength(2);
    });

    it('does not throw on circular / unserialisable payloads', { tags: ['edge-case'] }, () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      expect(() => buildLogsFixItPayload([makeEvent(circular)], ctx)).not.toThrow();
      const p = buildLogsFixItPayload([makeEvent(circular)], ctx);
      expect(typeof p.stack).toBe('string');
    });
  });
});
