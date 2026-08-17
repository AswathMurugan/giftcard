/**
 * Pure helpers for the composer's attachment tray.
 *
 * The stateful React lives in AgentChatInput; the DECISIONS — whether a send is
 * allowed, what to collect for the wire — are extracted here so they're testable
 * (vitest is `environment: node`, no DOM). Mirrors the platform's
 * attachment-card model: each file is `uploading` → `ready` | `error`.
 */
import type { PendingAttachment } from '@/components/shared/agent-chat/AgentChatInput';

export type TrayStatus = 'uploading' | 'ready' | 'error';

export interface TrayItemState {
  /** Local row id — stable across the upload, distinct from the Drive id. */
  key: string;
  filename: string;
  status: TrayStatus;
  /** Set on success; the value passed to the agent. */
  attachment: PendingAttachment | null;
  /** Set on failure — shown as the card subtitle. */
  error?: string;
}

/**
 * A message may be sent only when NO attachment is still uploading — a
 * half-uploaded batch would send ids that don't exist yet. Errored rows are
 * allowed: they contribute nothing (see `collectReady`) and the user can remove
 * them, matching the platform (which blocks only on `isUploading`).
 */
export function canSendWithTray(items: Pick<TrayItemState, 'status'>[]): boolean {
  return !items.some((i) => i.status === 'uploading');
}

/** The wire payload: the resolved attachments of every READY row, in order. */
export function collectReady(items: TrayItemState[]): PendingAttachment[] {
  return items
    .filter(
      (i): i is TrayItemState & { attachment: PendingAttachment } =>
        i.status === 'ready' && i.attachment !== null,
    )
    .map((i) => i.attachment);
}
