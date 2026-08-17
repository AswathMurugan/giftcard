/**
 * Session continuity across navigation.
 *
 * The transport is torn down when the chat unmounts (a route change sends
 * `{"type":"unsubscribe"}`), and a fresh mount would otherwise mint a brand-new
 * session id: the thread the user was in the middle of disappears, an in-flight
 * turn's reply is lost, and a page that sends an opening turn pays for a second
 * agent call. Remembering the id lets the next mount re-adopt the SAME session
 * and reload its history from the backend.
 *
 * `sessionStorage`, not `localStorage`: continuity belongs to this tab's visit,
 * not forever. All access is defensive — storage throws in private-mode Safari
 * and inside sandboxed iframes, and a chat must never break because of it.
 */
const SESSION_PREFIX = 'agent-chat:session:';
const INITIAL_MESSAGE_SENT_KEY = 'agent-chat:initial-message-sent:v1';
const INITIAL_MESSAGE_SENT_LIMIT = 100;

// sessionStorage is authoritative across reloads. These fallbacks still protect
// route remounts in the current page when storage is blocked by the browser.
const storedSessionIds = new Map<string, string>();
const sentInitialMessages = new Set<string>();

function rememberInitialMessages(values: readonly unknown[]): void {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const id = value.trim();
    if (!id) continue;
    sentInitialMessages.delete(id);
    sentInitialMessages.add(id);
  }
  while (sentInitialMessages.size > INITIAL_MESSAGE_SENT_LIMIT) {
    const oldest = sentInitialMessages.values().next().value;
    if (oldest === undefined) break;
    sentInitialMessages.delete(oldest);
  }
}

function parseInitialMessageMarkers(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const markers = new Set<string>();
    for (const item of parsed) {
      if (typeof item !== 'string') continue;
      const id = item.trim();
      if (!id) continue;
      markers.delete(id);
      markers.add(id);
    }
    return [...markers].slice(-INITIAL_MESSAGE_SENT_LIMIT);
  } catch {
    return [];
  }
}

/** The stored id for a page's session key, or '' when there is none. */
export function readStoredSessionId(key: string): string {
  if (!key) return '';
  if (typeof window === 'undefined') return storedSessionIds.get(key) ?? '';
  try {
    const stored = window.sessionStorage.getItem(`${SESSION_PREFIX}${key}`) ?? '';
    if (stored) storedSessionIds.set(key, stored);
    return stored || storedSessionIds.get(key) || '';
  } catch {
    return storedSessionIds.get(key) ?? '';
  }
}

/** Remember the live session id under a page's key. */
export function writeStoredSessionId(key: string, sessionId: string): void {
  if (!key || !sessionId) return;
  storedSessionIds.set(key, sessionId);
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(`${SESSION_PREFIX}${key}`, sessionId);
  } catch {
    // The in-memory id still protects route remounts until the page reloads.
  }
}

/** Whether this tab already published the automatic opening turn for a session. */
export function wasInitialMessageSent(sessionId: string): boolean {
  const id = sessionId.trim();
  if (!id) return false;
  if (sentInitialMessages.has(id)) return true;
  if (typeof window === 'undefined') return false;
  try {
    rememberInitialMessages(
      parseInitialMessageMarkers(window.sessionStorage.getItem(INITIAL_MESSAGE_SENT_KEY)),
    );
    return sentInitialMessages.has(id);
  } catch {
    return false;
  }
}

/** Record an opening turn before publishing so a remount cannot publish it again. */
export function markInitialMessageSent(sessionId: string): void {
  const id = sessionId.trim();
  if (!id) return;
  rememberInitialMessages([id]);
  if (typeof window === 'undefined') return;
  try {
    const stored = parseInitialMessageMarkers(
      window.sessionStorage.getItem(INITIAL_MESSAGE_SENT_KEY),
    );
    rememberInitialMessages(stored);
    rememberInitialMessages([id]);
    window.sessionStorage.setItem(
      INITIAL_MESSAGE_SENT_KEY,
      JSON.stringify([...sentInitialMessages]),
    );
  } catch {
    // The in-memory marker still protects remounts until the page reloads.
  }
}
