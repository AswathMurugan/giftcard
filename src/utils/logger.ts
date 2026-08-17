/**
 * Tiny in-app event logger used by hooks, error capture, and ErrorBoundary.
 *
 * Events are kept in an in-memory buffer, fanned out to subscribers, and
 * (when running inside the Jiffy preview iframe) bridged to the parent
 * window via `postMessage` so the platform UI's `usePreviewMessageBridge`
 * can render them in the previewLogs panel.
 *
 * Each event carries a {@link LogLevel} so consumers (and the bridge
 * receiver) can filter / colourise / triage by severity. Use the
 * level-specific methods (`logger.debug`, `logger.info`, `logger.warn`,
 * `logger.error`) at call sites — `logger.log()` is preserved as a
 * backward-compatible alias for `info`.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEvent {
  id: string;
  level: LogLevel;
  type: string;
  payload: unknown;
  timestamp: string;
}

export type LogListener = (event: LogEvent) => void;

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

class EventLogger {
  private listeners: LogListener[] = [];
  private events: LogEvent[] = [];
  private minLevel: LogLevel = 'debug';

  /** Emit a `debug`-level event. Use for chatty per-render diagnostics. */
  debug(type: string, payload?: unknown): LogEvent {
    return this.emit('debug', type, payload);
  }

  /** Emit an `info`-level event. Use for lifecycle / request / success. */
  info(type: string, payload?: unknown): LogEvent {
    return this.emit('info', type, payload);
  }

  /** Emit a `warn`-level event. Use for recoverable / unexpected states. */
  warn(type: string, payload?: unknown): LogEvent {
    return this.emit('warn', type, payload);
  }

  /** Emit an `error`-level event. Use for failed requests / caught throws. */
  error(type: string, payload?: unknown): LogEvent {
    return this.emit('error', type, payload);
  }

  /**
   * Backward-compatible alias for `info`. Prefer the level-specific
   * methods at new call sites.
   */
  log(type: string, payload?: unknown): LogEvent {
    return this.emit('info', type, payload);
  }

  /**
   * Drop events below the given level. Defaults to `debug` (everything
   * passes through). Returning the event is preserved for the typical
   * `info`/`error` paths; filtered events still return a synthesised
   * envelope so callers don't have to null-check.
   */
  setMinLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  getMinLevel(): LogLevel {
    return this.minLevel;
  }

  subscribe(fn: LogListener): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  getEvents(): readonly LogEvent[] {
    return this.events;
  }

  clear(): void {
    this.events = [];
  }

  private emit(level: LogLevel, type: string, payload?: unknown): LogEvent {
    const event: LogEvent = {
      id: generateId(),
      level,
      type,
      payload,
      timestamp: new Date().toISOString(),
    };
    if (LEVEL_RANK[level] < LEVEL_RANK[this.minLevel]) {
      return event;
    }
    this.events.push(event);
    for (const fn of this.listeners) {
      try {
        fn(event);
      } catch (err) {
        // Swallow listener errors so one bad subscriber can't break logging.
        // eslint-disable-next-line no-console
        console.error('[logger] listener threw', err);
      }
    }
    return event;
  }
}

export const logger = new EventLogger();

// Bridge events to the hosting iframe parent (the Jiffy preview shell).
// The parent origin defaults to '*' when VITE_PARENT_ORIGIN is unset —
// the receiver (platform UI's usePreviewMessageBridge) validates
// `event.origin === previewOrigin` strictly on the receive side, so
// the security model is enforced there rather than via the targetOrigin
// argument here. Falling back to '*' lets the bridge work in every
// environment (local dev, sandbox, prod) without requiring an env var
// at vite startup. PHX-3678.
if (typeof window !== 'undefined' && window.parent !== window) {
  const targetOrigin = import.meta.env.VITE_PARENT_ORIGIN ?? '*';
  logger.subscribe((event) => {
    try {
      window.parent.postMessage(
        { source: 'codegen-starter/logger', event },
        targetOrigin,
      );
    } catch (err) {
      // postMessage uses structured-clone; a non-cloneable payload (Error
      // instance, function, DOM node, circular ref) throws DataCloneError and
      // the message silently never reaches the parent. Retry with a
      // JSON-sanitised payload so the event still gets through.
      try {
        const safeEvent = {
          ...event,
          payload: JSON.parse(JSON.stringify(event.payload ?? null)),
        };
        window.parent.postMessage(
          { source: 'codegen-starter/logger', event: safeEvent },
          targetOrigin,
        );
      } catch (err2) {
        // eslint-disable-next-line no-console
        console.error(
          '[logger] postMessage to parent failed (even after sanitise)',
          err,
          err2,
        );
      }
    }
  });
}
