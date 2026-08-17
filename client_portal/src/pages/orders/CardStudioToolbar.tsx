/**
 * The card studio's chrome — the controls around `CardDesigner`.
 *
 * Shared by the two places a card is designed: the Specification panel inside
 * an order, and the standalone template studio. The CANVAS was always one
 * component; the toolbar was not, and the copy drifted immediately — the
 * template studio shipped without zoom, preview, image upload, fill colour,
 * layer order or any back-face element, none of it deliberate. Every one of
 * those already existed on the handle.
 *
 * Order-only controls are OPTIONAL props rather than a flag. Save, spec-PDF
 * export and load-from-template have no meaning while authoring a template —
 * there is no card_spec to export and nothing to load into — so the template
 * studio simply does not pass them and the buttons do not exist. A `mode`
 * boolean would have left every consumer guessing which controls it implied.
 */
import { Button } from '@/components/ui/button';
import type { CardDesignerHandle, CardElement, CardFace } from './CardDesigner';

const ICON_BTN =
  'inline-flex size-8 items-center justify-center rounded-md text-primary-600 transition-colors hover:bg-primary-50 disabled:opacity-35 disabled:hover:bg-transparent';

/** Front elements, then back. A carrier is paper — no chip, stripe or panel. */
const ELEMENTS: Record<'front' | 'back', Array<[CardElement, string]>> = {
  front: [
    ['chip', 'Chip'],
    ['cardNumber', 'Number'],
    ['validThru', 'Valid thru'],
    ['holderName', 'Name'],
    ['brandName', 'Brand'],
  ],
  back: [
    ['magStripe', 'Mag stripe'],
    ['sigPanel', 'Signature'],
    ['cvv', 'CVV'],
  ],
};

export interface CardStudioToolbarProps {
  designer: React.RefObject<CardDesignerHandle | null>;
  canUndo: boolean;
  canRedo: boolean;
  zoom: number;
  face: CardFace;
  /** Which faces this surface stores. `card_template` has no carrier column. */
  faces?: CardFace[];
  onFaceChange: (f: CardFace) => void;
  preview: boolean;
  onPreviewChange: (on: boolean) => void;
  disabled?: boolean;

  /* ── Order-only. Omit and the control is not rendered. ─────────────── */
  onSave?: () => void;
  saving?: boolean;
  dirty?: boolean;
  onExportPdf?: () => void;
  exporting?: boolean;
  /** Set once a spec sheet has been generated — gates the open control. */
  pdfFileId?: string | null;
  onOpenPdf?: () => void;
  onLoadTemplate?: () => void;
}

export function CardStudioToolbar({
  designer,
  canUndo,
  canRedo,
  zoom,
  face,
  faces = ['front', 'back', 'carrier'],
  onFaceChange,
  preview,
  onPreviewChange,
  disabled = false,
  onSave,
  saving = false,
  dirty = false,
  onExportPdf,
  exporting = false,
  pdfFileId = null,
  onOpenPdf,
  onLoadTemplate,
}: CardStudioToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-1.5">
      <button
        type="button"
        className={ICON_BTN}
        aria-label="Undo"
        title="Undo"
        disabled={disabled || !canUndo}
        onClick={() => designer.current?.undo()}
      >
        <i className="icon icon_-Tb_arrow_back_up text-[18px]" aria-hidden="true" />
      </button>
      <button
        type="button"
        className={ICON_BTN}
        aria-label="Redo"
        title="Redo"
        disabled={disabled || !canRedo}
        onClick={() => designer.current?.redo()}
      >
        <i className="icon icon_-Tb_arrow_forward_up text-[18px]" aria-hidden="true" />
      </button>

      <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />

      <button
        type="button"
        className={ICON_BTN}
        aria-label="Zoom out"
        title="Zoom out"
        disabled={disabled}
        onClick={() => designer.current?.zoomOut()}
      >
        <i className="icon icon_-Tb_zoom_out text-[18px]" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="min-w-[52px] rounded-md px-1 text-[13px] font-bold tabular-nums text-primary-600 hover:bg-primary-50 disabled:opacity-35"
        aria-label="Reset zoom to 100%"
        title="Reset zoom"
        disabled={disabled}
        onClick={() => designer.current?.zoomReset()}
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        type="button"
        className={ICON_BTN}
        aria-label="Zoom in"
        title="Zoom in"
        disabled={disabled}
        onClick={() => designer.current?.zoomIn()}
      >
        <i className="icon icon_-Tb_zoom_in text-[18px]" aria-hidden="true" />
      </button>

      <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />

      <div className="inline-flex overflow-hidden rounded-full border border-primary-300">
        {faces.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => onFaceChange(f)}
            aria-pressed={face === f}
            data-testid={`face-${f}`}
            className={`px-4 py-1 text-[13px] font-bold capitalize transition-colors ${
              face === f ? 'bg-primary-50 text-foreground' : 'bg-card text-foreground/80'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />

      {onSave ? (
        <button
          type="button"
          className={ICON_BTN}
          aria-label={`Save ${face}`}
          title={dirty ? `Save ${face}` : 'No changes to save'}
          disabled={disabled || saving || !dirty}
          onClick={onSave}
        >
          <i className="icon icon_-Tb_device_floppy text-[18px]" aria-hidden="true" />
        </button>
      ) : null}
      <button
        type="button"
        className={`${ICON_BTN} ${preview ? 'bg-primary-50' : ''}`}
        aria-label="Preview without guides"
        aria-pressed={preview}
        title="Preview without guides"
        disabled={disabled}
        onClick={() => {
          const next = !preview;
          onPreviewChange(next);
          designer.current?.setPreview(next);
        }}
      >
        <i className="icon icon_-Tb_eye text-[18px]" aria-hidden="true" />
      </button>

      {onExportPdf || onOpenPdf ? (
        <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
      ) : null}

      {/* Generate the supplier spec sheet. Blocked while there are unsaved
          edits: the PDF is built from the SAVED spec, so exporting a dirty
          board would send the supplier a document that doesn't match the
          record it cites. */}
      {onExportPdf ? (
        <button
          type="button"
          className={ICON_BTN}
          aria-label="Export spec PDF"
          data-testid="export-spec-pdf"
          title={dirty ? 'Save before exporting the spec sheet' : 'Export spec PDF'}
          aria-busy={exporting}
          disabled={disabled || exporting || dirty}
          onClick={onExportPdf}
        >
          <i
            className={`icon ${
              exporting ? 'icon_-Tb_loader_2 animate-spin' : 'icon_-Tb_file_type_pdf'
            } text-[18px]`}
            aria-hidden="true"
          />
        </button>
      ) : null}
      {onOpenPdf ? (
        <button
          type="button"
          className={ICON_BTN}
          aria-label="Open spec PDF"
          data-testid="open-spec-pdf"
          title={pdfFileId ? 'Open spec PDF' : 'No spec sheet generated yet'}
          disabled={disabled || !pdfFileId}
          onClick={onOpenPdf}
        >
          <i className="icon icon_-Tb_external_link text-[18px]" aria-hidden="true" />
        </button>
      ) : null}

      {/* Save-as-template is NOT here — it is a card-level action and lives in
          the panel header next to Send for quotes. Load stays on the board's
          toolbar because it changes what is on the board. */}
      {onLoadTemplate ? (
        <>
          <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
          <button
            type="button"
            className={ICON_BTN}
            aria-label="Load from template"
            data-testid="load-from-template"
            title="Load from template"
            disabled={disabled}
            onClick={onLoadTemplate}
          >
            <i className="icon icon_-Tb_layout_grid text-[18px]" aria-hidden="true" />
          </button>
        </>
      ) : null}

      {dirty ? <span className="ml-1 text-[12px] text-warning-700">Unsaved</span> : null}
    </div>
  );
}

/** Drawing tools and card furniture, acting on the board. */
export function CardStudioTools({
  designer,
  hasSelection,
  disabled = false,
  face,
}: {
  designer: React.RefObject<CardDesignerHandle | null>;
  hasSelection: boolean;
  disabled?: boolean;
  face: CardFace;
}) {
  const run = (fn: (d: CardDesignerHandle) => void) => () => {
    const d = designer.current;
    if (d) fn(d);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button size="sm" variant="outline" disabled={disabled} onClick={run((d) => d.addText())}>
        <i className="icon icon_-Tb_text_plus" aria-hidden="true" />
        Text
      </Button>
      <Button size="sm" variant="outline" disabled={disabled} onClick={run((d) => d.addRect())}>
        <i className="icon icon_-Tb_square" aria-hidden="true" />
        Box
      </Button>
      <Button size="sm" variant="outline" disabled={disabled} onClick={run((d) => d.addCircle())}>
        <i className="icon icon_-Tb_circle" aria-hidden="true" />
        Circle
      </Button>
      <label
        className={`inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[13px] font-semibold ${
          disabled ? 'pointer-events-none opacity-50' : 'cursor-pointer hover:bg-muted'
        }`}
      >
        <i className="icon icon_-Tb_photo" aria-hidden="true" />
        Image
        <input
          type="file"
          accept="image/*"
          className="hidden"
          data-testid="add-image"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) designer.current?.addImage(file);
            e.target.value = '';
          }}
        />
      </label>

      <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />

      <Button
        size="sm"
        variant="outline"
        disabled={!hasSelection}
        onClick={run((d) => d.bringForward())}
        aria-label="Bring forward"
      >
        <i className="icon icon_-Tb_arrow_up" aria-hidden="true" />
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={!hasSelection}
        onClick={run((d) => d.sendBackward())}
        aria-label="Send backward"
      >
        <i className="icon icon_-Tb_arrow_down" aria-hidden="true" />
      </Button>
      <input
        type="color"
        aria-label="Fill colour"
        disabled={!hasSelection}
        className="h-8 w-9 cursor-pointer rounded-md border border-border bg-card disabled:opacity-50"
        onChange={(e) => designer.current?.setFill(e.target.value)}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={!hasSelection}
        onClick={run((d) => d.deleteSelected())}
        aria-label="Delete selected"
      >
        <i className="icon icon_-Tb_trash" aria-hidden="true" />
      </Button>

      {/* Standard card furniture, dropped at its ISO placement. Back-face
          elements are offered only on the back, and none of it applies to the
          carrier — a paper panel has no chip, stripe or signature area. */}
      <div
        className={`mt-2 w-full flex-wrap items-center gap-1.5 border-t border-border pt-2 ${
          face === 'carrier' ? 'hidden' : 'flex'
        }`}
      >
        <span className="mr-1 text-[11px] font-bold uppercase tracking-[0.05em] text-muted-foreground">
          Card
        </span>
        {(ELEMENTS[face === 'back' ? 'back' : 'front'] ?? []).map(([kind, label]) => (
          <Button
            key={kind}
            size="sm"
            variant="outline"
            disabled={disabled}
            data-testid={`add-${kind}`}
            onClick={run((d) => d.addElement(kind))}
          >
            {label}
          </Button>
        ))}
      </div>
    </div>
  );
}
