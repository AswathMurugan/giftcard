import { describe, it, expect, beforeEach } from 'vitest';
import { logger, type LogEvent, type LogLevel } from './logger';

function captureNext(): { event: LogEvent | null; unsubscribe: () => void } {
  const ref: { event: LogEvent | null } = { event: null };
  const unsubscribe = logger.subscribe((e) => {
    if (ref.event === null) ref.event = e;
  });
  return {
    get event() {
      return ref.event;
    },
    unsubscribe,
  };
}

describe('logger', { tags: ['logger', 'logic'] }, () => {
  beforeEach(() => {
    logger.clear();
    logger.setMinLevel('debug');
  });

  describe('level methods', { tags: ['important'] }, () => {
    it('debug / info / warn / error stamp the right level', () => {
      const seen: LogEvent[] = [];
      const off = logger.subscribe((e) => seen.push(e));

      logger.debug('t:debug');
      logger.info('t:info');
      logger.warn('t:warn');
      logger.error('t:error');
      off();

      expect(seen.map((e) => e.level)).toEqual(['debug', 'info', 'warn', 'error']);
      expect(seen.map((e) => e.type)).toEqual(['t:debug', 't:info', 't:warn', 't:error']);
    });

    it('log() is an info-level alias (back-compat)', () => {
      const cap = captureNext();
      logger.log('legacy', { a: 1 });
      cap.unsubscribe();
      expect(cap.event?.level).toBe('info');
      expect(cap.event?.type).toBe('legacy');
      expect(cap.event?.payload).toEqual({ a: 1 });
    });

    it('every event has id, timestamp, level, type, payload', () => {
      const cap = captureNext();
      const out = logger.error('e:shape', { foo: 'bar' });
      cap.unsubscribe();

      expect(out.id).toEqual(expect.any(String));
      expect(out.id.length).toBeGreaterThan(0);
      expect(out.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(out.level).toBe('error');
      expect(out.type).toBe('e:shape');
      expect(out.payload).toEqual({ foo: 'bar' });
    });

    it('payload defaults to undefined when omitted', { tags: ['edge-case'] }, () => {
      const out = logger.warn('no-payload');
      expect(out.payload).toBeUndefined();
    });
  });

  describe('setMinLevel', { tags: ['smoke'] }, () => {
    it('drops events below the threshold from buffer + subscribers', () => {
      logger.setMinLevel('warn');
      const seen: LogEvent[] = [];
      const off = logger.subscribe((e) => seen.push(e));

      logger.debug('drop:1');
      logger.info('drop:2');
      logger.warn('keep:1');
      logger.error('keep:2');
      off();

      expect(seen.map((e) => e.type)).toEqual(['keep:1', 'keep:2']);
      expect(logger.getEvents().map((e) => e.type)).toEqual(['keep:1', 'keep:2']);
    });

    it('still returns a synthesised event for filtered calls', { tags: ['edge-case'] }, () => {
      logger.setMinLevel('error');
      const out = logger.info('filtered');
      expect(out.level).toBe('info');
      expect(out.type).toBe('filtered');
      expect(logger.getEvents()).toHaveLength(0);
    });

    it('getMinLevel reflects the current threshold', () => {
      const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
      for (const lvl of levels) {
        logger.setMinLevel(lvl);
        expect(logger.getMinLevel()).toBe(lvl);
      }
    });
  });

  describe('subscribe / clear', { tags: ['logic'] }, () => {
    it('unsubscribe stops further callbacks', () => {
      const seen: LogEvent[] = [];
      const off = logger.subscribe((e) => seen.push(e));
      logger.info('first');
      off();
      logger.info('second');
      expect(seen.map((e) => e.type)).toEqual(['first']);
    });

    it('a throwing listener does not break subsequent listeners', { tags: ['edge-case'] }, () => {
      const seen: LogEvent[] = [];
      const offBad = logger.subscribe(() => {
        throw new Error('bad listener');
      });
      const offGood = logger.subscribe((e) => seen.push(e));
      logger.error('robust');
      offBad();
      offGood();
      expect(seen).toHaveLength(1);
      expect(seen[0]?.type).toBe('robust');
    });

    it('clear empties the in-memory buffer', () => {
      logger.info('a');
      logger.info('b');
      expect(logger.getEvents()).toHaveLength(2);
      logger.clear();
      expect(logger.getEvents()).toHaveLength(0);
    });
  });
});
