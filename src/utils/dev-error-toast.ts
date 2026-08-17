/**
 * Dev-mode global error capture + toast.
 *
 * Attaches `window` listeners for uncaught exceptions and unhandled promise
 * rejections, mirrors them into the in-app `logger` (which postMessages to
 * the platform UI's previewLogs ring buffer via the bridge in
 * `usePreviewMessageBridge`), and renders a sonner toast in the iframe with
 * an "Ask JIFFY to fix" action that emits the same `fix-it` event the
 * ErrorBoundary uses — so clicking it triggers the platform UI's automatic
 * chat iteration.
 *
 * Replaces the old `jiffyConsoleErrorPlugin` from `vite.config.ts`.
 *
 * Production builds: `installDevErrorToast()` is a no-op.
 */
import { toast } from '@/components/ui/toast';
import { logger } from './logger';
import { buildFixItPayload } from '@/components/shared/ErrorBoundary';

export interface CapturedError {
  kind: 'window.error' | 'unhandledrejection';
  message: string;
  source?: string;
  line?: number;
  column?: number;
  stack?: string;
  error: Error;
}

/** Subset of {@link ErrorEvent} the extractor reads — keeps the helper
 *  callable from node tests without a DOM. */
export interface ErrorEventLike {
  message: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  error?: unknown;
}

/** Subset of {@link PromiseRejectionEvent} the extractor reads. */
export interface RejectionEventLike {
  reason?: unknown;
}

function toError(value: unknown, fallbackMessage: string): Error {
  if (value instanceof Error) return value;
  if (value == null) return new Error(fallbackMessage);
  if (typeof value === 'string') return new Error(value);
  try {
    return new Error(typeof value === 'object' ? JSON.stringify(value) : String(value));
  } catch {
    return new Error(fallbackMessage);
  }
}

export function extractFromErrorEvent(e: ErrorEventLike): CapturedError {
  const error = toError(e.error, e.message || 'Uncaught error');
  return {
    kind: 'window.error',
    message: error.message || e.message || 'Uncaught error',
    source: e.filename || undefined,
    line: typeof e.lineno === 'number' && e.lineno > 0 ? e.lineno : undefined,
    column: typeof e.colno === 'number' && e.colno > 0 ? e.colno : undefined,
    stack: error.stack,
    error,
  };
}

export function extractFromRejectionEvent(e: RejectionEventLike): CapturedError {
  const error = toError(e.reason, 'Unhandled promise rejection');
  return {
    kind: 'unhandledrejection',
    message: error.message || 'Unhandled promise rejection',
    stack: error.stack,
    error,
  };
}

/**
 * Returns a gate that lets a given key through at most once per `windowMs`.
 * Used to silence rapid re-throws (e.g. a render loop firing the same error
 * 50 times in 200ms) without losing genuinely distinct errors.
 */
export function makeDedupGate(windowMs = 3000): (key: string) => boolean {
  const seen = new Map<string, number>();
  return (key: string) => {
    const now = Date.now();
    const last = seen.get(key);
    if (last !== undefined && now - last < windowMs) return false;
    seen.set(key, now);
    if (seen.size > 64) {
      for (const [k, t] of seen) {
        if (now - t >= windowMs) seen.delete(k);
      }
    }
    return true;
  };
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function showErrorToast(captured: CapturedError, ctx: { url: string; userAgent: string }): void {
  toast.error(truncate(captured.message, 200), {
    duration: 8000,
    description: captured.source
      ? `${captured.source}${captured.line ? `:${captured.line}` : ''}`
      : undefined,
    action: {
      label: 'Ask JIFFY to fix',
      onClick: () => {
        const payload = buildFixItPayload(captured.error, null, {
          url: ctx.url,
          userAgent: ctx.userAgent,
        });
        logger.log('fix-it', { ...payload, kind: captured.kind });
      },
    },
  });
}

let installed = false;

/**
 * Installs window-level error listeners. No-op outside dev. Safe to call
 * multiple times — subsequent calls return the same teardown function.
 */
export function installDevErrorToast(): () => void {
  if (!import.meta.env.DEV) return () => {};
  if (typeof window === 'undefined') return () => {};
  if (installed) return () => {};
  installed = true;

  const gate = makeDedupGate(3000);

  const handleError = (e: ErrorEvent): void => {
    const captured = extractFromErrorEvent(e);
    const key = `${captured.kind}|${captured.message}|${captured.source ?? ''}|${captured.line ?? ''}`;
    if (!gate(key)) return;
    logger.error('error:uncaught', {
      kind: captured.kind,
      message: captured.message,
      source: captured.source,
      line: captured.line,
      column: captured.column,
      stack: captured.stack,
    });
    showErrorToast(captured, {
      url: window.location.href,
      userAgent: navigator.userAgent,
    });
  };

  const handleRejection = (e: PromiseRejectionEvent): void => {
    const captured = extractFromRejectionEvent(e);
    const key = `${captured.kind}|${captured.message}`;
    if (!gate(key)) return;
    logger.error('error:uncaught', {
      kind: captured.kind,
      message: captured.message,
      stack: captured.stack,
    });
    showErrorToast(captured, {
      url: window.location.href,
      userAgent: navigator.userAgent,
    });
  };

  window.addEventListener('error', handleError);
  window.addEventListener('unhandledrejection', handleRejection);

  return () => {
    window.removeEventListener('error', handleError);
    window.removeEventListener('unhandledrejection', handleRejection);
    installed = false;
  };
}
