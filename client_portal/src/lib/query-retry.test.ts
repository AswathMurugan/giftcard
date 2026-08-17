import { describe, it, expect } from 'vitest';
import {
  errorHttpStatus,
  shouldRetryQuery,
  queryRetryDelay,
} from './query-retry';

const httpError = (status: number) => ({ response: { status } });

describe('query-retry', { tags: ['query-retry', 'logic'] }, () => {
  describe('errorHttpStatus', { tags: ['edge-case'] }, () => {
    it('extracts an axios-shaped status', () => {
      expect(errorHttpStatus(httpError(500))).toBe(500);
      expect(errorHttpStatus(httpError(404))).toBe(404);
    });

    it('returns undefined for non-http errors', () => {
      expect(errorHttpStatus(new Error('network down'))).toBeUndefined();
      expect(errorHttpStatus(undefined)).toBeUndefined();
      expect(errorHttpStatus(null)).toBeUndefined();
      expect(errorHttpStatus('boom')).toBeUndefined();
      expect(errorHttpStatus({ response: null })).toBeUndefined();
      expect(errorHttpStatus({ response: { status: '500' } })).toBeUndefined();
    });
  });

  describe('shouldRetryQuery', { tags: ['important'] }, () => {
    it('never retries 4xx client errors', () => {
      for (const status of [400, 401, 403, 404, 409, 422, 429]) {
        expect(shouldRetryQuery(0, httpError(status))).toBe(false);
      }
    });

    it('retries transient failures up to 2 times (3 attempts total)', () => {
      for (const error of [
        httpError(500),
        httpError(502),
        httpError(503),
        new Error('Network Error'), // no HTTP status
      ]) {
        expect(shouldRetryQuery(0, error)).toBe(true);
        expect(shouldRetryQuery(1, error)).toBe(true);
        expect(shouldRetryQuery(2, error)).toBe(false); // boundary
      }
    });
  });

  describe('queryRetryDelay', { tags: ['smoke'] }, () => {
    it('backs off exponentially with an 8s cap', () => {
      expect(queryRetryDelay(0)).toBe(1000);
      expect(queryRetryDelay(1)).toBe(2000);
      expect(queryRetryDelay(2)).toBe(4000);
      expect(queryRetryDelay(3)).toBe(8000);
      expect(queryRetryDelay(10)).toBe(8000); // capped
    });
  });
});
