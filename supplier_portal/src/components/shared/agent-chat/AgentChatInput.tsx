/**
 * The chat composer: an auto-growing textarea in a rounded card, with the
 * attach + send actions on a row beneath it.
 *
 * Enter sends; Shift+Enter inserts a newline. Attachments appear only when the
 * page supplies `accept` + `onUpload` (see AGENT-CHAT.md).
 */
import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AttachmentCard } from './AttachmentCard';
import type { AgentChatIcons } from './appearance';
import {
  canSendWithTray,
  collectReady,
  type TrayItemState,
} from './utils/attachment-tray';

/** Auto-grow bounds — one row to five. */
const MAX_ROWS = 5;
const LINE_HEIGHT_PX = 20;

/** The resolved attachment `onUpload` returns — an id the agent can resolve. */
export interface PendingAttachment {
  id: string;
  filename: string;
}

export interface AgentChatInputProps {
  placeholder: string;
  disabled: boolean;
  onSend: (text: string, attachments: PendingAttachment[]) => void;
  /** Accept list. With `onUpload`, enables the paperclip. */
  accept?: string[];
  /** Upload a picked file and resolve its id (see FILE-UPLOAD.md for scope). */
  onUpload?: (file: File) => Promise<PendingAttachment>;
  /** Themed glyph set — merged over the defaults by `AgentChat`. */
  icons: Required<AgentChatIcons>;
}

let trayKeySeq = 0;
const nextTrayKey = () => `att-${(trayKeySeq += 1)}`;

export function AgentChatInput({
  placeholder,
  disabled,
  onSend,
  accept,
  onUpload,
  icons,
}: AgentChatInputProps) {
  const [text, setText] = useState('');
  const [tray, setTray] = useState<TrayItemState[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  // Active state tracks the TEXTAREA's own focus, not the whole card
  // (`focus-within` would also fire for the attach button or send button).
  const [textareaFocused, setTextareaFocused] = useState(false);

  const attachmentsEnabled = Boolean(onUpload);

  // Grow with the content, capped so a long draft can't eat the thread.
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, MAX_ROWS * LINE_HEIGHT_PX)}px`;
  }, [text]);

  const patchRow = useCallback((key: string, patch: Partial<TrayItemState>) => {
    setTray((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }, []);

  const onPick = useCallback(
    (files: FileList | null) => {
      if (!files?.length || !onUpload) return;
      const picked = Array.from(files).map((file) => ({
        key: nextTrayKey(),
        file,
      }));
      setTray((prev) => [
        ...prev,
        ...picked.map(({ key, file }) => ({
          key,
          filename: file.name,
          status: 'uploading' as const,
          attachment: null,
        })),
      ]);
      // Each upload settles its own row — one slow/failed file can't block the
      // others, matching the platform's per-card lifecycle.
      picked.forEach(({ key, file }) => {
        onUpload(file)
          .then((attachment) => patchRow(key, { status: 'ready', attachment }))
          .catch((err) =>
            patchRow(key, {
              status: 'error',
              error: err instanceof Error ? err.message : 'Upload failed',
            }),
          );
      });
      if (fileRef.current) fileRef.current.value = '';
    },
    [onUpload, patchRow],
  );

  const removeRow = useCallback((key: string) => {
    setTray((prev) => prev.filter((r) => r.key !== key));
  }, []);

  // A send needs text AND no attachment still uploading (an errored row is fine
  // — it just contributes nothing).
  const canSend = !disabled && Boolean(text.trim()) && canSendWithTray(tray);

  const submit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled || !canSendWithTray(tray)) return;
    onSend(trimmed, collectReady(tray));
    setText('');
    setTray([]);
  }, [text, disabled, onSend, tray]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    },
    [submit],
  );

  return (
    // No top border — the composer's own rounded card is the only edge; a
    // separator here reads as a double line against it.
    <div className="flex shrink-0 flex-col gap-2 px-3 pb-3 pt-2">
      {tray.length > 0 && (
        <ul className="flex flex-col gap-1.5 px-1" role="list">
          {tray.map((row) => (
            <li key={row.key}>
              <AttachmentCard
                filename={row.filename}
                fileIcon={icons.file}
                status={row.status}
                errorMessage={row.error}
                onRemove={() => removeRow(row.key)}
              />
            </li>
          ))}
        </ul>
      )}

      {/* Soft rounded card — 1rem radius. Active (teal) ONLY while the
          TEXTAREA itself is focused — clicking attach/send must not light it
          up, so this is driven by textareaFocused, not focus-within. */}
      <div
        className={cn(
          'flex flex-col gap-1 rounded-2xl border border-grayscale-300 bg-background',
          'px-2.5 py-2 transition-colors',
          textareaFocused && 'border-teal-400 bg-teal-50',
        )}
      >
        <textarea
          ref={taRef}
          value={text}
          rows={1}
          disabled={disabled}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setTextareaFocused(true)}
          onBlur={() => setTextareaFocused(false)}
          className={cn(
            // chat-scroll: the textarea scrolls once it hits MAX_ROWS.
            // 0.875rem/1.25rem with 0.375rem 0.5rem padding — the platform's
            // composer text is a step SMALLER than body text, not text-base.
            'chat-scroll w-full resize-none bg-transparent px-2 py-1.5',
            'text-sm leading-5 text-foreground',
            'placeholder:font-normal placeholder:text-muted-foreground focus-visible:outline-none',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        />

        <div className="flex items-center justify-end gap-1">
          {attachmentsEnabled && (
            <>
              <input
                ref={fileRef}
                type="file"
                multiple
                accept={accept?.join(',')}
                className="hidden"
                aria-hidden="true"
                tabIndex={-1}
                onChange={(e) => void onPick(e.target.files)}
              />
              {/* A cream circle, not a bare glyph — the `ghost` variant is
                  transparent, so the fill is set here. Deepens a step on
                  hover (primary-50 → primary-100). */}
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  'size-8 rounded-full transition-colors',
                  'bg-primary-50 text-primary-600',
                  'hover:bg-primary-100 hover:text-primary-700',
                )}
                aria-label="Attach a file"
                disabled={disabled}
                onClick={() => fileRef.current?.click()}
              >
                <i className={cn('icon text-[1.25rem]', icons.attach)} aria-hidden="true" />
              </Button>
            </>
          )}

          {/* Idle (nothing typed) is a PALE CREAM circle with a muted gold
              arrow — not a grey disabled chip and not the solid-gold default;
              it stays visually part of the composer until there's a message to
              send, then fills to full gold. */}
          <Button
            size="icon"
            className={cn(
              'size-8 rounded-full transition-colors',
              canSend
                ? 'bg-primary text-primary-foreground hover:bg-primary-700'
                : // `disabled:` prefixes are required — the default variant sets
                  // disabled:bg-primary-200 / border / text, which would
                  // otherwise win over unprefixed classes.
                  'disabled:border-primary-50 disabled:bg-primary-50 disabled:text-primary-300',
            )}
            aria-label="Send message"
            disabled={!canSend}
            onClick={submit}
          >
            <i className={cn('icon text-[1.25rem]', icons.send)} aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}
