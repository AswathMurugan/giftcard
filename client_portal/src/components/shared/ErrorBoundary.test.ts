import { describe, it, expect } from 'vitest';
import { buildFixItPayload } from './ErrorBoundary';

const fixedNow = () => new Date('2025-01-02T03:04:05.000Z');

describe('ErrorBoundary', { tags: ['important', 'error-boundary'] }, () => {
  describe('buildFixItPayload', { tags: ['logic'] }, () => {
    it('captures message, name and stack from the error', { tags: ['important'] }, () => {
      const err = new Error('boom');
      err.stack = 'Error: boom\n  at Foo (foo.tsx:1:1)';

      const payload = buildFixItPayload(err, null, {
        url: 'http://localhost/clients',
        userAgent: 'jest',
        now: fixedNow,
      });

      expect(payload.message).toBe('boom');
      expect(payload.name).toBe('Error');
      expect(payload.stack).toContain('at Foo (foo.tsx:1:1)');
      expect(payload.url).toBe('http://localhost/clients');
      expect(payload.userAgent).toBe('jest');
      expect(payload.timestamp).toBe('2025-01-02T03:04:05.000Z');
    });

    it('captures componentStack from React ErrorInfo when present', { tags: ['important'] }, () => {
      const err = new Error('render failed');
      const info = { componentStack: '\n  in BrokenPage\n  in ErrorBoundary' };

      const payload = buildFixItPayload(err, info, { now: fixedNow });

      expect(payload.componentStack).toContain('in BrokenPage');
    });

    it('falls back to empty strings when fields are missing', { tags: ['edge-case'] }, () => {
      const err = new Error('no stack');
      delete (err as { stack?: string }).stack;

      const payload = buildFixItPayload(err, null, { now: fixedNow });

      expect(payload.stack).toBe('');
      expect(payload.componentStack).toBe('');
      expect(payload.url).toBe('');
      expect(payload.userAgent).toBe('');
    });

    it('uses the error name when it is a custom subclass', { tags: ['edge-case'] }, () => {
      class CustomErr extends Error {
        constructor(msg: string) {
          super(msg);
          this.name = 'CustomErr';
        }
      }
      const payload = buildFixItPayload(new CustomErr('nope'), null, { now: fixedNow });
      expect(payload.name).toBe('CustomErr');
      expect(payload.message).toBe('nope');
    });
  });
});
