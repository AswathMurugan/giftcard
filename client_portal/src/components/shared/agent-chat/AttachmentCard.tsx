/**
 * A file attachment card — shared by the composer tray (with `onRemove` and live
 * upload status) and the sent message bubble (status 'ready', no remove).
 *
 * Ports the platform's `attachment-card`: a 2.25rem cream+gold icon box, the
 * filename, and a status subtitle ("File" / "Uploading…" / the error).
 */
import { cn } from '@/lib/utils';

export type AttachmentStatus = 'ready' | 'uploading' | 'error';

export interface AttachmentCardProps {
  filename: string;
  /** Themed file glyph. Defaults to the standard file icon. */
  fileIcon?: string;
  status?: AttachmentStatus;
  /** Shown as the subtitle when status is 'error'. */
  errorMessage?: string;
  /** Renders the × button when provided (the composer tray; not the bubble). */
  onRemove?: () => void;
}

export function AttachmentCard({
  filename,
  fileIcon = 'icon_-Tb_file',
  status = 'ready',
  errorMessage,
  onRemove,
}: AttachmentCardProps) {
  const isError = status === 'error';
  const subtitle = isError
    ? (errorMessage ?? 'Upload failed')
    : status === 'uploading'
      ? 'Uploading…'
      : 'File';

  return (
    <div
      className={cn(
        // White card, 1px border, 0.5rem radius, capped at 18rem.
        'flex max-w-[18rem] items-center rounded-lg border',
        isError ? 'border-destructive/40 bg-destructive/5' : 'border-input bg-background',
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5 py-2 pl-2 pr-3">
        {/* Icon BOX — a 2.25rem cream+gold rounded square around the glyph
            (red-tinted on error). This tile is the card's signature; the
            platform never shows a bare glyph. */}
        <span
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-md border',
            isError
              ? 'border-destructive/40 bg-destructive/10 text-destructive'
              : 'border-primary-300 bg-primary-50 text-primary-500',
          )}
        >
          {status === 'uploading' ? (
            <span
              className="size-[1.125rem] animate-spin rounded-full border-2 border-primary-200 border-t-primary"
              aria-label="Uploading"
            />
          ) : (
            <i
              className={cn(
                'icon text-[1.125rem]',
                isError ? 'icon_-Tb_alert_circle' : fileIcon,
              )}
              aria-hidden="true"
            />
          )}
        </span>

        <span className="flex min-w-0 flex-col gap-0.5">
          <span
            className="truncate text-sm font-semibold leading-5 text-foreground"
            title={filename}
          >
            {filename}
          </span>
          <span
            className={cn(
              'truncate text-xs leading-4',
              isError ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {subtitle}
          </span>
        </span>
      </div>

      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${filename}`}
          onClick={onRemove}
          className="mr-1.5 shrink-0 p-1 text-muted-foreground hover:text-foreground"
        >
          <i className="icon icon_-Tb_x text-[0.875rem]" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
