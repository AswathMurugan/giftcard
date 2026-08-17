import { createElement, type ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  elementPreload,
  lazyWithPreload,
  scheduleIdleRoutePreload,
} from './lazy-preload';

describe('lazy route preload', { tags: ['routing', 'logic'] }, () => {
  it('caches one import across repeated preload calls', { tags: ['important'] }, async () => {
    const Page = (() => null) as ComponentType<unknown>;
    const importer = vi.fn(async () => ({ default: Page }));
    const LazyPage = lazyWithPreload(importer);

    await Promise.all([LazyPage.preload(), LazyPage.preload()]);

    expect(importer).toHaveBeenCalledTimes(1);
    expect(elementPreload(createElement(LazyPage))).toBe(LazyPage.preload);
  });

  it('returns no preloader for a normal element', { tags: ['edge-case'] }, () => {
    expect(elementPreload(createElement('div'))).toBeUndefined();
    expect(elementPreload(null)).toBeUndefined();
  });

  it('runs all preloaders through requestIdleCallback', { tags: ['smoke'] }, async () => {
    let idle: IdleRequestCallback | undefined;
    const first = vi.fn(async () => undefined);
    const second = vi.fn(async () => undefined);
    const host = {
      setTimeout: vi.fn(() => 1),
      clearTimeout: vi.fn(),
      requestIdleCallback: vi.fn((callback: IdleRequestCallback) => {
        idle = callback;
        return 7;
      }),
      cancelIdleCallback: vi.fn(),
    };

    const cancel = scheduleIdleRoutePreload([first, second], host);
    idle?.({ didTimeout: false, timeRemaining: () => 10 });
    await Promise.resolve();

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    cancel();
    expect(host.cancelIdleCallback).toHaveBeenCalledWith(7);
  });

  it('uses a timer fallback and cancellation prevents warming', { tags: ['edge-case'] }, () => {
    let timer: (() => void) | undefined;
    const preload = vi.fn(async () => undefined);
    const host = {
      setTimeout: vi.fn((callback: () => void) => {
        timer = callback;
        return 9;
      }),
      clearTimeout: vi.fn(),
    };

    const cancel = scheduleIdleRoutePreload([preload], host);
    cancel();
    timer?.();

    expect(preload).not.toHaveBeenCalled();
    expect(host.clearTimeout).toHaveBeenCalledWith(9);
  });
});
