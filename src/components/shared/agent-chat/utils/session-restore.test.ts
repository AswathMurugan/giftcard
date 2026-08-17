import { describe, expect, it, vi } from 'vitest';
import { runSessionRestore } from './session-restore';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('session restore', { tags: ['agent-chat', 'history', 'logic'] }, () => {
  it('loads once and applies the latest callback after identity churn', {
    tags: ['important'],
  }, async () => {
    const request = deferred<string[]>();
    const firstApply = vi.fn();
    const latestApply = vi.fn();
    const settle = vi.fn();
    const load = vi.fn(() => request.promise);
    let apply = firstApply;
    const restore = runSessionRestore({
      load,
      apply: (history) => apply(history),
      settle,
      cancelled: () => false,
    });

    // Mirrors a parent render replacing an inline parse/load callback while the
    // request is pending. The in-flight restore is not restarted.
    apply = latestApply;
    request.resolve(['message']);
    await restore;

    expect(load).toHaveBeenCalledOnce();
    expect(firstApply).not.toHaveBeenCalled();
    expect(latestApply).toHaveBeenCalledWith(['message']);
    expect(settle).toHaveBeenCalledOnce();
  });

  it('settles a failed fetch so history loading cannot remain stuck', {
    tags: ['error-boundary'],
  }, async () => {
    const settle = vi.fn();
    await runSessionRestore({
      load: () => Promise.reject(new Error('network')),
      apply: vi.fn(),
      settle,
      cancelled: () => false,
    });
    expect(settle).toHaveBeenCalledOnce();
  });

  it('does not apply or settle an obsolete restore target', { tags: ['edge-case'] }, async () => {
    const request = deferred<string[]>();
    const apply = vi.fn();
    const settle = vi.fn();
    let cancelled = false;
    const restore = runSessionRestore({
      load: () => request.promise,
      apply,
      settle,
      cancelled: () => cancelled,
    });

    cancelled = true;
    request.resolve(['late message']);
    await restore;

    expect(apply).not.toHaveBeenCalled();
    expect(settle).not.toHaveBeenCalled();
  });
});
