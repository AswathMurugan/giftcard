/**
 * Chat-history grouping + relative timestamps.
 *
 * Pure so it's testable — vitest runs `environment: 'node'`, so the sidebar
 * itself gets no render test and this is where the real logic lives.
 */
import type { ChatSession } from '@/services/session-api';
import type { ChatMessage } from '@/components/shared/agent-chat/hooks/agent-chat-reducer';

export type SessionGroupKey = 'today' | 'yesterday' | 'previous7' | 'older';

/** Sessions arrive newest-first, so groups fall out in this order naturally. */
export const GROUP_ORDER: SessionGroupKey[] = [
  'today',
  'yesterday',
  'previous7',
  'older',
];

export const GROUP_LABELS: Record<SessionGroupKey, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  previous7: 'Last 7 days',
  older: 'Older',
};

const DAY_MS = 86_400_000;

/** Only a user-authored, rendered turn means the active chat has been sent. */
export function hasVisibleUserMessage(
  messages: readonly Pick<ChatMessage, 'role' | 'hidden'>[],
): boolean {
  return messages.some((message) => message.role === 'user' && !message.hidden);
}

/**
 * Local midnight of the day `now` falls on. The caller computes this once per
 * render and shares it across rows, so grouping allocates no Date per session.
 */
export function startOfTodayMs(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

/**
 * Bucket a session by CALENDAR DAY, not elapsed hours — so a chat from 11pm
 * yesterday reads as "Yesterday" rather than "Today". An unparseable timestamp
 * sorts to 'older' rather than throwing.
 */
export function groupKeyFor(iso: string, startOfToday: number): SessionGroupKey {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'older';
  if (then >= startOfToday) return 'today';
  if (then >= startOfToday - DAY_MS) return 'yesterday';
  if (then >= startOfToday - 7 * DAY_MS) return 'previous7';
  return 'older';
}

/** "now" / "5m ago" / "3h ago" / "2d ago", then an absolute date past a week. */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.floor((now - then) / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(then).toLocaleDateString();
}

/** Row title — falls back to the message preview, then a default. */
export function sessionLabel(session: ChatSession): string {
  if (session.title) return session.title;
  const preview = session.preview?.trim();
  if (preview) return preview.length > 48 ? `${preview.slice(0, 48)}…` : preview;
  return 'New chat';
}

/**
 * Prepend a single transient "New chat" row for the active UNSENT session.
 *
 * Derived per render and never stored, so it cannot duplicate: it's skipped
 * once the server list contains the id, which means the real titled row takes
 * over automatically the moment the backend persists the chat. Storing such a
 * row instead (one per minted session id) is what produces phantom sessions on
 * every chat open / agent switch.
 */
export function withActiveGhost(
  sessions: ChatSession[],
  activeSessionId: string,
  isActiveUnsent: boolean,
  now: Date = new Date(),
): ChatSession[] {
  if (!isActiveUnsent || !activeSessionId) return sessions;
  if (sessions.some((s) => s.session_id === activeSessionId)) return sessions;
  const iso = now.toISOString();
  return [
    {
      session_id: activeSessionId,
      title: null,
      preview: '',
      created_at: iso,
      updated_at: iso,
      message_count: 0,
    },
    ...sessions,
  ];
}

export interface SessionGroup {
  key: SessionGroupKey;
  label: string;
  sessions: ChatSession[];
}

/**
 * Filter by search term, then bucket into date groups. Empty groups are
 * dropped, so the UI can render the result directly without guarding.
 */
export function groupSessions(
  sessions: ChatSession[],
  search: string,
  now: Date = new Date(),
): SessionGroup[] {
  const term = search.trim().toLowerCase();
  const matching = term
    ? sessions.filter((s) => sessionLabel(s).toLowerCase().includes(term))
    : sessions;

  const startOfToday = startOfTodayMs(now);
  const buckets = new Map<SessionGroupKey, ChatSession[]>();
  for (const session of matching) {
    const key = groupKeyFor(session.updated_at, startOfToday);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(session);
    else buckets.set(key, [session]);
  }

  return GROUP_ORDER.filter((key) => buckets.get(key)?.length).map((key) => ({
    key,
    label: GROUP_LABELS[key],
    sessions: buckets.get(key) as ChatSession[],
  }));
}
