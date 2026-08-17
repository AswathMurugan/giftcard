import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useDebouncedValue } from '@/hooks';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group';
import { SegmentedControl } from '@/components/ui/segmented-control';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { logger, type LogEvent, type LogLevel } from '@/utils/logger';
import type { FixItPayload } from '@/components/shared/ErrorBoundary';

type LevelFilter = 'all' | LogLevel;

/**
 * Build the `fix-it` payload for "Ask JIFFY to Fix" on selected log rows.
 *
 * IMPORTANT: the platform's preview bridge renders a fix-it from its
 * `message` / `stack` / `componentStack` fields (same contract as
 * `buildFixItPayload` in ErrorBoundary). The earlier version emitted a custom
 * `{ summary, logs }` shape with NONE of those fields, so the platform showed
 * "(no message) / (no stack)" and the selected logs never surfaced. This maps
 * the selection into the expected shape: a human `message`, the formatted log
 * dump as `stack`, and the structured `logs` array preserved for richer
 * consumers. Pure + exported for unit testing.
 */
export function buildLogsFixItPayload(
  selectedEvents: LogEvent[],
  ctx: { url?: string; userAgent?: string; now?: () => Date } = {},
): FixItPayload & { source: string; logs: unknown[] } {
  const now = ctx.now ?? (() => new Date());
  const count = selectedEvents.length;
  const summary = `${count} log event${count === 1 ? '' : 's'} selected from /logs`;

  // Render each selected event into a readable block for the `stack` field so
  // the platform surfaces the actual log content (it shows `stack` verbatim).
  const stack = selectedEvents
    .map((e, i) => {
      const payload = safeStringify(e.payload);
      return `#${i + 1} [${e.level}] ${e.type} @ ${e.timestamp}\n${payload}`;
    })
    .join('\n\n');

  return {
    message: summary,
    name: 'LogSelection',
    stack,
    componentStack: '',
    url: ctx.url ?? (typeof window !== 'undefined' ? window.location.href : ''),
    userAgent:
      ctx.userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : ''),
    timestamp: now().toISOString(),
    source: 'log-viewer',
    logs: selectedEvents.map((e) => ({
      id: e.id,
      level: e.level,
      type: e.type,
      timestamp: e.timestamp,
      payload: e.payload,
    })),
  };
}

/** JSON.stringify that never throws (circular refs, BigInt, etc.). */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    try {
      return String(value);
    } catch {
      return '[unserializable payload]';
    }
  }
}

export const ALL_TYPES = '__ALL_TYPES__';
export const SAVED_QUERY_TYPES = '__SAVED_QUERY_TYPES__';
export type TypeFilter = typeof ALL_TYPES | typeof SAVED_QUERY_TYPES;
const TYPE_FILTER_STORAGE_KEY = 'jiffy:log-viewer:type-filter';
const MAX_MESSAGE_PREVIEW = 240;

export function normalizeTypeFilter(value: string | null): TypeFilter {
  return value === SAVED_QUERY_TYPES ? SAVED_QUERY_TYPES : ALL_TYPES;
}

function getStoredTypeFilter(): TypeFilter {
  if (typeof window === 'undefined') return ALL_TYPES;
  try {
    return normalizeTypeFilter(
      window.sessionStorage.getItem(TYPE_FILTER_STORAGE_KEY),
    );
  } catch {
    return ALL_TYPES;
  }
}

/** Hand-picked display names for types whose generic split reads poorly. */
const TYPE_DISPLAY_OVERRIDES: Record<string, string> = {
  'app:boot': 'App Started',
};

/**
 * Human-readable display name for a raw log type string: known types use a
 * curated label; everything else title-cases the `:`-separated segments
 * (`saved-query:list:success` → "Saved Query List Success"). Pure + exported
 * for unit testing.
 */
export function humanizeLogType(type: string): string {
  const override = TYPE_DISPLAY_OVERRIDES[type];
  if (override) return override;
  return type
    .split(':')
    .map((seg) =>
      seg
        .split(/[-_]/)
        .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
        .join(' '),
    )
    .join(' ')
    .trim();
}

/**
 * Apply level segment + type dropdown + free-text search to the event list.
 * Search is case-insensitive and matches the event type, level, or anywhere
 * in the JSON-serialised payload. Pure + exported for unit testing.
 */
export function filterEvents(
  events: LogEvent[],
  opts: { level: LevelFilter; type: string; query: string },
): LogEvent[] {
  const q = opts.query.trim().toLowerCase();
  return events.filter((event) => {
    if (opts.level !== 'all' && event.level !== opts.level) return false;
    if (
      opts.type === SAVED_QUERY_TYPES &&
      !event.type.startsWith('saved-query:')
    ) {
      return false;
    }
    if (
      opts.type !== ALL_TYPES &&
      opts.type !== SAVED_QUERY_TYPES &&
      event.type !== opts.type
    ) {
      return false;
    }
    if (q) {
      const haystack =
        `${event.type} ${humanizeLogType(event.type)} ${event.level} ${safeStringify(event.payload)}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

/**
 * Merge events buffered while paused (arrival order) into the visible
 * newest-first list, keeping newest-first order. Pure + exported for tests.
 */
export function mergePendingEvents(
  pending: LogEvent[],
  visible: LogEvent[],
): LogEvent[] {
  if (pending.length === 0) return visible;
  return [...pending].reverse().concat(visible);
}

// ── Pagination (mirrors DataTable's PaginationBar contract) ────────────────

export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;

export interface PaginationInfo {
  currentPage: number;
  totalPages: number;
  rangeStart: number;
  rangeEnd: number;
}

/**
 * Derive the effective pagination window. `requestedPage` is clamped into
 * the valid range so filter changes that shrink the result set can never
 * leave the view on a page that no longer exists. Rows are 1-indexed in the
 * range readout ("26 - 30 of 30"); an empty set reads 0/0. Pure + exported
 * for unit testing.
 */
export function computePagination(
  totalRows: number,
  pageSize: number,
  requestedPage: number,
): PaginationInfo {
  const totalPages = totalRows === 0 ? 0 : Math.ceil(totalRows / pageSize);
  const currentPage = Math.min(Math.max(requestedPage, 0), Math.max(totalPages - 1, 0));
  const rangeStart = totalRows === 0 ? 0 : currentPage * pageSize + 1;
  const rangeEnd = Math.min(totalRows, (currentPage + 1) * pageSize);
  return { currentPage, totalPages, rangeStart, rangeEnd };
}

/** A syntax token of a pretty-printed JSON payload, for display coloring. */
export interface JsonToken {
  text: string;
  kind: 'key' | 'string' | 'number' | 'literal' | 'plain';
}

/**
 * Tokenise pretty-printed JSON into colorable spans: object keys, string
 * values, numbers, `true/false/null` literals, and everything else
 * (punctuation / whitespace) as plain. Concatenating all token texts always
 * reproduces the input exactly. Pure + exported for unit testing.
 */
export function highlightJson(text: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  const re =
    /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      tokens.push({ text: text.slice(last, m.index), kind: 'plain' });
    }
    if (m[1] !== undefined) {
      if (m[2]) {
        tokens.push({ text: m[1], kind: 'key' });
        tokens.push({ text: m[2], kind: 'plain' });
      } else {
        tokens.push({ text: m[1], kind: 'string' });
      }
    } else if (m[3] !== undefined) {
      tokens.push({ text: m[3], kind: 'literal' });
    } else {
      tokens.push({ text: m[0], kind: 'number' });
    }
    last = re.lastIndex;
  }
  if (last < text.length) {
    tokens.push({ text: text.slice(last), kind: 'plain' });
  }
  return tokens;
}

/** Dark-codeblock color per JSON token kind (gold keys, blue strings). */
const TOKEN_CLASS: Record<JsonToken['kind'], string> = {
  key: 'text-primary-200',
  string: 'text-info-200',
  number: 'text-success-300',
  literal: 'text-success-300',
  plain: 'text-grayscale-500',
};

export function LogViewerPage() {
  const [events, setEvents] = useState<LogEvent[]>(() =>
    [...logger.getEvents()].reverse(),
  );
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>(getStoredTypeFilter);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const debouncedQuery = useDebouncedValue(query, 250);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());

  // Live/pause stream control: while paused, incoming events buffer in a ref
  // (no re-render churn) and surface as a "N new" count on the Resume button.
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const bufferRef = useRef<LogEvent[]>([]);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    setEvents([...logger.getEvents()].reverse());
    return logger.subscribe((event) => {
      if (pausedRef.current) {
        bufferRef.current.push(event);
        setPendingCount(bufferRef.current.length);
      } else {
        setEvents((prev) => [event, ...prev]);
      }
    });
  }, []);

  // Tick a clock so "Nm ago" labels stay fresh.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const counts = useMemo(() => {
    const c = { all: events.length, error: 0, warn: 0, info: 0, debug: 0 };
    for (const event of events) {
      c[event.level] += 1;
    }
    return c;
  }, [events]);

  const filteredEvents = useMemo(
    () =>
      filterEvents(events, {
        level: levelFilter,
        type: typeFilter,
        query: debouncedQuery,
      }),
    [events, levelFilter, typeFilter, debouncedQuery],
  );

  const totalRows = filteredEvents.length;
  const pagination = computePagination(totalRows, pageSize, page);
  const visibleEvents = useMemo(
    () =>
      filteredEvents.slice(
        pagination.currentPage * pageSize,
        pagination.currentPage * pageSize + pageSize,
      ),
    [filteredEvents, pagination.currentPage, pageSize],
  );

  const visibleIds = useMemo(
    () => visibleEvents.map((e) => e.id),
    [visibleEvents],
  );
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

  function toggleSelectAll(checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) {
        for (const id of visibleIds) next.add(id);
      } else {
        for (const id of visibleIds) next.delete(id);
      }
      return next;
    });
  }

  function toggleOne(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function togglePaused() {
    setPaused((prev) => {
      const next = !prev;
      pausedRef.current = next;
      if (!next && bufferRef.current.length > 0) {
        const pending = bufferRef.current;
        bufferRef.current = [];
        setPendingCount(0);
        setEvents((visible) => mergePendingEvents(pending, visible));
      }
      return next;
    });
  }

  function handleClearLogs() {
    logger.clear();
    bufferRef.current = [];
    setPendingCount(0);
    setPage(0);
    setEvents([]);
    setSelected(new Set());
    setExpanded(new Set());
  }

  function handleClearSelection() {
    setSelected(new Set());
  }

  function handleAskJiffy() {
    const selectedEvents = events.filter((e) => selected.has(e.id));
    if (selectedEvents.length === 0) {
      logger.warn('log-viewer:ask-jiffy:noop', {
        reason: 'no selected events resolved',
        selectedCount: selected.size,
      });
      return;
    }
    const payload = buildLogsFixItPayload(selectedEvents, {
      url: typeof window !== 'undefined' ? window.location.href : '',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    });
    // Diagnostic: confirm the fix-it is emitted with the platform-expected
    // shape (message/stack present). Visible in /logs + bridged to parent.
    logger.debug('log-viewer:ask-jiffy:emit', {
      count: selectedEvents.length,
      hasMessage: Boolean(payload.message),
      hasStack: Boolean(payload.stack),
    });
    logger.log('fix-it', payload);
    setSelected(new Set());
  }

  return (
    <div className="w-full">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex gap-3">
          <span className="grid size-10 shrink-0 place-content-center rounded-lg border border-primary-300 bg-primary-50 text-primary-600">
            <i className="icon icon_-Tb_article text-[1.25rem]" aria-hidden="true" />
          </span>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-[1.375rem] font-semibold tracking-tight">Logs</h1>
              <Badge variant="secondary" className="rounded-full">
                {counts.all} total
              </Badge>
              <span
                role="status"
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold',
                  paused
                    ? 'border-warning-200 bg-warning-50 text-warning-700'
                    : 'border-success-200 bg-success-50 text-success-500',
                )}
              >
                <span
                  className={cn(
                    'size-[0.4375rem] rounded-full',
                    paused
                      ? 'bg-warning-500'
                      : 'animate-pulse bg-success-500 motion-reduce:animate-none',
                  )}
                />
                {paused ? 'Paused' : 'Live'}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              In-app events captured by the logger. Select one or more rows and
              ask JIFFY to diagnose them.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="tertiary"
            size="sm"
            onClick={togglePaused}
            aria-pressed={paused}
          >
            <i
              className={cn(
                'icon text-[1.125rem]',
                paused ? 'icon_-Tb_player_play' : 'icon_-Tb_player_pause',
              )}
              aria-hidden="true"
            />
            {paused
              ? pendingCount > 0
                ? `Resume · ${pendingCount} new`
                : 'Resume'
              : 'Pause'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="hover:bg-danger-50 hover:text-danger-600"
            onClick={handleClearLogs}
            disabled={events.length === 0}
          >
            <i className="icon icon_-Tb_trash text-[1.125rem]" aria-hidden="true" />
            Clear Logs
          </Button>
        </div>
      </div>

      {/* Toolbar — floats above the grid, like the app's list pages */}
      <div className="mb-3 mt-6 flex flex-wrap items-center justify-between gap-3">
        {/* Level filter — same SegmentedControl + default (md) size as the
            servicing queue's Open/Closed toggle, so heights match exactly. */}
        <SegmentedControl
          value={levelFilter}
          onValueChange={(v) => {
            setLevelFilter(v as LevelFilter);
            setPage(0);
          }}
          aria-label="Filter by level"
          options={[
            { value: 'all', label: `All (${counts.all})` },
            { value: 'error', label: `Error (${counts.error})` },
            { value: 'warn', label: `Warn (${counts.warn})` },
            { value: 'info', label: `Info (${counts.info})` },
            { value: 'debug', label: `Debug (${counts.debug})` },
          ]}
        />

        <div className="flex flex-wrap items-center gap-3">
          {/* Search collapses to an icon (SR-queue pattern); expands on click. */}
          {searchOpen || query ? (
            <InputGroup className="h-auto w-64 self-stretch">
              <InputGroupAddon>
                <i
                  className="icon icon_-Tb_search text-[1.125rem]"
                  aria-hidden="true"
                />
              </InputGroupAddon>
              <InputGroupInput
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(0);
                }}
                onBlur={() => {
                  if (!query.trim()) setSearchOpen(false);
                }}
                placeholder="Search type, message, payload"
                aria-label="Search logs"
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  size="icon-xs"
                  aria-label="Clear search"
                  onClick={() => {
                    setQuery('');
                    setPage(0);
                    setSearchOpen(false);
                  }}
                >
                  <i className="icon icon_-Tb_x text-[1rem]" aria-hidden="true" />
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          ) : (
            <Button
              variant="ghost"
              className="h-auto w-11 self-stretch"
              aria-label="Search logs"
              onClick={() => setSearchOpen(true)}
            >
              <i
                className="icon icon_-Tb_search text-[1.25rem]"
                aria-hidden="true"
              />
            </Button>
          )}

          <SegmentedControl
            value={typeFilter}
            onValueChange={(v) => {
              const next = normalizeTypeFilter(v);
              setTypeFilter(next);
              setPage(0);
              try {
                window.sessionStorage.setItem(TYPE_FILTER_STORAGE_KEY, next);
              } catch {
                // Keep the in-memory selection when storage is unavailable.
              }
            }}
            aria-label="Filter by type"
            options={[
              { value: ALL_TYPES, label: 'All' },
              { value: SAVED_QUERY_TYPES, label: 'Saved Query' },
            ]}
          />
        </div>
      </div>

      {/* Table — DataTable (AG Grid theme) look & feel: gold wrap border,
          cream 2.875rem header band with primary-300 column separators. */}
      <div className="overflow-hidden rounded-[0.625rem] border border-primary-200 bg-card">
        {visibleEvents.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <div className="mx-auto grid size-12 place-content-center rounded-full bg-muted text-muted-foreground">
              <i
                className={cn(
                  'icon text-[1.25rem]',
                  events.length === 0 ? 'icon_-Tb_article' : 'icon_-Tb_search_off',
                )}
                aria-hidden="true"
              />
            </div>
            <p className="mt-4 text-base font-semibold">
              {events.length === 0 ? 'No logs yet' : 'No logs match this view'}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {events.length === 0
                ? 'Logs emitted via the logger will appear here in real time.'
                : 'Try a different search, level segment, or type filter.'}
            </p>
          </div>
        ) : (
          <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-[2.875rem] w-12 border-r border-primary-300 bg-primary-50 px-0 text-center">
                    <Checkbox
                      className="mx-auto"
                      aria-label="Select all visible logs"
                      checked={allVisibleSelected}
                      onCheckedChange={(checked) =>
                        toggleSelectAll(checked === true)
                      }
                    />
                  </TableHead>
                  <TableHead className="h-[2.875rem] w-28 border-r border-primary-300 bg-primary-50 px-3 text-[1rem] font-semibold text-foreground">
                    Level
                  </TableHead>
                  <TableHead className="h-[2.875rem] w-72 border-r border-primary-300 bg-primary-50 px-3 text-[1rem] font-semibold text-foreground">
                    Type
                  </TableHead>
                  <TableHead className="h-[2.875rem] border-r border-primary-300 bg-primary-50 px-3 text-[1rem] font-semibold text-foreground">
                    Message
                  </TableHead>
                  <TableHead className="h-[2.875rem] w-32 border-r border-primary-300 bg-primary-50 px-3 text-right text-[1rem] font-semibold text-foreground">
                    Time
                  </TableHead>
                  <TableHead className="h-[2.875rem] w-10 bg-primary-50" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleEvents.map((event) => (
                  <LogRow
                    key={event.id}
                    event={event}
                    selected={selected.has(event.id)}
                    expanded={expanded.has(event.id)}
                    onSelectChange={(checked) =>
                      toggleOne(event.id, checked)
                    }
                    onToggleExpanded={() => toggleExpanded(event.id)}
                    now={now}
                  />
                ))}
              </TableBody>
          </Table>
        )}
        {/* Pagination — mirrors DataTable's PaginationBar (Total · pager ·
            rows-per-page · range), hidden when there is nothing to page. */}
        {totalRows > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-background px-4 py-2 text-sm text-muted-foreground">
            <div>
              Total:{' '}
              <span className="font-semibold text-foreground">
                {totalRows.toLocaleString()}
              </span>{' '}
              records
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  disabled={pagination.currentPage <= 0}
                  onClick={() => setPage(pagination.currentPage - 1)}
                  aria-label="Previous page"
                  className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                >
                  <i
                    className="icon icon_-Tb_circle_chevron_left text-[1.375rem]"
                    aria-hidden="true"
                  />
                </button>
                <span>Page</span>
                <input
                  type="text"
                  inputMode="numeric"
                  aria-label="Page number"
                  className="h-7 w-10 rounded-md border border-input bg-transparent text-center text-sm font-semibold text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                  value={pagination.currentPage + 1}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    if (!Number.isNaN(n) && n >= 1 && n <= pagination.totalPages) {
                      setPage(n - 1);
                    }
                  }}
                />
                <span>of {pagination.totalPages.toLocaleString()}</span>
                <button
                  type="button"
                  disabled={pagination.currentPage >= pagination.totalPages - 1}
                  onClick={() => setPage(pagination.currentPage + 1)}
                  aria-label="Next page"
                  className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                >
                  <i
                    className="icon icon_-Tb_circle_chevron_right text-[1.375rem]"
                    aria-hidden="true"
                  />
                </button>
              </div>
              <span aria-hidden="true" className="h-[1.375rem] w-px bg-border" />
              <div className="flex items-center gap-2.5">
                <span>Rows per page</span>
                <div className="relative">
                  <select
                    aria-label="Rows per page"
                    className="h-7 appearance-none rounded-md border border-input bg-transparent pl-2 pr-7 text-sm font-semibold text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setPage(0);
                    }}
                  >
                    {PAGE_SIZE_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <i
                    className="icon icon_-Tb_chevron_down pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[1rem] text-muted-foreground"
                    aria-hidden="true"
                  />
                </div>
              </div>
              <span aria-hidden="true" className="h-[1.375rem] w-px bg-border" />
              <span className="tabular-nums">
                {pagination.rangeStart.toLocaleString()} -{' '}
                {pagination.rangeEnd.toLocaleString()} of{' '}
                {totalRows.toLocaleString()}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Sticky Ask-JIFFY selection bar (in-flow, sticks above the fold) */}
      {selected.size > 0 && (
        <div className="sticky bottom-4 z-30 mt-4">
          <Card className="flex flex-wrap items-center justify-between gap-3 rounded-[0.625rem] border-primary-300 bg-primary-50 px-4 py-2.5 shadow-lg">
            <div className="flex items-center gap-3">
              <span className="grid size-8 place-content-center rounded-full bg-primary-500 text-white">
                <i
                  className="icon icon_-Tb_sparkles text-[1.125rem]"
                  aria-hidden="true"
                />
              </span>
              <span className="text-sm">
                <span className="font-semibold">
                  {selected.size} log{selected.size === 1 ? '' : 's'} selected
                </span>{' '}
                <span className="text-muted-foreground">
                  — ask JIFFY to diagnose and fix
                </span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={handleClearSelection}>
                Clear selection
              </Button>
              <Button size="sm" onClick={handleAskJiffy}>
                <i
                  className="icon icon_-Tb_sparkles text-[1.125rem]"
                  aria-hidden="true"
                />
                Ask JIFFY to Fix
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function CopyPayloadButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="tertiary"
      size="sm"
      className="h-6 gap-1.5 px-2 text-xs"
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          logger.warn('log-viewer:copy:failed', {
            reason: 'clipboard unavailable',
          });
        }
      }}
    >
      <i
        className={cn(
          'icon text-[1rem]',
          copied ? 'icon_-Tb_check text-success-500' : 'icon_-Tb_copy',
        )}
        aria-hidden="true"
      />
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}

/** Dark payload panel with JSON syntax coloring (plain strings stay plain). */
function PayloadBlock({ payload }: { payload: unknown }) {
  const text = formatPayload(payload);
  const isJsonish = typeof payload === 'object' && payload !== null;
  return (
    <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-grayscale-900 px-4 py-3.5 font-mono text-xs leading-[1.7]">
      {isJsonish ? (
        highlightJson(text).map((t, i) => (
          <span key={i} className={TOKEN_CLASS[t.kind]}>
            {t.text}
          </span>
        ))
      ) : (
        <span className="text-grayscale-200">{text}</span>
      )}
    </pre>
  );
}

function LogRow({
  event,
  selected,
  expanded,
  onSelectChange,
  onToggleExpanded,
  now,
}: {
  event: LogEvent;
  selected: boolean;
  expanded: boolean;
  onSelectChange: (checked: boolean) => void;
  onToggleExpanded: () => void;
  now: number;
}) {
  const message = deriveMessage(event);
  const truncated =
    message.length > MAX_MESSAGE_PREVIEW
      ? `${message.slice(0, MAX_MESSAGE_PREVIEW)}…`
      : message;
  const styles = levelStyles(event.level);
  const time = new Date(event.timestamp);

  return (
    <>
      <TableRow
        className={cn(
          'cursor-pointer',
          selected &&
            'bg-primary-50 shadow-[inset_2px_0_0_var(--color-primary-400)] hover:bg-primary-50',
        )}
        onClick={onToggleExpanded}
      >
        <TableCell
          className="h-[2.875rem] w-12 px-0 text-center"
          onClick={(e) => e.stopPropagation()}
        >
          <Checkbox
            className="mx-auto"
            aria-label={`Select log ${event.id}`}
            checked={selected}
            onCheckedChange={(checked) => onSelectChange(checked === true)}
          />
        </TableCell>
        <TableCell className="h-[2.875rem] px-3">
          <Badge className={cn('gap-1.5 rounded-full', styles.badge)}>
            <span className={cn('h-1.5 w-1.5 rounded-full', styles.dot)} />
            {LEVEL_LABELS[event.level]}
          </Badge>
        </TableCell>
        <TableCell className="h-[2.875rem] px-3">
          <span className="inline-flex items-center gap-2">
            <i
              className={cn(
                'icon text-[1.125rem] text-grayscale-500 dark:text-muted-foreground',
                iconForType(event.type),
              )}
              aria-hidden="true"
            />
            <span
              title={event.type}
              className="text-sm text-grayscale-700 dark:text-foreground"
            >
              {humanizeLogType(event.type)}
            </span>
          </span>
        </TableCell>
        <TableCell className="h-[2.875rem] max-w-0 px-3">
          <span className="block max-w-[48rem] truncate font-mono text-[0.8125rem] text-muted-foreground">
            {truncated || (
              <span className="font-sans italic opacity-60">(no payload)</span>
            )}
          </span>
        </TableCell>
        <TableCell className="h-[2.875rem] px-3 text-right">
          <span className="block text-[0.8125rem] text-grayscale-600 dark:text-muted-foreground">
            {formatRelative(event.timestamp, now)}
          </span>
          <span className="block font-mono text-xs tabular-nums text-grayscale-400">
            {formatClock(time)}
          </span>
        </TableCell>
        <TableCell className="h-[2.875rem] px-3 text-center">
          <i
            className={cn(
              'icon icon_-Tb_chevron_down inline-block text-[1.125rem] text-grayscale-400 transition-transform motion-reduce:transition-none',
              !expanded && '-rotate-90',
            )}
            aria-hidden="true"
          />
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={6} className="h-auto bg-grayscale-50 px-5 pb-4 pt-3 dark:bg-muted/40">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 text-[0.6875rem]">
                  <span className="font-bold uppercase tracking-[0.08em] text-grayscale-500 dark:text-muted-foreground">
                    Payload
                  </span>
                  <code className="font-mono text-grayscale-400">{event.id}</code>
                </div>
                <CopyPayloadButton text={formatPayload(event.payload)} />
              </div>
              <PayloadBlock payload={event.payload} />
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

const LEVEL_LABELS: Record<LogLevel, string> = {
  debug: 'Debug',
  info: 'Info',
  warn: 'Warn',
  error: 'Error',
};

export function levelStyles(level: LogLevel): { badge: string; dot: string } {
  switch (level) {
    case 'error':
      return {
        badge: 'bg-danger-50 text-danger-600 border-danger-200',
        dot: 'bg-danger-500',
      };
    case 'warn':
      return {
        badge: 'bg-warning-50 text-warning-700 border-warning-200',
        dot: 'bg-warning-500',
      };
    case 'info':
      return {
        badge: 'bg-info-50 text-info-600 border-info-200',
        dot: 'bg-info-500',
      };
    case 'debug':
    default:
      return {
        badge: 'bg-muted text-muted-foreground border-border',
        dot: 'bg-muted-foreground/60',
      };
  }
}

/**
 * Pick a sensible human-readable message from a log event's payload.
 * Prefers an `error`, then `message`, then `reason` field on object
 * payloads. For everything else, falls back to a compact JSON dump.
 * Returns an empty string when the payload carries no useful text.
 */
export function deriveMessage(event: LogEvent): string {
  const payload = event.payload;
  if (payload === null || payload === undefined) return '';
  if (typeof payload === 'string') return payload;
  if (typeof payload === 'number' || typeof payload === 'boolean') {
    return String(payload);
  }
  if (typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    for (const key of ['error', 'message', 'reason', 'summary'] as const) {
      const val = obj[key];
      if (typeof val === 'string' && val.length > 0) return val;
    }
    try {
      return JSON.stringify(payload);
    } catch {
      return String(payload);
    }
  }
  return String(payload);
}

const TYPE_ICON_RULES: Array<{ test: (type: string) => boolean; icon: string }> = [
  { test: (t) => t === 'fix-it', icon: 'icon_-Tb_sparkles' },
  { test: (t) => t.startsWith('error'), icon: 'icon_-Tb_alert_triangle' },
  { test: (t) => t.startsWith('entity:'), icon: 'icon_-Tb_database' },
  { test: (t) => t.startsWith('saved-query:'), icon: 'icon_-Tb_database' },
  { test: (t) => t.startsWith('workflow:'), icon: 'icon_-Tb_sitemap' },
  { test: (t) => t.startsWith('app:'), icon: 'icon_-Tb_rocket' },
  { test: (t) => t.startsWith('partner'), icon: 'icon_-Tb_plug' },
];

/**
 * Map a log event's `type` string to a Nucleo glyph class based on its
 * prefix. Returns the generic activity glyph when no rule matches.
 */
export function iconForType(type: string): string {
  for (const rule of TYPE_ICON_RULES) {
    if (rule.test(type)) return rule.icon;
  }
  return 'icon_-Tb_activity';
}

/**
 * Render a coarse "N units ago" string for a timestamp. Granularity:
 * seconds (< 1m) → "just now"; minutes (< 60m); hours (< 24h); days.
 * `now` is passed in so callers (and tests) can control the clock.
 */
export function formatRelative(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const diffMs = Math.max(0, now - then);
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function formatClock(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatPayload(payload: unknown): string {
  if (payload === undefined) return 'undefined';
  if (payload === null) return 'null';
  if (typeof payload === 'string') return payload;
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

export default LogViewerPage;
