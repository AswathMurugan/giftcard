import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  extractFromErrorEvent,
  extractFromRejectionEvent,
  makeDedupGate,
} from './dev-error-toast';

describe('dev-error-toast', { tags: ['dev-error-toast', 'logic'] }, () => {
  describe('extractFromErrorEvent', { tags: ['important'] }, () => {
    it('captures message / source / line / column from the event', () => {
      const err = new Error('boom');
      err.stack = 'Error: boom\n  at Foo (foo.tsx:1:1)';

      const captured = extractFromErrorEvent({
        message: 'boom',
        filename: 'http://localhost/src/Foo.tsx',
        lineno: 12,
        colno: 5,
        error: err,
      });

      expect(captured.kind).toBe('window.error');
      expect(captured.message).toBe('boom');
      expect(captured.source).toBe('http://localhost/src/Foo.tsx');
      expect(captured.line).toBe(12);
      expect(captured.column).toBe(5);
      expect(captured.stack).toContain('at Foo (foo.tsx:1:1)');
      expect(captured.error).toBe(err);
    });

    it('falls back to a synthesised Error when event.error is missing', { tags: ['edge-case'] }, () => {
      const captured = extractFromErrorEvent({ message: 'script error' });
      expect(captured.error).toBeInstanceOf(Error);
      expect(captured.error.message).toBe('script error');
      expect(captured.source).toBeUndefined();
      expect(captured.line).toBeUndefined();
      expect(captured.column).toBeUndefined();
    });

    it('drops zero line/column rather than reporting "0"', { tags: ['edge-case'] }, () => {
      const captured = extractFromErrorEvent({
        message: 'x',
        lineno: 0,
        colno: 0,
      });
      expect(captured.line).toBeUndefined();
      expect(captured.column).toBeUndefined();
    });
  });

  describe('extractFromRejectionEvent', { tags: ['important'] }, () => {
    it('extracts message + stack when reason is an Error', () => {
      const err = new Error('p-boom');
      err.stack = 'Error: p-boom\n  at x';
      const captured = extractFromRejectionEvent({ reason: err });
      expect(captured.kind).toBe('unhandledrejection');
      expect(captured.message).toBe('p-boom');
      expect(captured.stack).toContain('at x');
      expect(captured.error).toBe(err);
    });

    it('wraps a string reason in an Error', { tags: ['edge-case'] }, () => {
      const captured = extractFromRejectionEvent({ reason: 'nope' });
      expect(captured.error).toBeInstanceOf(Error);
      expect(captured.message).toBe('nope');
    });

    it('falls back to "Unhandled promise rejection" when reason is undefined', { tags: ['edge-case'] }, () => {
      const captured = extractFromRejectionEvent({});
      expect(captured.message).toBe('Unhandled promise rejection');
      expect(captured.error).toBeInstanceOf(Error);
    });

    it('serialises non-Error object reasons', { tags: ['edge-case'] }, () => {
      const captured = extractFromRejectionEvent({ reason: { code: 500, body: 'oops' } });
      expect(captured.message).toContain('500');
      expect(captured.message).toContain('oops');
    });
  });

  describe('makeDedupGate', { tags: ['smoke'] }, () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('lets a fresh key through once and blocks repeats inside the window', () => {
      const gate = makeDedupGate(1000);
      expect(gate('a')).toBe(true);
      expect(gate('a')).toBe(false);
      expect(gate('a')).toBe(false);
    });

    it('lets distinct keys through independently', () => {
      const gate = makeDedupGate(1000);
      expect(gate('a')).toBe(true);
      expect(gate('b')).toBe(true);
      expect(gate('a')).toBe(false);
      expect(gate('b')).toBe(false);
    });

    it('lets the same key through again after the window expires', { tags: ['edge-case'] }, () => {
      const gate = makeDedupGate(1000);
      expect(gate('a')).toBe(true);
      vi.advanceTimersByTime(999);
      expect(gate('a')).toBe(false);
      vi.advanceTimersByTime(2);
      expect(gate('a')).toBe(true);
    });
  });
});
