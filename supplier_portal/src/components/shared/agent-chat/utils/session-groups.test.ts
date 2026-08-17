import { describe, it, expect } from 'vitest';
import {
  startOfTodayMs,
  groupKeyFor,
  formatRelativeTime,
  sessionLabel,
  groupSessions,
  hasVisibleUserMessage,
  withActiveGhost,
  GROUP_ORDER,
  GROUP_LABELS,
} from './session-groups';
import type { ChatSession } from '@/services/session-api';

/** A session at `updated_at`; other fields are filler the grouping ignores. */
function session(updated_at: string, over: Partial<ChatSession> = {}): ChatSession {
  return {
    session_id: over.session_id ?? `s-${updated_at}`,
    title: over.title ?? null,
    preview: over.preview ?? '',
    created_at: updated_at,
    updated_at,
    message_count: over.message_count ?? 1,
  };
}

// A fixed "now" so these never depend on when the suite runs.
const NOW = new Date(2026, 5, 15, 14, 30); // 15 Jun 2026, 2:30pm local
const START_OF_TODAY = startOfTodayMs(NOW);
/** Local-midnight-anchored ISO, so tests don't drift across timezones. */
const at = (offsetMs: number) => new Date(START_OF_TODAY + offsetMs).toISOString();
const HOUR = 3_600_000;
const DAY = 86_400_000;

describe('hasVisibleUserMessage', { tags: ['agent-chat', 'important'] }, () => {
  it('is false for hidden-only user turns', { tags: ['edge-case'] }, () => {
    expect(hasVisibleUserMessage([{ role: 'user', hidden: true }])).toBe(false);
  });

  it('is true for a visible user turn', { tags: ['smoke'] }, () => {
    expect(hasVisibleUserMessage([{ role: 'user', hidden: false }])).toBe(true);
  });

  it('is false for assistant-only turns', { tags: ['edge-case'] }, () => {
    expect(hasVisibleUserMessage([{ role: 'assistant' }])).toBe(false);
  });

  it('finds a visible user turn in a mixed transcript', { tags: ['logic'] }, () => {
    expect(
      hasVisibleUserMessage([
        { role: 'user', hidden: true },
        { role: 'assistant' },
        { role: 'user' },
      ]),
    ).toBe(true);
  });
});

describe('startOfTodayMs', { tags: ['agent-chat', 'logic'] }, () => {
  it('strips the time, keeping the calendar day', () => {
    const midnight = new Date(START_OF_TODAY);
    expect(midnight.getHours()).toBe(0);
    expect(midnight.getMinutes()).toBe(0);
    expect(midnight.getDate()).toBe(15);
  });
});

describe('groupKeyFor', { tags: ['agent-chat', 'important'] }, () => {
  it('buckets by calendar day, not elapsed hours', { tags: ['edge-case'] }, () => {
    // 11pm "yesterday" is only 15.5h before NOW but belongs to Yesterday —
    // this is the whole reason the boundary is midnight-anchored.
    expect(groupKeyFor(at(-HOUR), START_OF_TODAY)).toBe('yesterday');
    // Just after midnight today is Today even though it's ~14h ago.
    expect(groupKeyFor(at(HOUR), START_OF_TODAY)).toBe('today');
  });

  it('treats exact midnight as today', { tags: ['edge-case'] }, () => {
    expect(groupKeyFor(at(0), START_OF_TODAY)).toBe('today');
  });

  it('walks out through the older buckets', () => {
    expect(groupKeyFor(at(-DAY), START_OF_TODAY)).toBe('yesterday');
    expect(groupKeyFor(at(-3 * DAY), START_OF_TODAY)).toBe('previous7');
    expect(groupKeyFor(at(-30 * DAY), START_OF_TODAY)).toBe('older');
  });

  it('puts the 7-day boundary in previous7 and past it in older', { tags: ['edge-case'] }, () => {
    expect(groupKeyFor(at(-7 * DAY), START_OF_TODAY)).toBe('previous7');
    expect(groupKeyFor(at(-7 * DAY - 1), START_OF_TODAY)).toBe('older');
  });

  it('sorts an unparseable timestamp to older instead of throwing', { tags: ['edge-case'] }, () => {
    expect(groupKeyFor('not-a-date', START_OF_TODAY)).toBe('older');
    expect(groupKeyFor('', START_OF_TODAY)).toBe('older');
  });
});

describe('formatRelativeTime', { tags: ['agent-chat', 'logic'] }, () => {
  const now = NOW.getTime();
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it('reads "now" under a minute', () => {
    expect(formatRelativeTime(ago(0), now)).toBe('now');
    expect(formatRelativeTime(ago(59_000), now)).toBe('now');
  });

  it('steps up through minutes, hours, and days', () => {
    expect(formatRelativeTime(ago(60_000), now)).toBe('1m ago');
    expect(formatRelativeTime(ago(45 * 60_000), now)).toBe('45m ago');
    expect(formatRelativeTime(ago(HOUR), now)).toBe('1h ago');
    expect(formatRelativeTime(ago(5 * HOUR), now)).toBe('5h ago');
    expect(formatRelativeTime(ago(DAY), now)).toBe('1d ago');
    expect(formatRelativeTime(ago(6 * DAY), now)).toBe('6d ago');
  });

  it('falls back to an absolute date at a week', { tags: ['edge-case'] }, () => {
    const out = formatRelativeTime(ago(7 * DAY), now);
    expect(out).not.toMatch(/ago|now/);
    expect(out).toBe(new Date(now - 7 * DAY).toLocaleDateString());
  });

  it('returns empty for an unparseable timestamp', { tags: ['edge-case'] }, () => {
    expect(formatRelativeTime('nope', now)).toBe('');
  });
});

describe('sessionLabel', { tags: ['agent-chat', 'logic'] }, () => {
  it('prefers the title', () => {
    expect(sessionLabel(session(at(0), { title: 'Quarterly report' }))).toBe(
      'Quarterly report',
    );
  });

  it('falls back to the preview, then to a default', () => {
    expect(sessionLabel(session(at(0), { preview: 'How do I…' }))).toBe('How do I…');
    expect(sessionLabel(session(at(0)))).toBe('New chat');
    // Whitespace-only preview is not a label.
    expect(sessionLabel(session(at(0), { preview: '   ' }))).toBe('New chat');
  });

  it('truncates a long preview with an ellipsis', { tags: ['edge-case'] }, () => {
    const label = sessionLabel(session(at(0), { preview: 'x'.repeat(80) }));
    expect(label).toHaveLength(49); // 48 chars + the ellipsis
    expect(label.endsWith('…')).toBe(true);
  });
});

describe('groupSessions', { tags: ['agent-chat', 'important'] }, () => {
  // Offsets here are from NOW (2:30pm), not midnight — `at()` is
  // midnight-anchored, so at(-HOUR) would be 11pm YESTERDAY.
  const fromNow = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
  const rows = [
    session(fromNow(HOUR / 2), { session_id: 'today-1', title: 'Pipeline run' }),
    session(fromNow(18 * HOUR), { session_id: 'yest-1', title: 'Invoice parse' }),
    session(fromNow(3 * DAY), { session_id: 'week-1', title: 'Schema draft' }),
    session(fromNow(40 * DAY), { session_id: 'old-1', title: 'Archive sweep' }),
  ];

  it('returns groups in a stable display order', () => {
    const groups = groupSessions(rows, '', NOW);
    expect(groups.map((g) => g.key)).toEqual(['today', 'yesterday', 'previous7', 'older']);
    expect(groups.map((g) => g.label)).toEqual([
      'Today',
      'Yesterday',
      'Last 7 days',
      'Older',
    ]);
  });

  it('drops empty groups rather than rendering a bare header', { tags: ['edge-case'] }, () => {
    const groups = groupSessions([rows[0]], '', NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('today');
  });

  it('returns nothing for no sessions', { tags: ['edge-case'] }, () => {
    expect(groupSessions([], '', NOW)).toEqual([]);
  });

  it('filters by search, case-insensitively', () => {
    const groups = groupSessions(rows, 'INVOICE', NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0].sessions[0].session_id).toBe('yest-1');
  });

  it('searches the fallback label, not just the title', () => {
    const untitled = [session(at(0), { session_id: 'u1', preview: 'Reconcile ledger' })];
    expect(groupSessions(untitled, 'ledger', NOW)).toHaveLength(1);
    expect(groupSessions(untitled, 'ledger', NOW)[0].sessions[0].session_id).toBe('u1');
  });

  it('ignores surrounding whitespace in the search term', { tags: ['edge-case'] }, () => {
    expect(groupSessions(rows, '   ', NOW)).toHaveLength(4); // blank = no filter
    expect(groupSessions(rows, '  invoice  ', NOW)).toHaveLength(1);
  });

  it('returns nothing when the search matches no session', { tags: ['edge-case'] }, () => {
    expect(groupSessions(rows, 'zzzzz', NOW)).toEqual([]);
  });

  it('preserves the incoming (newest-first) order within a group', () => {
    const sameDay = [
      session(fromNow(HOUR), { session_id: 'a' }),
      session(fromNow(2 * HOUR), { session_id: 'b' }),
      session(fromNow(3 * HOUR), { session_id: 'c' }),
    ];
    const [today] = groupSessions(sameDay, '', NOW);
    expect(today.sessions.map((s) => s.session_id)).toEqual(['a', 'b', 'c']);
  });
});

describe('withActiveGhost', { tags: ['agent-chat', 'important'] }, () => {
  const existing = [session(at(0), { session_id: 'saved-1', title: 'Saved chat' })];

  it('prepends a transient "New chat" row for an unsent active session', () => {
    const rows = withActiveGhost(existing, 'active-1', true, NOW);
    expect(rows).toHaveLength(2);
    expect(rows[0].session_id).toBe('active-1');
    expect(rows[0].title).toBeNull();
    expect(rows[0].message_count).toBe(0);
    // The label helper turns a null title into the placeholder text.
    expect(sessionLabel(rows[0])).toBe('New chat');
  });

  it('adds nothing once the chat has been sent', () => {
    expect(withActiveGhost(existing, 'active-1', false, NOW)).toBe(existing);
  });

  it(
    'never duplicates a session the server already returned',
    { tags: ['important'] },
    () => {
      // The real row takes over the moment the backend persists the chat.
      const rows = withActiveGhost(existing, 'saved-1', true, NOW);
      expect(rows).toBe(existing);
      expect(rows.filter((s) => s.session_id === 'saved-1')).toHaveLength(1);
    },
  );

  it('is a no-op without an active id', { tags: ['edge-case'] }, () => {
    expect(withActiveGhost(existing, '', true, NOW)).toBe(existing);
  });

  it('works against an empty server list', { tags: ['edge-case'] }, () => {
    const rows = withActiveGhost([], 'active-1', true, NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0].session_id).toBe('active-1');
  });

  it('groups the ghost under Today', () => {
    const groups = groupSessions(withActiveGhost([], 'active-1', true, NOW), '', NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('today');
  });
});

describe('group metadata', { tags: ['agent-chat', 'smoke'] }, () => {
  it('labels every key in the order list', () => {
    for (const key of GROUP_ORDER) expect(GROUP_LABELS[key]).toBeTruthy();
    expect(GROUP_ORDER).toHaveLength(Object.keys(GROUP_LABELS).length);
  });
});
