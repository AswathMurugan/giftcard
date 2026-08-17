import {
  isValidElement,
  lazy,
  type ComponentType,
  type LazyExoticComponent,
  type ReactNode,
} from 'react';

export type PreloadRoute = () => Promise<unknown>;

export type PreloadableLazyComponent<T extends ComponentType<unknown>> =
  LazyExoticComponent<T> & {
    preload: () => Promise<{ default: T }>;
  };

/** React.lazy with a cached import that can be started before first render. */
export function lazyWithPreload<T extends ComponentType<unknown>>(
  importer: () => Promise<{ default: T }>,
): PreloadableLazyComponent<T> {
  let pending: Promise<{ default: T }> | undefined;
  const load = () => {
    pending ??= importer().catch((error: unknown) => {
      pending = undefined;
      throw error;
    });
    return pending;
  };
  const component = lazy(load) as PreloadableLazyComponent<T>;
  component.preload = load;
  return component;
}

/** Extract the preload function attached by lazyWithPreload from <Page />. */
export function elementPreload(element: ReactNode): PreloadRoute | undefined {
  if (!isValidElement(element) || typeof element.type === 'string') return undefined;
  const type = element.type as { preload?: unknown };
  return typeof type.preload === 'function' ? (type.preload as PreloadRoute) : undefined;
}

interface IdlePreloadHost {
  setTimeout(callback: () => void, delay: number): number;
  clearTimeout(id: number): void;
  requestIdleCallback?: (
    callback: IdleRequestCallback,
    options?: IdleRequestOptions,
  ) => number;
  cancelIdleCallback?: (id: number) => void;
}

/**
 * Warm every preloadable route once the authenticated app becomes idle.
 * Failed speculative imports are consumed here; the lazy component retries
 * the importer if the user later navigates to that route.
 */
export function scheduleIdleRoutePreload(
  preloads: readonly PreloadRoute[],
  host: IdlePreloadHost | undefined =
    typeof window === 'undefined' ? undefined : window,
): () => void {
  if (!host || preloads.length === 0) return () => undefined;

  let cancelled = false;
  const warm = () => {
    if (cancelled) return;
    for (const preload of preloads) void preload().catch(() => undefined);
  };

  if (host.requestIdleCallback) {
    const id = host.requestIdleCallback(warm, { timeout: 2_000 });
    return () => {
      cancelled = true;
      host.cancelIdleCallback?.(id);
    };
  }

  const id = host.setTimeout(warm, 1_000);
  return () => {
    cancelled = true;
    host.clearTimeout(id);
  };
}
