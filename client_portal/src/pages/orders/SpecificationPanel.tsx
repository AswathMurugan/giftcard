/**
 * Specification panel — the Specs stage content.
 *
 * Rendered INLINE inside the order workspace (the spec is the stage, not a
 * separate destination). Extracted into its own component so the markup has a
 * single home rather than being duplicated between the workspace and a page.
 *
 * Every value comes from `order_card_spec`; nothing is pre-filled. See
 * `spec-helpers.ts` for why the parameter list is the 15 real `card_spec`
 * columns rather than the demo's "200 params".
 */
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSavedQueryList, useSavedQuerySingle, useDriveFiles } from '@/hooks';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { APP_BRAND } from '@/pages/_shared/brand';
import {
  TEMPLATE_SPEC_KEYS,
  addCardToOrder,
  approveCardSpec,
  generatePdfFromHtml,
  saveCard,
  saveCardTemplate,
  saveCardVariant,
  saveSpecPdfRef,
  templateSpecFrom,
} from './order-api';
import { buildSpecSheetHtml } from './spec-sheet';
import {
  CardDesigner,
  type CardDesignerHandle,
  type CardFace,
} from './CardDesigner';
import { CardStudioToolbar, CardStudioTools } from './CardStudioToolbar';
import {
  buildBom,
  buildSpecGroups,
  countSpecParams,
  type BomEntry,
  type CardSpecRow,
  type OrderCardSpecResult,
  type SpecParam,
} from './spec-helpers';

/** react-pdf/pdfjs is heavy — only pulled in when a spec sheet is opened. */
const PdfPane = lazy(() =>
  import('@/components/shared/PdfPane').then((m) => ({ default: m.PdfPane })),
);

/** One row from `card_templates` — a reusable design with no order/client link. */
interface TemplateRow {
  id?: string;
  name?: string;
  description?: string;
  category?: string;
  /** `{dataUrl}` — Json, because a PNG data URL exceeds the 255-char Text cap. */
  thumbnail?: { dataUrl?: string | null } | null;
  artwork_front?: unknown;
  artwork_back?: unknown;
  /**
   * `card_template` carries no carrier column yet, so this is undefined on
   * every stored template. Declared so that adding the column starts working
   * with no code change here — and so applying a template today PRESERVES the
   * card's carrier rather than blanking a design the template never held.
   */
  artwork_carrier?: unknown;
  /** Build parameters keyed by card_spec column name. Never issuer identifiers. */
  spec?: Record<string, unknown> | null;
  created_at?: string;
}

/** Template tiles. Shared by Load-from-template and the Add-variation fork. */
function TemplateGrid({
  rows,
  loading,
  onPick,
}: {
  rows: TemplateRow[];
  loading: boolean;
  onPick: (row: TemplateRow) => void;
}) {
  if (loading) {
    return (
      <div className="grid gap-3 sm:grid-cols-3">
        <Skeleton className="h-32 rounded-lg" />
        <Skeleton className="h-32 rounded-lg" />
        <Skeleton className="h-32 rounded-lg" />
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-[13.5px] text-muted-foreground">
        No templates saved yet. Design a card, save it, then use{' '}
        <span className="font-semibold text-foreground">Save as template</span>.
      </p>
    );
  }
  return (
    <div className="grid max-h-[26rem] gap-3 overflow-y-auto sm:grid-cols-3">
      {rows.map((row) => (
        <button
          key={row.id}
          type="button"
          data-testid={`template-${row.name ?? row.id}`}
          onClick={() => onPick(row)}
          className="flex flex-col gap-2 rounded-lg border border-border bg-card p-2 text-left transition-colors hover:border-primary-300 hover:bg-primary-50"
        >
          {row.thumbnail?.dataUrl ? (
            <img
              src={row.thumbnail.dataUrl}
              alt=""
              className="w-full rounded border border-border"
            />
          ) : (
            <div className="grid h-20 place-items-center rounded bg-muted">
              <i
                className="icon icon_-Tb_credit_card text-[1.25rem] text-muted-foreground/50"
                aria-hidden="true"
              />
            </div>
          )}
          <span className="text-[13px] font-semibold text-foreground">
            {row.name ?? 'Untitled'}
          </span>
          {row.category ? (
            <span className="text-[11.5px] uppercase tracking-[0.06em] text-muted-foreground">
              {row.category}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

const ROLE_LABEL: Record<string, string> = {
  card: 'Card',
  carrier: 'Carrier',
};

function NotSet() {
  return <span className="text-muted-foreground/60">Not set</span>;
}

/** One editable spec parameter. Control type comes from the param model. */
function ParamEditor({
  param,
  value,
  onChange,
}: {
  param: SpecParam;
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  const kind = param.spec.kind ?? 'text';
  const common = 'h-7 rounded-md border border-border bg-card px-1.5 text-[12.5px]';

  if (kind === 'boolean') {
    return (
      <input
        type="checkbox"
        className="size-4 accent-primary-600"
        checked={Boolean(value)}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={param.label}
      />
    );
  }
  if (kind === 'color') {
    return (
      <input
        type="color"
        className="h-7 w-10 cursor-pointer rounded-md border border-border bg-card"
        value={typeof value === 'string' && value ? value : '#FFFFFF'}
        onChange={(e) => onChange(e.target.value)}
        aria-label={param.label}
      />
    );
  }
  if (kind === 'select') {
    return (
      <select
        className={`${common} w-[112px]`}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value || null)}
        aria-label={param.label}
      >
        <option value="">Not set</option>
        {(param.spec.options ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      type={kind === 'number' ? 'number' : 'text'}
      className={`${common} w-[112px]`}
      value={value === null || value === undefined ? '' : String(value)}
      placeholder="Not set"
      onChange={(e) => {
        const v = e.target.value;
        onChange(v === '' ? null : kind === 'number' ? Number(v) : v);
      }}
      aria-label={param.label}
    />
  );
}


/** Front/back design board for the selected card. */
function CardStudio({
  entry,
  face,
  onDirty,
  onSelectionChange,
  onStateChange,
  handleRef,
  pendingArtwork,
  toolbar,
}: {
  entry: BomEntry | null;
  face: CardFace;
  onDirty: () => void;
  onSelectionChange: (has: boolean) => void;
  onStateChange: (s: { canUndo: boolean; canRedo: boolean; zoom: number }) => void;
  handleRef: (h: CardDesignerHandle | null) => void;
  /** Unsaved artwork staged by a template apply — shown in preference to the
   *  stored faces so the operator sees the template before committing to it. */
  pendingArtwork?: {
    front: unknown;
    back: unknown;
    carrier: unknown;
    nonce: number;
  } | null;
  toolbar: React.ReactNode;
}) {
  const spec = entry?.spec ?? null;
  const stored =
    face === 'front'
      ? spec?.artwork_front
      : face === 'back'
        ? spec?.artwork_back
        : spec?.artwork_carrier;
  const staged =
    face === 'front'
      ? pendingArtwork?.front
      : face === 'back'
        ? pendingArtwork?.back
        : pendingArtwork?.carrier;
  const artwork = pendingArtwork ? staged : stored;

  return (
    <div className="flex flex-col gap-3">
      {toolbar}
      <CardDesigner
        // The nonce remounts the board when a template is applied, so the same
        // template applied twice still reloads rather than sitting stale.
        key={`${entry?.lineId ?? 'none'}-${face}-${pendingArtwork?.nonce ?? 0}`}
        artwork={artwork}
        face={face}
        // The board follows the card type on the spec, so changing `shape`
        // resizes the trim, bleed, safe area and both rulers.
        // A carrier is not a card format, so it overrides `shape` outright.
        shape={face === 'carrier' ? 'CARRIER' : (spec?.shape ?? null)}
        // Each face shows its OWN colour — the back was previously painted
        // with the front's colour, so back_color_code never reflected.
        background={
          (face === 'front'
            ? spec?.front_color_code
            : face === 'back'
              ? spec?.back_color_code
              : spec?.carrier_color_code) ?? null
        }
        finish={spec?.finish ?? null}
        magStripe={Boolean(spec?.mag_stripe)}
        // `sig_panel` is a choice, not a flag: 'None' must NOT draw a panel.
        // Boolean('None') is true, so the value has to be compared.
        sigPanel={Boolean(spec?.sig_panel) && spec?.sig_panel !== 'None'}
        scratchOff={Boolean(spec?.scratch_off)}
        cardBrand={spec?.card_brand ?? null}
        editable={Boolean(spec?.id)}
        onDirty={onDirty}
        onSelectionChange={onSelectionChange}
        onStateChange={onStateChange}
        handleRef={handleRef}
      />
    </div>
  );
}


export function SpecificationPanel({
  orderId,
  orderNo,
  buyerPartyId,
  headerSlot,
}: {
  orderId: string;
  /** `order.order_code` — cited on the supplier spec sheet. */
  orderNo?: string | null;
  /** Owner for any card created here (`item.owner_party_id`). */
  buyerPartyId?: string | null;
  /**
   * Node in the stage panel's header to portal card-level actions into.
   * Save-as-template sits beside Send for quotes there, but it needs this
   * component's selected card and dialog state — portalling keeps the state
   * here rather than lifting it into the stage frame.
   */
  headerSlot?: HTMLElement | null;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  // Save-as-template form + the picker.
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateDesc, setTemplateDesc] = useState('');
  const [templateCategory, setTemplateCategory] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  /**
   * Artwork staged by a template apply, before Save.
   *
   * Both faces at once, because a template replaces the whole card — the user
   * may only ever look at the front, but the back has to travel with it or the
   * saved card would be half one design and half another. `nonce` bumps the
   * board's key so the same template applied twice still remounts.
   */
  const [pendingArtwork, setPendingArtwork] = useState<{
    front: unknown;
    back: unknown;
    carrier: unknown;
    nonce: number;
  } | null>(null);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const drive = useDriveFiles();

  // Object URLs are not garbage-collected — the blob stays resident until it
  // is explicitly revoked, so the PDF's bytes would be pinned for the life of
  // the page every time the dialog is opened.
  useEffect(
    () => () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    },
    [pdfUrl],
  );
  const [artworkDirty, setArtworkDirty] = useState(false);
  const [face, setFace] = useState<CardFace>('front');
  const [hasSelection, setHasSelection] = useState(false);
  const [preview, setPreview] = useState(false);
  const [boardState, setBoardState] = useState({ canUndo: false, canRedo: false, zoom: 1 });
  const designerRef = useRef<CardDesignerHandle | null>(null);
  const [activeLineId, setActiveLineId] = useState<string | null>(null);
  const [changedOnly, setChangedOnly] = useState(false);

  const cardSpec = useSavedQuerySingle('order_card_spec', {
    input: { orderId },
    enabled: Boolean(orderId),
  });
  const result = (cardSpec.data ?? null) as OrderCardSpecResult | null;

  const variants = useSavedQueryList('order_card_variants', {
    input: { orderId },
    enabled: Boolean(orderId),
  });
  // Templates are tenant-wide and carry no order/client link, so this is
  // deliberately unfiltered — that is what makes one reusable anywhere.
  const templates = useSavedQueryList('card_templates');
  const templateRows = (templates.data ?? []) as TemplateRow[];
  const variantRows = (variants.data ?? []) as Array<{
    id?: string;
    label?: string;
    qty?: number;
    approved?: boolean;
    due_date?: string;
    /** Only the fields this variation overrides on the base spec. */
    delta?: Record<string, unknown> | null;
  }>;

  const bom = useMemo(() => buildBom(result), [result]);
  const rawActive = bom.find((b) => b.lineId === activeLineId) ?? bom[0] ?? null;

  /**
   * Unsaved parameter edits, keyed by column name.
   *
   * They are merged OVER the stored spec so the board reacts immediately —
   * changing Shape resizes the card, Front colour repaints it, Mag stripe and
   * Signature panel add their guides — before anything is persisted.
   */
  /** Which variation is being designed. Null = the base card itself. */
  const [activeVariantId, setActiveVariantId] = useState<string | null>(null);
  const [addingVariant, setAddingVariant] = useState(false);
  /** The component being added, or null. Card is excluded — that is the card
   *  itself, added as a variation, not as a component of one. */
  /**
   * Where the Add-variation dialog is: the blank/template fork, the template
   * grid, or the name+quantity form. `variantTemplate` is what the new card
   * gets built from — null means start blank.
   */
  const [variantStep, setVariantStep] = useState<'choose' | 'pick' | 'details'>('choose');
  const [variantTemplate, setVariantTemplate] = useState<TemplateRow | null>(null);
  const [variantLabel, setVariantLabel] = useState('');
  const [variantQty, setVariantQty] = useState('');

  const [specDraft, setSpecDraft] = useState<Record<string, unknown>>({});
  const specDirty = Object.keys(specDraft).length > 0;

  /**
   * The columns the last successful save actually wrote, and the spec they
   * were written to.
   *
   * `card_spec_save` REPLACES every column it names, so `handleSave` has to
   * send all fifteen parameters on every save — including the fourteen the
   * user didn't touch. It reads those from the cached spec row, which means
   * any staleness in that cache is written back to the table as a silent
   * revert of columns nobody edited. Remembering what we just wrote and
   * layering it over the cached row closes that window: the next save starts
   * from the values that are really in the table, not from whatever the cache
   * happens to be holding.
   */
  const [written, setWritten] = useState<{
    specId: string;
    fields: Record<string, unknown>;
  } | null>(null);

  const activeVariant = variantRows.find((v) => v.id === activeVariantId) ?? null;

  /**
   * What the board and the parameter list show.
   *
   * Layered: the base card spec, then the selected variation's DELTA (only the
   * fields it overrides), then any unsaved edits. Selecting a variation
   * therefore shows that card's own style, while fields it doesn't override
   * keep following the base.
   */
  const active = useMemo(() => {
    if (!rawActive) return null;
    const variantDelta = (activeVariant?.delta ?? {}) as Record<string, unknown>;
    // Only trust the write-back for the spec it was written to.
    const justWritten =
      written && written.specId === rawActive.spec?.id ? written.fields : null;
    if (!specDirty && !activeVariant && !justWritten) return rawActive;
    return {
      ...rawActive,
      spec: {
        ...(rawActive.spec ?? {}),
        ...justWritten,
        ...variantDelta,
        ...specDraft,
      } as CardSpecRow,
    };
  }, [rawActive, specDraft, specDirty, activeVariant, written]);

  const groups = useMemo(() => buildSpecGroups(active?.spec ?? null), [active]);
  const counts = countSpecParams(groups);
  const editable = Boolean(rawActive?.spec?.id);

  /**
   * Switch what the studio is designing.
   *
   * Unsaved parameter edits, the selected variation, the dirty flag and the
   * face all belong to ONE card — carrying them across made a freshly added
   * card open showing the previous card's data.
   */
  function selectCard(lineId: string | null, variantId: string | null = null) {
    setActiveLineId(lineId);
    setActiveVariantId(variantId);
    setSpecDraft({});
    setArtworkDirty(false);
    setPreview(false);
    setFace('front');
    // Staged template artwork belongs to the card it was applied to; carrying
    // it across would paint the next card with the previous card's template.
    setPendingArtwork(null);
  }

  /**
   * The one control for putting another card style on this order.
   *
   * Every style is a REAL card: its own order line, its own item revision and
   * its own complete card_spec. There is deliberately no second "add" path —
   * a style added here is quantified and specified independently, so nothing
   * it needs is inherited from a sibling and no style is a second-class copy
   * of another.
   *
   * `card_variant` rows already on an order still render in the strip and can
   * still be designed; they are simply no longer how a new style is created.
   */
  function resetVariantForm() {
    setAddingVariant(false);
    setVariantLabel('');
    setVariantQty('');
    setVariantTemplate(null);
    setVariantStep('choose');
  }

  async function handleAddVariant() {
    if (!buyerPartyId) {
      setNote('This order has no buyer, so a card owner cannot be set.');
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const created = await addCardToOrder({
        orderId,
        name: variantLabel.trim() || 'New variation',
        qty: Number(variantQty) || 0,
        ownerPartyId: buyerPartyId,
      });

      // Started from a template → write its design straight onto the new card
      // rather than staging it. Staging is there so an operator can back out
      // of changing an EXISTING design; on a card created from a template
      // there is nothing to back out to, and leaving it unsaved would mean a
      // brand-new card that looks designed but is empty in the table.
      if (variantTemplate) {
        const incoming = templateSpecFrom(
          variantTemplate.spec as Record<string, unknown> | null,
        );
        const fields: Record<string, unknown> = {};
        for (const group of groups) {
          for (const param of group.params) {
            fields[param.spec.saveAs] = incoming[param.key] ?? null;
          }
        }
        await saveCard({
          cardSpecId: created.cardSpecId,
          fields,
          artworkFront: variantTemplate.artwork_front ?? null,
          artworkBack: variantTemplate.artwork_back ?? null,
          // The template's own tile is a faithful render of its front, so it
          // seeds the card's preview without mounting a board to re-render.
          previewFront: variantTemplate.thumbnail?.dataUrl ?? null,
          previewBack: null,
        });
      }

      // Open what was just added — otherwise the panel stays on whichever
      // card was selected before, which reads as "it loaded the previous
      // card's data".
      selectCard(created.orderLineId);
      resetVariantForm();
      await cardSpec.refetch();
      setNote(
        variantTemplate
          ? `Variation added from “${variantTemplate.name ?? 'template'}”.`
          : 'Variation added.',
      );
    } catch (e) {
      setNote(`Could not add: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  /**
   * One save. Where it writes depends on what is selected:
   *   · a VARIATION  → its own `delta` (only the fields it overrides)
   *   · the BASE card → the card_spec columns + artwork
   * That's what lets several card styles coexist on one order while shared
   * fields still live in exactly one place.
   */
  async function handleSave() {
    const specId = rawActive?.spec?.id;
    const designer = designerRef.current;
    if (!specId) return;
    setBusy(true);
    setNote(null);
    try {
      if (activeVariant?.id) {
        // The variation's artwork lives in its delta too. `card_variant` has no
        // artwork column, but `delta` is "fields that differ from the base
        // card" and artwork_front/back ARE card_spec fields — so a variation
        // can carry its own design with no schema change, and the layered spec
        // picks it up automatically.
        const boardJson = designer?.toJSON();
        const delta: Record<string, unknown> = {
          ...((activeVariant.delta ?? {}) as Record<string, unknown>),
          ...specDraft,
        };
        if (artworkDirty && boardJson) {
          delta[
            face === 'front'
              ? 'artwork_front'
              : face === 'back'
                ? 'artwork_back'
                : 'artwork_carrier'
          ] = boardJson;
        }
        await saveCardVariant({
          variantId: activeVariant.id,
          label: activeVariant.label ?? 'Variation',
          delta,
          qty: activeVariant.qty ?? null,
          dueDate: activeVariant.due_date ?? null,
        });
        setSpecDraft({});
        setArtworkDirty(false);
        variants.refetch();
        setNote(`Saved “${activeVariant.label ?? 'variation'}”.`);
        return;
      }

      // card_spec_save replaces every column it names, so build the FULL
      // parameter set. `active.spec` is the layered value the panel is
      // actually showing — stored row, then the last write-back, then unsaved
      // edits — so what gets written is exactly what the user can see.
      const merged = (active?.spec ?? {}) as CardSpecRow;
      const fields: Record<string, unknown> = {};
      // Keyed by column name too, so the write-back can be layered back over
      // the cached row on the next render.
      const columns: Record<string, unknown> = {};
      for (const group of groups) {
        for (const param of group.params) {
          const value = merged[param.key] ?? null;
          fields[param.spec.saveAs] = value;
          columns[param.key] = value;
        }
      }

      // The edited face comes from the board; the others keep what they had.
      const boardJson = designer?.toJSON();
      const boardPreview = designer?.toPreviewDataUrl();
      const storedPreview = (rawActive?.spec?.artwork_preview ?? {}) as Record<
        string,
        string | null | undefined
      >;
      const storedArtwork: Record<CardFace, unknown> = {
        front: rawActive?.spec?.artwork_front ?? null,
        back: rawActive?.spec?.artwork_back ?? null,
        carrier: rawActive?.spec?.artwork_carrier ?? null,
      };

      /**
       * A face that isn't on the board keeps what it had — UNLESS a template
       * staged a replacement for it. A template replaces the WHOLE card, so
       * saving from the front has to carry the other faces across too;
       * otherwise the card ends up part new design and part old one.
       *
       * Written as a rule over every face rather than a front/back pair: the
       * pair form is what dropped a face's artwork the first time, and adding
       * the carrier by hand would have been the same bug a third time.
       */
      const artworkFor = (f: CardFace): unknown =>
        f === face
          ? (boardJson ?? null)
          : pendingArtwork
            ? (pendingArtwork[f] ?? null)
            : storedArtwork[f];

      // Same rule for the picture, with one difference: a template also
      // replaces the other faces' IMAGES, and those faces aren't mounted so
      // they cannot be re-rendered here. Keeping the old preview would caption
      // the new design with the previous card's image, so it is cleared and
      // regenerates when that face is opened and saved.
      const previewFor = (f: CardFace): string | null =>
        f === face ? (boardPreview ?? null) : pendingArtwork ? null : (storedPreview[f] ?? null);

      await saveCard({
        cardSpecId: specId,
        fields,
        artworkFront: artworkFor('front'),
        artworkBack: artworkFor('back'),
        artworkCarrier: artworkFor('carrier'),
        previewFront: previewFor('front'),
        previewBack: previewFor('back'),
        previewCarrier: previewFor('carrier'),
      });

      setWritten({ specId, fields: columns });
      setSpecDraft({});
      setArtworkDirty(false);
      setPendingArtwork(null);
      // Awaited: the panel stays busy until the row it is showing is the row
      // that is in the table, so a second save can't be built on stale data.
      await cardSpec.refetch();
      setNote('Card saved.');
    } catch (e) {
      setNote(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Generate the supplier spec sheet and record it against the card.
   *
   * Three steps, in order, because each depends on the last: render the saved
   * spec to HTML → POST it to the PDF service, which stores the document in
   * Drive and returns a `file_id` → write that id onto `card_spec`. Skipping
   * the third step would leave an orphaned document in Drive that the order
   * could never reach again.
   *
   * The faces come from the SAVED `artwork_preview`, not from the live board:
   * the sheet must show what the record holds, which is also why the control
   * is disabled while there are unsaved edits.
   */
  async function handleExportPdf() {
    const specId = rawActive?.spec?.id;
    if (!specId) return;
    setExporting(true);
    setNote(null);
    try {
      const preview = (rawActive?.spec?.artwork_preview ?? {}) as {
        front?: unknown;
        back?: unknown;
        carrier?: unknown;
      };
      const cardName = rawActive?.name ?? 'Card';
      const filename = `${orderNo || 'order'}-${cardName}-spec.pdf`
        .replace(/[^\w.-]+/g, '-')
        .toLowerCase();

      const html = buildSpecSheetHtml({
        appLabel: APP_BRAND,
        orderNo: orderNo || '—',
        cardName,
        qty: rawActive?.qty ?? null,
        shape: rawActive?.spec?.shape,
        groups,
        previewFront: preview.front,
        previewBack: preview.back,
        previewCarrier: preview.carrier,
        generatedAt: new Date().toLocaleString(),
      });

      const result = await generatePdfFromHtml(html, filename);
      await saveSpecPdfRef({
        cardSpecId: specId,
        pdfFileId: result.file_id,
        pdfName: result.output_filename || filename,
      });
      await cardSpec.refetch();
      setNote('Spec PDF generated.');
    } catch (e) {
      setNote(`Could not generate the PDF: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  }

  /**
   * Open the stored spec sheet.
   *
   * Drive is authenticated, so the PDF cannot be handed to the viewer as a
   * plain URL — the bytes are fetched through the Drive client and wrapped in
   * an object URL, which is what react-pdf reads. The URL is revoked when the
   * dialog closes (see the effect below); leaking one pins the whole PDF in
   * memory for the life of the page.
   */
  async function handleOpenPdf() {
    const fileId = rawActive?.spec?.artwork_pdf_file_id;
    if (typeof fileId !== 'string' || !fileId) return;
    setPdfOpen(true);
    setPdfUrl(null);
    setPdfError(null);
    try {
      const blob = await drive.download(fileId);
      setPdfUrl(URL.createObjectURL(blob));
    } catch (e) {
      setPdfError(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Save the current design as a reusable template.
   *
   * A COPY, with no link back to this order, client or card_spec — that's what
   * makes it reusable elsewhere. Editing this card afterwards leaves the
   * template alone, and applying the template to another card leaves this one
   * alone.
   *
   * Only the build spec travels. `templateSpecFrom` drops BIN, ICA and
   * pre-print BIN, so reusing a template for a different client can't carry
   * the originating issuer's numbers across.
   */
  /**
   * Freeze the selected card's design.
   *
   * Separate from both Save and from advancing the stage — see
   * `approveCardSpec`. Approving does not move the order; the order's "In
   * Design" state belongs to the Specs stage and only the workflow signal
   * moves it.
   */
  async function handleApproveDesign() {
    const revId = rawActive?.itemRevId;
    if (!revId) return;
    setBusy(true);
    setNote(null);
    try {
      await approveCardSpec(revId);
      await cardSpec.refetch();
      setNote('Design approved — the revision is frozen for quoting.');
    } catch (e) {
      setNote(`Could not approve: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveTemplate() {
    const spec = rawActive?.spec;
    if (!spec?.id) return;
    setBusy(true);
    setNote(null);
    try {
      const stored = (spec.artwork_preview ?? {}) as { front?: unknown; back?: unknown };
      const designer = designerRef.current;
      const editingFront = face === 'front';

      // The template captures what is ON SCREEN, not what was last written.
      // Loading a template, adjusting it and banking the result as a NEW
      // template is the normal way a library gets built — requiring the card
      // to be saved first would force an unwanted write to the order just to
      // record a design idea.
      const liveBoard = designer?.toJSON() ?? null;
      const livePreview = designer?.toPreviewDataUrl() ?? null;
      // The face that isn't mounted: a staged template's version if one was
      // applied, otherwise whatever the card has stored.
      const otherFront = pendingArtwork ? pendingArtwork.front : (spec.artwork_front ?? null);
      const otherBack = pendingArtwork ? pendingArtwork.back : (spec.artwork_back ?? null);

      await saveCardTemplate({
        name: templateName.trim() || rawActive?.name || 'Untitled template',
        description: templateDesc.trim() || null,
        category: templateCategory.trim() || null,
        // The front face is the picker tile — freshly rendered when the front
        // is the face being edited, otherwise the stored one.
        thumbnail: editingFront
          ? livePreview
          : typeof stored.front === 'string'
            ? stored.front
            : null,
        artworkFront: editingFront ? liveBoard : otherFront,
        artworkBack: editingFront ? otherBack : liveBoard,
        // `active.spec` is the layered value the panel is showing — stored
        // row, last write-back, variant delta, then unsaved edits.
        spec: (active?.spec ?? spec) as Record<string, unknown>,
      });
      setSavingTemplate(false);
      setTemplateName('');
      setTemplateDesc('');
      setTemplateCategory('');
      await templates.refetch();
      setNote('Saved as a template.');
    } catch (e) {
      setNote(`Could not save the template: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Apply a template to the selected card.
   *
   * Staged as an UNSAVED edit rather than written straight through: applying a
   * template is a design decision the operator should be able to look at and
   * back out of, so it lands in `specDraft` + the board and waits for Save
   * like any other change.
   *
   * Only keys the template actually carries are applied — a template with no
   * `finish` leaves the card's finish alone rather than nulling it.
   */
  function applyTemplate(row: TemplateRow) {
    const incoming = templateSpecFrom(row.spec as Record<string, unknown> | null);
    setSpecDraft((prev) => ({ ...prev, ...incoming }));
    // Both faces are staged. The board picks them up through the `artwork`
    // prop rather than an imperative load: CardDesigner already knows how to
    // seed guides and the undo baseline from that path, and the nonce in its
    // key forces the remount that re-runs it.
    setPendingArtwork({
      front: row.artwork_front ?? null,
      back: row.artwork_back ?? null,
      // Undefined on every template today — keep the card's own carrier.
      carrier: row.artwork_carrier ?? rawActive?.spec?.artwork_carrier ?? null,
      nonce: (pendingArtwork?.nonce ?? 0) + 1,
    });
    setArtworkDirty(true);
    setPickerOpen(false);
    setNote(
      `Applied “${row.name ?? 'template'}” — ${Object.keys(incoming).length} parameters and both faces. Save to keep it.`,
    );
  }

  const visibleGroups = changedOnly
    ? groups
        .map((g) => ({ ...g, params: g.params.filter((p) => p.value !== null) }))
        .filter((g) => g.params.length > 0)
    : groups;

  return (
    <div data-testid="specification-panel">
      {cardSpec.isLoading ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-12 rounded-xl" />
          <Skeleton className="h-[420px] rounded-xl" />
        </div>
      ) : bom.length === 0 ? (
        /* No lines yet — the studio still opens, with a way to start a card.
           A dead-end empty state would leave the Specs stage unusable. */
        <div className="rounded-xl border border-border bg-card px-5 py-8">
          <div className="mx-auto flex max-w-[420px] flex-col items-center gap-3 text-center">
            <i
              className="icon icon_-Tb_credit_card text-[26px] text-muted-foreground/50"
              aria-hidden="true"
            />
            <p className="text-[15px] font-semibold text-foreground">No cards on this order yet</p>
            <p className="text-[13.5px] text-muted-foreground">
              Add the first style to open the studio. It creates the item, revision 1 and an
              empty spec, then adds the order line.
            </p>

            {/* Same control and same dialog as the card strip — the empty
                state is just where it lives when there is nothing to strip. */}
            <Button
              data-testid="add-variation-empty"
              onClick={() => {
                setVariantStep('choose');
                setAddingVariant(true);
              }}
              disabled={!buyerPartyId}
            >
              <i className="icon icon_-Tb_circle_plus" aria-hidden="true" />
              Add variation
            </Button>

            {!buyerPartyId ? (
              <p className="text-[12.5px] text-warning-700">
                This order has no buyer, so a card owner cannot be set.
              </p>
            ) : null}
            {note ? <p className="text-[12.5px] text-muted-foreground">{note}</p> : null}
          </div>
        </div>
      ) : (
        <>
          {/* ── Variation strip: one tab per real order line ────────── */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
              Lines
            </span>
            {bom.map((entry) => {
              const isActive = entry.lineId === active?.lineId;
              return (
                <button
                  key={entry.lineId}
                  type="button"
                  // Back to this card's own base style, with nothing carried over.
                  onClick={() => selectCard(entry.lineId)}
                  className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                    isActive && !activeVariantId
                      ? 'border-primary-500 bg-primary-50'
                      : 'border-border bg-card hover:bg-muted'
                  }`}
                >
                  <span className="block text-[13px] font-bold text-foreground">
                    {entry.name}
                  </span>
                  <span className="block text-[11.5px] text-muted-foreground">
                    {entry.qty !== null ? entry.qty.toLocaleString() : '—'}
                    {entry.role ? ` · ${ROLE_LABEL[entry.role] ?? entry.role}` : ''}
                  </span>
                </button>
              );
            })}

            {/* Variations of the selected card. A variation stores only its
                DELTA from the base, so shared fields stay in one place. */}
            {variantRows.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => selectCard(active?.lineId ?? null, v.id ?? null)}
                className={`rounded-lg border border-dashed px-3 py-2 text-left transition-colors ${
                  v.id === activeVariantId
                    ? 'border-primary-500 bg-primary-50'
                    : 'border-border bg-card hover:bg-muted'
                }`}
              >
                <span className="flex items-center gap-1.5 text-[13px] font-bold text-foreground">
                  {v.label ?? 'Variation'}
                  {v.approved ? (
                    <i
                      className="icon icon_-Tb_circle_check text-[13px] text-success-500"
                      aria-label="Approved"
                    />
                  ) : null}
                </span>
                <span className="block text-[11.5px] text-muted-foreground">
                  {typeof v.qty === 'number' ? v.qty.toLocaleString() : '—'}
                  {v.due_date ? ` · ${v.due_date}` : ''}
                  {v.approved ? '' : ' · draft'}
                </span>
              </button>
            ))}

            <Button
              size="sm"
              variant="outline"
              data-testid="add-variation"
              onClick={() => {
                setVariantStep('choose');
                setAddingVariant(true);
              }}
              disabled={!buyerPartyId}
            >
              <i className="icon icon_-Tb_circle_plus" aria-hidden="true" />
              Add variation
            </Button>

            {/* No per-material buttons here. A card's materials are not
                order lines: the carrier is a FACE of this spec, personalization
                is a spec parameter, and setup is a per-run charge that exists
                only in quoting. Every card is quoted for all four materials
                automatically, so a button that minted a second line for one of
                them would double-count it. */}
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
            {/* ── Live mockup ──────────────────────────────────────── */}
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="mb-4 flex items-center gap-2">
                <i className="icon icon_-Tb_cards text-[15px] text-teal-600" aria-hidden="true" />
                <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                  Live mockup
                </span>
              </div>
              <CardStudio
                entry={active}
                face={face}
                onDirty={() => setArtworkDirty(true)}
                onSelectionChange={setHasSelection}
                onStateChange={setBoardState}
                handleRef={(h) => {
                  designerRef.current = h;
                }}
                pendingArtwork={pendingArtwork}
                toolbar={
                  <CardStudioToolbar
                    designer={designerRef}
                    canUndo={boardState.canUndo}
                    canRedo={boardState.canRedo}
                    zoom={boardState.zoom}
                    face={face}
                    onFaceChange={(f) => {
                      setFace(f);
                      // Guides come back on a face switch; preview is per-view.
                      setPreview(false);
                    }}
                    onSave={handleSave}
                    saving={busy}
                    dirty={artworkDirty || specDirty}
                    preview={preview}
                    onPreviewChange={setPreview}
                    onExportPdf={handleExportPdf}
                    exporting={exporting}
                    pdfFileId={
                      typeof rawActive?.spec?.artwork_pdf_file_id === 'string'
                        ? rawActive.spec.artwork_pdf_file_id
                        : null
                    }
                    onOpenPdf={handleOpenPdf}
                    onLoadTemplate={() => setPickerOpen(true)}
                    disabled={!active?.spec?.id}
                  />
                }
              />
            </div>

            {/* ── Specification ────────────────────────────────────── */}
            <div className="rounded-xl border border-border bg-card">
              <div className="flex items-center gap-2.5 border-b border-border px-4 py-3.5">
                <i
                  className="icon icon_-Tb_adjustments_horizontal text-[17px] text-primary-600"
                  aria-hidden="true"
                />
                <div className="flex flex-col">
                  <span className="text-[13.5px] font-bold text-foreground">Specification</span>
                  <span className="text-[12px] text-muted-foreground">
                    The source of truth — preview is a partial view
                  </span>
                </div>
              </div>

              {/* Design tools live here, beside the spec, acting on the board. */}
              <div className="border-b border-border px-4 py-3">
                <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.05em] text-muted-foreground">
                  Design · {face}
                </div>
                <CardStudioTools
                  designer={designerRef}
                  hasSelection={hasSelection}
                  disabled={!active?.spec?.id}
                  face={face}
                />
              </div>

              {/* Parameter counts + filter */}
              <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
                <span className="text-[12.5px] font-bold text-foreground">
                  {counts.total} parameters
                </span>
                <span className="text-[12.5px] text-muted-foreground">
                  · {counts.set} set · {counts.unset} to set
                </span>
                <div className="ml-auto inline-flex rounded-full border border-border bg-muted p-0.5">
                  <button
                    type="button"
                    onClick={() => setChangedOnly(false)}
                    aria-pressed={!changedOnly}
                    className={`rounded-full px-2.5 py-1 text-[12px] font-bold transition-colors ${
                      !changedOnly ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground'
                    }`}
                  >
                    All
                  </button>
                  <button
                    type="button"
                    onClick={() => setChangedOnly(true)}
                    aria-pressed={changedOnly}
                    className={`rounded-full px-2.5 py-1 text-[12px] font-bold transition-colors ${
                      changedOnly ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground'
                    }`}
                  >
                    Set only
                  </button>
                </div>
              </div>

              {specDirty ? (
                <div className="border-b border-border bg-primary-50 px-4 py-2 text-[12.5px] text-foreground">
                  Unsaved changes — the preview already reflects them. Save from the
                  toolbar above the card.
                </div>
              ) : null}

              {counts.set === 0 && !changedOnly && !specDirty ? (
                <div className="border-b border-border bg-warning-50 px-4 py-2.5 text-[12.5px] text-warning-700">
                  No specification captured yet.
                </div>
              ) : null}

              {/* Grouped parameters — real card_spec columns */}
              <div className="px-4 py-2">
                {visibleGroups.length === 0 ? (
                  <p className="py-6 text-center text-[13px] text-muted-foreground">
                    No parameters carry a value yet.
                  </p>
                ) : (
                  visibleGroups.map((group) => (
                    <div key={group.name} className="border-b border-border py-3 last:border-b-0">
                      <div className="mb-2 flex items-center gap-2">
                        <span className="text-[11px] font-bold uppercase tracking-[0.05em] text-muted-foreground">
                          {group.name}
                        </span>
                        <span className="rounded-full bg-muted px-1.5 text-[10.5px] font-bold text-muted-foreground">
                          {group.params.length}
                        </span>
                      </div>
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                        {group.params.map((param) => (
                          <div key={param.key} className="flex items-center justify-between gap-3">
                            <dt className="text-[12.5px] text-muted-foreground">{param.label}</dt>
                            <dd className="text-[12.5px] font-semibold text-foreground">
                              {editable ? (
                                <ParamEditor
                                  param={param}
                                  value={param.raw}
                                  onChange={(next) =>
                                    setSpecDraft((d) => ({ ...d, [param.key]: next }))
                                  }
                                />
                              ) : (
                                (param.value ?? <NotSet />)
                              )}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {note ? (
            <p className="mt-3 text-[12.5px] text-muted-foreground">{note}</p>
          ) : null}

        </>
      )}

      {/* Card-level action, rendered into the stage panel header beside
          Send for quotes. Available with unsaved edits on purpose: it captures
          what is on screen, so a loaded template can be adjusted and banked as
          a NEW template without first writing those edits to the order. */}
      {headerSlot && rawActive?.spec?.id
        ? createPortal(
            <>
              {/* The DESIGN's own state, not the order's. A card can be saved
                  and still be `draft`; suppliers quote a revision, so leaving
                  it draft means they bid on something that can still move. */}
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase ${
                  rawActive.revStatus === 'Approved'
                    ? 'bg-success-50 text-success-500'
                    : 'bg-warning-50 text-warning-700'
                }`}
                data-testid="design-status"
              >
                {rawActive.revStatus === 'Approved' ? 'Design approved' : 'Design draft'}
              </span>
              {rawActive.revStatus !== 'Approved' ? (
                <Button
                  size="sm"
                  variant="outline"
                  data-testid="approve-design"
                  onClick={handleApproveDesign}
                  aria-busy={busy}
                  disabled={busy || artworkDirty || specDirty}
                  title={
                    artworkDirty || specDirty
                      ? 'Save the card before approving its design'
                      : 'Freeze this revision so suppliers quote a fixed design'
                  }
                >
                  <i className="icon icon_-Tb_circle_check" aria-hidden="true" />
                  Approve design
                </Button>
              ) : null}
              <Button
              size="sm"
              variant="outline"
              data-testid="save-as-template"
              disabled={busy}
              title="Save the current design for reuse on any order"
              onClick={() => {
                // Seed the name from the card so the common case is one click.
                setTemplateName(rawActive?.name ?? '');
                setSavingTemplate(true);
              }}
            >
              <i className="icon icon_-Tb_bookmark_plus" aria-hidden="true" />
                Save as template
              </Button>
            </>,
            headerSlot,
          )
        : null}


      {/* ── Save as template ─────────────────────────────────────── */}
      <Dialog open={savingTemplate} onOpenChange={setSavingTemplate}>
        <DialogContent className="sm:max-w-[30rem]" data-testid="save-template-dialog">
          <DialogHeader>
            <DialogTitle>Save as template</DialogTitle>
            <DialogDescription>
              Saves a copy of this design with no link to the order or client, so it can be
              reused on any order. BIN, ICA and pre-print BIN are not included — those
              belong to the issuer, not the card.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="template-name">Name</Label>
              <Input
                id="template-name"
                name="templateName"
                data-testid="template-name-input"
                value={templateName}
                placeholder="Holiday foil"
                onChange={(e) => setTemplateName(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="template-category">Category</Label>
              <Input
                id="template-category"
                name="templateCategory"
                data-testid="template-category-input"
                value={templateCategory}
                placeholder="seasonal"
                onChange={(e) => setTemplateCategory(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="template-desc">Description</Label>
              <Input
                id="template-desc"
                name="templateDesc"
                data-testid="template-desc-input"
                value={templateDesc}
                placeholder="Navy body, gold foil chip, matte"
                onChange={(e) => setTemplateDesc(e.target.value)}
              />
            </div>
            <p className="text-[12.5px] text-muted-foreground">
              Carries both faces and{' '}
              {Object.keys(templateSpecFrom(active?.spec as Record<string, unknown>)).length} of{' '}
              {TEMPLATE_SPEC_KEYS.length} build parameters.
              {artworkDirty || specDirty
                ? ' Your unsaved changes are included — this saves the design on screen, not the last saved one.'
                : ''}
            </p>
            {templateRows.some(
              (t) => (t.name ?? '').toLowerCase() === templateName.trim().toLowerCase(),
            ) ? (
              <p className="text-[12.5px] text-warning-700" role="status">
                A template called “{templateName.trim()}” already exists. Saving creates a
                second one — names aren&rsquo;t unique.
              </p>
            ) : null}
            <div className="flex items-center gap-2">
              <Button
                data-testid="confirm-save-template"
                onClick={handleSaveTemplate}
                aria-busy={busy}
                disabled={busy || !templateName.trim()}
              >
                {busy ? 'Saving…' : 'Save template'}
              </Button>
              <Button
                variant="outline"
                onClick={() => setSavingTemplate(false)}
                disabled={busy}
              >
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Load from template ───────────────────────────────────── */}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="sm:max-w-[46rem]" data-testid="template-picker-dialog">
          <DialogHeader>
            <DialogTitle>Load from template</DialogTitle>
            <DialogDescription>
              Applies the template&rsquo;s artwork and build parameters to this card as an
              unsaved change, so you can look at it before committing. Identifiers stay as
              they are.
            </DialogDescription>
          </DialogHeader>
          <TemplateGrid
            rows={templateRows}
            loading={templates.isLoading}
            onPick={applyTemplate}
          />
        </DialogContent>
      </Dialog>

      {/* ── Add variation: blank, or from a template ─────────────── */}
      <Dialog
        open={addingVariant}
        onOpenChange={(open) => (open ? setAddingVariant(true) : resetVariantForm())}
      >
        <DialogContent
          className={variantStep === 'pick' ? 'sm:max-w-[46rem]' : 'sm:max-w-[30rem]'}
          data-testid="add-variation-dialog"
        >
          <DialogHeader>
            <DialogTitle>
              {variantStep === 'pick' ? 'Pick a template' : 'Add a variation'}
            </DialogTitle>
            <DialogDescription>
              {variantStep === 'choose'
                ? 'Every variation is a card in its own right — its own quantity and its own complete spec.'
                : variantStep === 'pick'
                  ? 'The new card starts with this design and its build parameters.'
                  : variantTemplate
                    ? `Starting from “${variantTemplate.name ?? 'template'}”.`
                    : 'Starting from a blank card.'}
            </DialogDescription>
          </DialogHeader>

          {variantStep === 'choose' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                data-testid="variation-blank"
                onClick={() => {
                  setVariantTemplate(null);
                  setVariantStep('details');
                }}
                className="flex flex-col items-start gap-1.5 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-primary-300 hover:bg-primary-50"
              >
                <i
                  className="icon icon_-Tb_square_plus text-[1.25rem] text-primary-600"
                  aria-hidden="true"
                />
                <span className="text-[13.5px] font-bold text-foreground">Start blank</span>
                <span className="text-[12.5px] text-muted-foreground">
                  An empty card you design from scratch.
                </span>
              </button>
              <button
                type="button"
                data-testid="variation-from-template"
                onClick={() => setVariantStep('pick')}
                className="flex flex-col items-start gap-1.5 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-primary-300 hover:bg-primary-50"
              >
                <i
                  className="icon icon_-Tb_layout_grid text-[1.25rem] text-primary-600"
                  aria-hidden="true"
                />
                <span className="text-[13.5px] font-bold text-foreground">
                  Pick from template
                </span>
                <span className="text-[12.5px] text-muted-foreground">
                  {templateRows.length} saved{' '}
                  {templateRows.length === 1 ? 'design' : 'designs'}, artwork and build
                  parameters included.
                </span>
              </button>
            </div>
          ) : variantStep === 'pick' ? (
            <TemplateGrid
              rows={templateRows}
              loading={templates.isLoading}
              onPick={(row) => {
                setVariantTemplate(row);
                // Seed the name from the template — usually what it should be called.
                if (!variantLabel.trim()) setVariantLabel(row.name ?? '');
                setVariantStep('details');
              }}
            />
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="variant-label">Name</Label>
                <Input
                  id="variant-label"
                  name="variantLabel"
                  data-testid="variant-label-input"
                  placeholder="Valentines"
                  value={variantLabel}
                  onChange={(e) => setVariantLabel(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="variant-qty">Quantity</Label>
                <Input
                  id="variant-qty"
                  name="variantQty"
                  data-testid="variant-qty-input"
                  inputMode="numeric"
                  placeholder="5000"
                  value={variantQty}
                  onChange={(e) => setVariantQty(e.target.value.replace(/[^0-9]/g, ''))}
                />
              </div>
              <div className="flex items-center gap-2">
                <Button
                  data-testid="confirm-add-variation"
                  onClick={handleAddVariant}
                  aria-busy={busy}
                  disabled={busy || !variantLabel.trim()}
                >
                  {busy ? 'Adding…' : 'Add variation'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setVariantStep(variantTemplate ? 'pick' : 'choose')}
                  disabled={busy}
                >
                  Back
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Stored spec sheet. Mounted only while open so the PDF engine chunk
          and the object URL are both short-lived. */}
      <Dialog
        open={pdfOpen}
        onOpenChange={(open) => {
          setPdfOpen(open);
          if (!open) {
            // Revoking here as well as in the unmount effect keeps a
            // reopen from stacking a second live blob on the first.
            if (pdfUrl) URL.revokeObjectURL(pdfUrl);
            setPdfUrl(null);
            setPdfError(null);
          }
        }}
      >
        <DialogContent
          className="flex h-[85vh] flex-col sm:max-w-[56rem]"
          data-testid="spec-pdf-dialog"
        >
          <DialogHeader>
            <DialogTitle>Card specification</DialogTitle>
            <DialogDescription>
              {typeof rawActive?.spec?.artwork_pdf_name === 'string'
                ? rawActive.spec.artwork_pdf_name
                : 'The spec sheet shared with the supplier.'}
            </DialogDescription>
          </DialogHeader>
          {pdfError ? (
            <p className="text-[13px] text-destructive" role="alert">
              Could not open the PDF: {pdfError}
            </p>
          ) : pdfUrl ? (
            <Suspense
              fallback={
                <div className="grid flex-1 place-items-center">
                  <Spinner />
                </div>
              }
            >
              <PdfPane
                url={pdfUrl}
                name={
                  typeof rawActive?.spec?.artwork_pdf_name === 'string'
                    ? rawActive.spec.artwork_pdf_name
                    : 'card-spec.pdf'
                }
                rootClassName="flex flex-1 min-h-0 flex-col"
              />
            </Suspense>
          ) : (
            <div className="grid flex-1 place-items-center" role="status" aria-busy="true">
              <Spinner />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default SpecificationPanel;
