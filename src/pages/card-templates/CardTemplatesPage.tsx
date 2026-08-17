/**
 * Card templates — the design library, and the studio that fills it.
 *
 * Two views on one page: a gallery of every saved template, and the studio
 * behind "New template". They are not separate routes because the studio is
 * the gallery's only action and carries unsaved canvas state — a route change
 * would drop a half-finished design on a browser Back.
 *
 * Why this can exist without an order: `card_template` is a COPY with no link
 * to an order, a client or a `card_spec`, and `CardDesigner` takes only design
 * props — artwork, shape, colour, finish, furniture. Nothing in either needed
 * loosening; the studio simply had no door of its own until now.
 *
 * A template carries artwork AND build parameters. Six of the seven seeded
 * templates do; the one saved through the in-order button carries only two
 * colours, because that path copies whatever the card's spec happened to hold.
 * A template with no spec applies nothing when picked, so the parameters are
 * part of the form here rather than an afterthought.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { useSavedQueryList } from '@/hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorBox } from '@/components/fields';
import { PAGE_CONTAINER } from '@/pages/page-shell';
import { saveCardTemplate } from '@/pages/orders/order-api';
import { CardDesigner, type CardDesignerHandle, type CardFace } from '@/pages/orders/CardDesigner';
import { CardStudioToolbar, CardStudioTools } from '@/pages/orders/CardStudioToolbar';
import {
  byNewest,
  categoriesOf,
  draftFromSpec,
  matchesTemplate,
  specCount,
  specFromDraft,
  templateGroups,
  validateTemplate,
  type SpecDraft,
  type TemplateRow,
} from './template-helpers';

const ALL = '__ALL__';

export function CardTemplatesPage() {
  const templates = useSavedQueryList('card_templates');
  const rows = useMemo(() => (templates.data ?? []) as TemplateRow[], [templates.data]);

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(ALL);
  /**
   * What the studio is working on: nothing, a blank card, or a stored template.
   *
   * One piece of state rather than an `editing` flag beside `designing` — two
   * booleans can both be true, and the studio would then have to decide which
   * it meant.
   */
  const [editing, setEditing] = useState<{ row: TemplateRow | null } | null>(null);

  const visible = useMemo(
    () =>
      byNewest(rows).filter(
        (r) =>
          matchesTemplate(r, query) &&
          (category === ALL || (r.category ?? '').trim() === category),
      ),
    [rows, query, category],
  );
  const categories = useMemo(() => categoriesOf(rows), [rows]);

  const handleSaved = useCallback(() => {
    setEditing(null);
    templates.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (editing) {
    return (
      <TemplateStudio
        // Remount per template, so opening a second one after a first reloads
        // the board rather than keeping the previous design on the canvas.
        key={editing.row?.id ?? 'new'}
        source={editing.row}
        existing={rows}
        onCancel={() => setEditing(null)}
        onSaved={handleSaved}
      />
    );
  }

  return (
    <div className={PAGE_CONTAINER} data-testid="card-templates-page">
      <h1 className="text-[28px] font-extrabold tracking-[-0.02em] text-foreground">
        Card templates
      </h1>
      <p className="mb-5 mt-1 text-[15px] text-muted-foreground">
        Reusable designs, with their build parameters. A template belongs to no client and no
        order — picking one on an order copies it, so editing the card afterwards leaves the
        template alone.
      </p>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="template-search">Search</Label>
          <Input
            id="template-search"
            name="templateSearch"
            data-testid="template-search"
            className="w-[16rem]"
            placeholder="Name, category or description"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {categories.length > 0 ? (
          <SegmentedControl
            aria-label="Filter by category"
            value={category}
            onValueChange={setCategory}
            options={[{ label: 'All', value: ALL }, ...categories.map((c) => ({ label: c, value: c }))]}
          />
        ) : null}
        <Button data-testid="new-template" onClick={() => setEditing({ row: null })}>
          <i className="icon icon_-Tb_circle_plus" aria-hidden="true" />
          New template
        </Button>
        <span className="ml-auto text-[13px] text-muted-foreground" data-testid="template-count">
          {visible.length} of {rows.length}
        </span>
      </div>

      {templates.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[13rem] rounded-xl" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-[13.5px] text-muted-foreground">
          {rows.length === 0
            ? 'No templates yet. Design one and save it here.'
            : 'No templates match.'}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {visible.map((t) => (
            <TemplateTile key={t.id} row={t} onOpen={() => setEditing({ row: t })} />
          ))}
        </div>
      )}
    </div>
  );
}

/** One template in the gallery. Opens into the studio to be revised. */
function TemplateTile({ row, onOpen }: { row: TemplateRow; onOpen: () => void }) {
  const art = row.thumbnail?.dataUrl;
  const params = row.spec ? Object.keys(row.spec).length : 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Edit ${row.name ?? 'template'}`}
      className="flex flex-col overflow-hidden rounded-xl border border-border bg-card text-left transition-colors hover:border-primary-300 hover:bg-primary-50/30"
      data-testid={`template-${row.name}`}
    >
      {art ? (
        <img src={art} alt="" className="aspect-[1.586] w-full object-cover" />
      ) : (
        <div className="grid aspect-[1.586] w-full place-items-center bg-muted">
          <i
            className="icon icon_-Tb_credit_card text-[1.25rem] text-muted-foreground/50"
            aria-hidden="true"
          />
        </div>
      )}
      <div className="flex flex-1 flex-col gap-1 p-3">
        <span className="text-[13.5px] font-bold text-foreground">{row.name ?? 'Untitled'}</span>
        {row.category ? (
          <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
            {row.category}
          </span>
        ) : null}
        {row.description ? (
          <span className="line-clamp-2 text-[12px] text-muted-foreground">{row.description}</span>
        ) : null}
        <span
          className={`mt-auto pt-1 text-[11.5px] ${
            params === 0 ? 'text-warning-700' : 'text-muted-foreground'
          }`}
          data-testid={`template-params-${row.name}`}
        >
          {/* A template with no parameters applies no build spec when picked —
              worth saying on the tile rather than discovering it on an order. */}
          {params === 0 ? 'Artwork only — no build parameters' : `${params} parameters`}
        </span>
      </div>
    </button>
  );
}

/** The studio: canvas on the left, build parameters on the right. */
function TemplateStudio({
  source,
  existing,
  onCancel,
  onSaved,
}: {
  /** The template being revised, or null when designing a new one. */
  source: TemplateRow | null;
  existing: TemplateRow[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const designer = useRef<CardDesignerHandle | null>(null);
  const [face, setFace] = useState<CardFace>('front');
  const [draft, setDraft] = useState<SpecDraft>(() => draftFromSpec(source?.spec ?? null));

  /**
   * Each face's artwork, kept here rather than on the canvas.
   *
   * `CardDesigner` holds one board at a time, so switching face unmounts the
   * one being edited. Without capturing it first, designing a back and
   * flipping to the front would silently discard the back.
   */
  const [art, setArt] = useState<{ front: unknown; back: unknown }>({
    front: source?.artwork_front ?? null,
    back: source?.artwork_back ?? null,
  });

  /** Board state the toolbar reflects — undo/redo availability and zoom. */
  const [board, setBoard] = useState({ canUndo: false, canRedo: false, zoom: 1 });
  const [hasSelection, setHasSelection] = useState(false);
  const [preview, setPreview] = useState(false);

  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(source?.name ?? '');
  const [description, setDescription] = useState(source?.description ?? '');
  const [category, setCategory] = useState(source?.category ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  /**
   * Revise in place, or branch off a copy.
   *
   * Defaults to revising when a template was opened — that is what "edit"
   * means. Saving a copy is the same write with no `templateId`, so the fork
   * is one boolean rather than two code paths.
   */
  const [asCopy, setAsCopy] = useState(false);
  const revising = Boolean(source) && !asCopy;

  const counts = useMemo(() => specCount(draft), [draft]);
  const groups = useMemo(() => templateGroups(), []);
  const spec = useMemo(() => specFromDraft(draft), [draft]);

  const handleRef = useCallback((h: CardDesignerHandle | null) => {
    designer.current = h;
  }, []);

  /** Capture the mounted board before it unmounts, then switch. */
  function changeFace(next: CardFace) {
    const captured = designer.current?.toJSON() ?? null;
    setArt((prev) => ({ ...prev, [face]: captured }));
    setFace(next);
    // Guides come back on a face switch; preview is per-view.
    setPreview(false);
  }

  function setParam(key: string, value: string) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    // Revising keeps its own name, so the template must not clash with itself.
    const others = revising ? existing.filter((t) => t.id !== source?.id) : existing;
    const problems = validateTemplate(name, others);
    if (problems.length > 0) {
      setProblem(problems[0].message);
      return;
    }
    setProblem(null);
    setSaving(true);
    try {
      // The mounted face is live on the canvas; the other is whatever was
      // captured when it was last left.
      const board = designer.current?.toJSON() ?? null;
      const front = face === 'front' ? board : art.front;
      const back = face === 'back' ? board : art.back;
      await saveCardTemplate({
        name: name.trim(),
        description: description.trim() || null,
        category: category.trim() || null,
        // The tile is the FRONT. On a revision keep the stored thumbnail when
        // the back is the mounted face, rather than blanking the tile.
        thumbnail:
          face === 'front'
            ? (designer.current?.toPreviewDataUrl() ?? null)
            : (source?.thumbnail?.dataUrl ?? null),
        artworkFront: front,
        artworkBack: back,
        spec,
        templateId: revising ? (source?.id ?? null) : null,
      });
      setOpen(false);
      onSaved();
    } catch (e) {
      setProblem(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={PAGE_CONTAINER} data-testid="template-studio">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          data-testid="back-to-templates"
          onClick={onCancel}
          className="flex items-center gap-1.5 text-[12.5px] font-semibold text-muted-foreground hover:text-foreground"
        >
          <i className="icon icon_-Tb_arrow_left text-[1.125rem]" aria-hidden="true" />
          Card templates
        </button>
        <span className="h-4 w-px bg-border" aria-hidden="true" />
        <h1 className="text-[18px] font-bold text-foreground">
          {source ? (source.name ?? 'Template') : 'New template'}
        </h1>
        {source ? (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold uppercase text-muted-foreground">
            Editing
          </span>
        ) : null}
        <Button className="ml-auto" data-testid="open-save-template" onClick={() => setOpen(true)}>
          <i className="icon icon_-Tb_bookmark" aria-hidden="true" />
          {source ? 'Save' : 'Save as template'}
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
          {/* The same chrome the order studio uses. `faces` omits the carrier:
              `card_template` has no carrier column, so a carrier designed here
              would be discarded on save without saying so. */}
          <CardStudioToolbar
            designer={designer}
            canUndo={board.canUndo}
            canRedo={board.canRedo}
            zoom={board.zoom}
            face={face}
            faces={['front', 'back']}
            onFaceChange={changeFace}
            preview={preview}
            onPreviewChange={setPreview}
          />
          <CardStudioTools
            designer={designer}
            hasSelection={hasSelection}
            face={face}
          />

          <CardDesigner
            // Remount per face so the board reloads that face's artwork rather
            // than keeping the one being left behind.
            key={face}
            artwork={face === 'front' ? art.front : art.back}
            face={face}
            shape={draft.shape || null}
            background={(face === 'front' ? draft.front_color_code : draft.back_color_code) || null}
            finish={draft.finish || null}
            magStripe={draft.mag_stripe === 'true'}
            // `sig_panel` is a choice, not a flag — 'None' must not draw one.
            sigPanel={Boolean(draft.sig_panel) && draft.sig_panel !== 'None'}
            scratchOff={draft.scratch_off === 'true'}
            cardBrand={draft.card_brand || null}
            editable
            onSelectionChange={setHasSelection}
            onStateChange={setBoard}
            handleRef={handleRef}
          />
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[13.5px] font-bold text-foreground">Build parameters</span>
            <span className="text-[11.5px] text-muted-foreground" data-testid="spec-count">
              {counts.set} of {counts.total} set
            </span>
          </div>
          <p className="text-[11.5px] text-muted-foreground">
            What a supplier prices and builds from. Issuer identifiers — BIN, ICA — are
            deliberately absent: a template is shared across clients.
          </p>

          {groups.map((g) => (
            <div key={g.name} className="flex flex-col gap-2">
              <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                {g.name}
              </span>
              {g.params.map((p) => {
                const id = `param-${p.key}`;
                const value = draft[p.key] ?? '';
                return (
                  <div key={p.key} className="flex items-center gap-2">
                    <Label htmlFor={id} className="flex-1 text-[12.5px] font-normal">
                      {p.label}
                      {p.unit ? (
                        <span className="ml-1 text-muted-foreground">({p.unit})</span>
                      ) : null}
                    </Label>
                    {p.kind === 'select' ? (
                      <select
                        id={id}
                        name={p.key}
                        data-testid={id}
                        className="h-8 w-[9.5rem] rounded-md border border-border bg-card px-2 text-[12.5px]"
                        value={value}
                        onChange={(e) => setParam(p.key, e.target.value)}
                      >
                        <option value="">Not set</option>
                        {(p.options ?? []).map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    ) : p.kind === 'boolean' ? (
                      <select
                        id={id}
                        name={p.key}
                        data-testid={id}
                        className="h-8 w-[9.5rem] rounded-md border border-border bg-card px-2 text-[12.5px]"
                        value={value}
                        onChange={(e) => setParam(p.key, e.target.value)}
                      >
                        <option value="">Not set</option>
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                      </select>
                    ) : p.kind === 'color' ? (
                      <input
                        id={id}
                        name={p.key}
                        type="color"
                        data-testid={id}
                        className="h-8 w-[9.5rem] cursor-pointer rounded-md border border-border bg-card px-1"
                        value={value || '#ffffff'}
                        onChange={(e) => setParam(p.key, e.target.value)}
                      />
                    ) : (
                      <Input
                        id={id}
                        name={p.key}
                        data-testid={id}
                        inputMode={p.kind === 'number' ? 'numeric' : undefined}
                        className="h-8 w-[9.5rem] text-[12.5px]"
                        value={value}
                        onChange={(e) => setParam(p.key, e.target.value)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[28rem]" data-testid="save-template-dialog">
          <DialogHeader>
            <DialogTitle>{source ? 'Save template' : 'Save as template'}</DialogTitle>
            <DialogDescription>
              {revising
                ? `Replaces “${source?.name}” with both faces and ${counts.set} build parameter${
                    counts.set === 1 ? '' : 's'
                  }. Orders that already picked it keep their own copy.`
                : `Saved with both faces and ${counts.set} build parameter${
                    counts.set === 1 ? '' : 's'
                  }. It belongs to no client, so anyone can pick it.`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-template-name">Name</Label>
              <Input
                id="new-template-name"
                name="templateName"
                data-testid="new-template-name"
                value={name}
                placeholder="Winter Table"
                aria-invalid={Boolean(problem)}
                aria-describedby={problem ? 'new-template-error' : undefined}
                onChange={(e) => setName(e.target.value)}
              />
              <ErrorBox id="new-template-error" message={problem ?? undefined} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-template-category">Category</Label>
              <Input
                id="new-template-category"
                name="templateCategory"
                data-testid="new-template-category"
                value={category}
                placeholder="seasonal"
                onChange={(e) => setCategory(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-template-desc">Description</Label>
              <Textarea
                id="new-template-desc"
                name="templateDescription"
                data-testid="new-template-desc"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            {source ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="save-mode">Save as</Label>
                <SegmentedControl
                  aria-label="Save as"
                  value={asCopy ? 'copy' : 'replace'}
                  onValueChange={(v) => setAsCopy(v === 'copy')}
                  options={[
                    { label: 'Replace this template', value: 'replace' },
                    { label: 'New template', value: 'copy' },
                  ]}
                />
                <span className="text-[11.5px] text-muted-foreground">
                  {revising
                    ? 'The existing template is revised in place.'
                    : 'A separate template — give it a name of its own.'}
                </span>
              </div>
            ) : null}
            <div className="flex items-center gap-2">
              <Button
                data-testid="confirm-save-template"
                onClick={() => void handleSave()}
                aria-busy={saving}
                disabled={saving || !name.trim()}
              >
                {saving ? 'Saving…' : revising ? 'Replace template' : 'Save template'}
              </Button>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}


export default CardTemplatesPage;
