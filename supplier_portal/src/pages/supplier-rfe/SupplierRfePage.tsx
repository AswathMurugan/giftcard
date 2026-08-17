/**
 * Supplier RFE — the supplier's own surface for answering one request.
 *
 * Deliberately NOT part of the order workspace. A supplier sees the ask, the
 * spec they are quoting against, and their own quote form. They must never see
 * order stages, margins, the decision chain, or what anyone else quoted — so
 * this page reads `supplier_rfe_packet` (keyed by rfeId) rather than any of the
 * order-scoped queries, and that query carries no pricing-template data at all.
 *
 * Reached at /rfe/:rfeId, hidden from the rail: in production this is the link
 * emailed to the supplier when the RFE goes out.
 */
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useSavedQuerySingle, useDriveFiles } from '@/hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PAGE_CONTAINER } from '@/pages/page-shell';
import {
  COMPONENT_ROLES,
  componentLabel,
  recordSupplierQuote,
  type SupplierQuoteLine,
} from '@/pages/orders/order-api';
import { unitToMicros } from '@/pages/orders/quote-helpers';
import { asNumber, asText } from '@/lib/runtime';

const PdfPane = lazy(() =>
  import('@/components/shared/PdfPane').then((m) => ({ default: m.PdfPane })),
);

interface PacketTier {
  id?: string;
  tier_qty?: number;
  /** The MATERIAL this row prices — card / carrier / features / setup. */
  component_role?: string;
  rfe_line?: {
    id?: string;
    qty?: number;
    item_rev_id?: {
      rev?: number;
      item_id?: { id?: string; name?: string; component_role?: string };
    } | null;
  } | null;
}

interface PacketSpec {
  id?: string;
  shape?: string;
  substrate?: string;
  thickness_mil?: number;
  finish?: string;
  mag_stripe?: boolean;
  mag_coercivity?: string;
  mag_tracks?: string;
  sig_panel?: string;
  scratch_off?: boolean;
  card_brand?: string;
  artwork_preview?: { front?: string | null; back?: string | null } | null;
  artwork_pdf_file_id?: string | null;
  artwork_pdf_name?: string | null;
  item_rev_id?: { id?: string } | null;
}

interface Packet {
  rfe?: {
    id?: string;
    status?: string;
    respond_by?: string;
    setup_instructions?: string;
    supplier?: { id?: string; name?: string } | null;
    demand_order?: { order_code?: string; requested_delivery?: string } | null;
  } | null;
  tiers?: PacketTier[];
  specs?: PacketSpec[];
  responses?: Array<{ id?: string; round?: number; supplier_quote_no?: string; submitted_at?: string }>;
}

/** The build parameters a supplier prices against. No commercial fields. */
const SPEC_ROWS: Array<[keyof PacketSpec, string]> = [
  ['shape', 'Shape'],
  ['substrate', 'Substrate'],
  ['thickness_mil', 'Thickness (mil)'],
  ['finish', 'Finish'],
  ['mag_stripe', 'Mag stripe'],
  ['mag_coercivity', 'Coercivity'],
  ['mag_tracks', 'Tracks'],
  ['sig_panel', 'Signature panel'],
  ['scratch_off', 'Scratch-off'],
  ['card_brand', 'Card brand'],
];

function specValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}

export function SupplierRfePage() {
  const { rfeId = '' } = useParams();
  const packetQuery = useSavedQuerySingle('supplier_rfe_packet', {
    input: { rfeId },
    enabled: Boolean(rfeId),
  });
  const packet = packetQuery.data as Packet | null;

  const drive = useDriveFiles();
  const [pdfOpen, setPdfOpen] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const [costs, setCosts] = useState<Record<string, string>>({});
  /** tierId → declined. A declined material is a deliberate "we won't supply
   *  this", which is a different answer from leaving it unpriced. */
  const [declined, setDeclined] = useState<Record<string, boolean>>({});
  const [quoteNo, setQuoteNo] = useState('');
  const [leadWeeks, setLeadWeeks] = useState('');
  const [validity, setValidity] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // Object URLs are not garbage-collected; revoke or the PDF stays resident.
  useEffect(
    () => () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    },
    [pdfUrl],
  );

  const tiers = useMemo(() => (packet?.tiers ?? []) as PacketTier[], [packet]);
  const specs = useMemo(() => (packet?.specs ?? []) as PacketSpec[], [packet]);

  /** The spec for a tier, joined on item revision — `specs` is unfiltered. */
  function specForTier(t: PacketTier): PacketSpec | null {
    const revId = (t.rfe_line?.item_rev_id as { id?: string } | undefined)?.id;
    return specs.find((s) => s.item_rev_id?.id === revId) ?? specs[0] ?? null;
  }

  const latestRound = Math.max(0, ...(packet?.responses ?? []).map((r) => asNumber(r.round) ?? 0));
  const alreadyQuoted = latestRound > 0;

  /**
   * How many lines carry a real price.
   *
   * Submitting with none is almost always a slip, not a decision: it records
   * every line as `uncosted`, which downstream reads as "no quote" and quietly
   * stalls the buyer's decision chain with no visible cause. A supplier who
   * genuinely will not bid should say so explicitly rather than by omission.
   */
  const pricedCount = tiers.filter((t) => {
    const v = costs[t.id as string];
    return !declined[t.id as string] && Boolean(v) && Number(v) > 0;
  }).length;

  /**
   * Materials grouped under the line they belong to.
   *
   * A supplier prices each material of a card — body, personalisation,
   * carrier, setup — and those costs sum to the card's unit cost. Grouping by
   * line keeps that relationship visible instead of presenting a flat list of
   * unrelated prices.
   */
  const groups = useMemo(() => {
    const byLine = new Map<string, { name: string; qty: number; rows: PacketTier[] }>();
    for (const t of tiers) {
      const lineId = t.rfe_line?.id ?? 'line';
      const existing = byLine.get(lineId);
      if (existing) existing.rows.push(t);
      else
        byLine.set(lineId, {
          name: asText(t.rfe_line?.item_rev_id?.item_id?.name) || 'Untitled',
          qty: asNumber(t.tier_qty) ?? asNumber(t.rfe_line?.qty) ?? 0,
          rows: [t],
        });
    }
    // Materials in one fixed order in every group. The query orders by
    // quantity only, so the database is free to return them differently per
    // line — one card reading card/carrier/… and the next setup/card/… makes
    // a supplier re-read each block instead of scanning down a column.
    const rank = new Map(COMPONENT_ROLES.map((c, i) => [c.role as string, i]));
    for (const g of byLine.values()) {
      g.rows.sort(
        (a, b) =>
          (rank.get(asText(a.component_role)) ?? 99) -
          (rank.get(asText(b.component_role)) ?? 99),
      );
    }
    return [...byLine.values()];
  }, [tiers]);

  /** Extended total across every priced material. */
  const grandTotal = tiers.reduce((sum, t) => {
    const id = t.id as string;
    if (declined[id]) return sum;
    const unit = Number(costs[id]);
    if (!Number.isFinite(unit) || unit <= 0) return sum;
    return sum + unit * (asNumber(t.tier_qty) ?? 0);
  }, 0);

  async function openPdf(fileId: string, name: string) {
    setPdfOpen(true);
    setPdfUrl(null);
    setPdfError(null);
    try {
      const blob = await drive.download(fileId);
      setPdfUrl(URL.createObjectURL(blob));
    } catch (e) {
      setPdfError(e instanceof Error ? e.message : String(e));
    }
    void name;
  }

  async function submitQuote() {
    setBusy(true);
    setNote(null);
    try {
      const lines: SupplierQuoteLine[] = tiers
        .filter((t) => t.id)
        .map((t) => {
          const typed = Number(costs[t.id as string]);
          const priced = Boolean(costs[t.id as string]) && typed > 0;
          const isDeclined = Boolean(declined[t.id as string]);
          return {
            tierId: t.id as string,
            costMicros: priced && !isDeclined ? unitToMicros(typed) : 0,
            declined: isDeclined,
            // Blank means "not priced", which is a different answer from both
            // zero and from a deliberate decline.
            uncosted: !isDeclined && !priced,
          };
        });
      const { signalWarning } = await recordSupplierQuote({
        rfeId,
        // A re-quote opens the next round rather than overwriting the first.
        round: latestRound + 1,
        supplierQuoteNo: quoteNo.trim(),
        validityUntil: validity || null,
        commitsToDelivery: true,
        leadTimeWeeks: leadWeeks ? Number(leadWeeks) : null,
        lines,
      });
      await packetQuery.refetch();
      // The quote is saved in both branches — only the buyer-side notification
      // can fail. Reporting that plainly beats a blanket "Thank you" that would
      // hide a stalled order, or an error that would imply the quote was lost.
      setNote(signalWarning ?? 'Quote submitted. Thank you.');
    } catch (e) {
      setNote(`Could not submit: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  if (packetQuery.isLoading) {
    return (
      <div className={PAGE_CONTAINER}>
        <Skeleton className="h-10 w-64" />
        <Skeleton className="mt-4 h-64 rounded-xl" />
      </div>
    );
  }

  if (!packet?.rfe?.id) {
    return (
      <div className={PAGE_CONTAINER}>
        <h1 className="text-[22px] font-bold text-foreground">Request not found</h1>
        <p className="mt-1 text-[14px] text-muted-foreground">
          This quote request does not exist, or the link has expired.
        </p>
      </div>
    );
  }

  const rfe = packet.rfe;

  return (
    <div className={PAGE_CONTAINER} data-testid="supplier-rfe-page">
      <div className="mb-1 text-[13px] font-semibold tracking-[0.02em] text-teal-700">
        Request for estimate
      </div>
      <h1 className="text-[28px] font-extrabold tracking-[-0.02em] text-foreground">
        {rfe.supplier?.name ?? 'Supplier'}
      </h1>
      <p className="mb-5 mt-1 text-[15px] text-muted-foreground">
        {rfe.demand_order?.order_code ? `Order ${rfe.demand_order.order_code} · ` : ''}
        Respond by <strong className="text-foreground">{rfe.respond_by ?? '—'}</strong>
        {rfe.demand_order?.requested_delivery
          ? ` · delivery ${rfe.demand_order.requested_delivery}`
          : ''}
      </p>

      {rfe.setup_instructions ? (
        <p className="mb-5 rounded-lg border border-border bg-card px-4 py-3 text-[13.5px] text-foreground">
          {rfe.setup_instructions}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── What you are quoting ─────────────────────────────── */}
        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
            Specification
          </h2>
          {/* One block per LINE, not per tier.
              A card's specification belongs to the card; the tiers under it are
              its materials, all sharing that one spec. Mapping tiers repeated
              the whole block — artwork, every parameter, the spec-sheet button —
              once per material, so a four-material card rendered its spec four
              times and the supplier had to scroll past duplicates to reach the
              second card. `groups` is the same line grouping the quote form
              already uses, so the two panels stay in step. */}
          {groups.map((g) => {
            const t = g.rows[0];
            const spec = specForTier(t);
            const item = t.rfe_line?.item_rev_id?.item_id;
            const preview = spec?.artwork_preview;
            return (
              <div
                key={t.rfe_line?.id ?? t.id}
                className="mb-4 last:mb-0"
                data-testid={`spec-${item?.name}`}
              >
                <div className="mb-2 flex items-baseline gap-2">
                  <span className="text-[14px] font-bold text-foreground">
                    {asText(item?.name) || 'Card'}
                  </span>
                  <span className="text-[12px] text-muted-foreground">
                    {g.qty.toLocaleString()} units
                  </span>
                </div>
                {preview?.front ? (
                  <img
                    src={preview.front}
                    alt=""
                    className="mb-2 w-full max-w-[18rem] rounded border border-border"
                  />
                ) : null}
                <dl className="flex flex-col gap-0.5">
                  {SPEC_ROWS.map(([key, label]) => (
                    <div key={key} className="flex items-baseline justify-between gap-2">
                      <dt className="text-[12px] text-muted-foreground">{label}</dt>
                      <dd className="text-[12px] font-semibold text-foreground">
                        {specValue(spec?.[key])}
                      </dd>
                    </div>
                  ))}
                </dl>
                {spec?.artwork_pdf_file_id ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    data-testid="open-spec-sheet"
                    onClick={() =>
                      openPdf(
                        spec.artwork_pdf_file_id as string,
                        spec.artwork_pdf_name ?? 'spec.pdf',
                      )
                    }
                  >
                    <i className="icon icon_-Tb_file_type_pdf" aria-hidden="true" />
                    Open spec sheet
                  </Button>
                ) : (
                  <p className="mt-2 text-[12px] text-muted-foreground">
                    No spec sheet attached to this request.
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Your quote ───────────────────────────────────────── */}
        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
            Your quote
          </h2>
          {alreadyQuoted ? (
            <p className="mb-3 rounded-md bg-teal-50 px-3 py-2 text-[12.5px] text-teal-700">
              You submitted round {latestRound}. Submitting again opens round {latestRound + 1};
              it does not overwrite what you sent.
            </p>
          ) : null}
          <div className="flex flex-col gap-3">
            {/* MATERIAL | QTY | COST (per unit), grouped by line. */}
            <div className="overflow-hidden rounded-lg border border-border">
              <div className="flex items-center gap-2 border-b border-border bg-primary-50 px-3 py-2">
                <span className="flex-1 text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                  Material
                </span>
                <span className="w-[7rem] text-right text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                  Qty
                </span>
                <span className="w-[9rem] text-right text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                  Cost (per unit)
                </span>
              </div>

              {groups.map((g, gi) => (
                <div key={gi}>
                  <div className="border-b border-border bg-muted/40 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                    {g.name} — {g.qty.toLocaleString()} units
                  </div>
                  {g.rows.map((t) => {
                    const id = t.id as string;
                    const isDeclined = Boolean(declined[id]);
                    return (
                      <div
                        key={id}
                        className="flex items-center gap-2 border-b border-border px-3 py-2 last:border-b-0"
                        data-testid={`material-${g.name}-${t.component_role}`}
                      >
                        <span
                          className={`flex-1 text-[13px] font-semibold ${
                            isDeclined ? 'text-muted-foreground line-through' : 'text-foreground'
                          }`}
                        >
                          {componentLabel(t.component_role)}
                        </span>
                        <span className="w-[7rem] text-right text-[12px] tabular-nums text-muted-foreground">
                          {(asNumber(t.tier_qty) ?? 0).toLocaleString()} units
                        </span>
                        <span className="flex w-[9rem] flex-col items-end gap-0.5">
                          <span className="flex items-center gap-1">
                            <span className="text-[12px] text-muted-foreground">$</span>
                            <Input
                              id={`cost-${id}`}
                              name={`cost-${id}`}
                              data-testid={`supplier-cost-${t.component_role}`}
                              className="h-8 w-[6.5rem] text-right text-[13px]"
                              inputMode="decimal"
                              disabled={isDeclined}
                              value={isDeclined ? '' : (costs[id] ?? '')}
                              onChange={(e) =>
                                setCosts((c) => ({
                                  ...c,
                                  [id]: e.target.value.replace(/[^0-9.]/g, ''),
                                }))
                              }
                            />
                          </span>
                          <button
                            type="button"
                            data-testid={`decline-${t.component_role}`}
                            className="text-[11px] text-muted-foreground hover:underline"
                            onClick={() =>
                              setDeclined((d) => ({ ...d, [id]: !d[id] }))
                            }
                          >
                            {isDeclined ? 'Undo decline' : 'Decline this material'}
                          </button>
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))}

              <div className="flex items-center gap-2 border-t border-border px-3 py-2.5">
                <span className="flex-1 text-[13px] font-bold text-foreground">
                  Total (all lines)
                </span>
                <span
                  className="text-[13px] font-bold tabular-nums text-foreground"
                  data-testid="quote-grand-total"
                >
                  ${grandTotal.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="supplier-quote-no">Your quote no.</Label>
                <Input
                  id="supplier-quote-no"
                  name="quoteNo"
                  data-testid="supplier-quote-no"
                  value={quoteNo}
                  onChange={(e) => setQuoteNo(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="supplier-lead">Lead time (weeks)</Label>
                <Input
                  id="supplier-lead"
                  name="leadWeeks"
                  data-testid="supplier-lead-weeks"
                  inputMode="numeric"
                  value={leadWeeks}
                  onChange={(e) => setLeadWeeks(e.target.value.replace(/[^0-9]/g, ''))}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="supplier-validity">Quote valid until</Label>
              <Input
                id="supplier-validity"
                name="validity"
                type="date"
                data-testid="supplier-validity"
                value={validity}
                onChange={(e) => setValidity(e.target.value)}
              />
            </div>
            <Button
              className="self-start"
              data-testid="submit-supplier-quote"
              onClick={submitQuote}
              aria-busy={busy}
              disabled={busy || pricedCount === 0}
              title={
                pricedCount === 0
                  ? 'Enter a unit cost on at least one line, or decline the request'
                  : undefined
              }
            >
              {busy ? 'Submitting…' : 'Submit quote'}
            </Button>
            {pricedCount === 0 ? (
              <p className="text-[12.5px] text-muted-foreground">
                Enter a unit cost on at least one line. If you are not bidding, decline the
                request instead — an empty quote reads as &ldquo;no price given&rdquo; and
                stalls the buyer.
              </p>
            ) : null}
            {note ? <p className="text-[12.5px] text-muted-foreground">{note}</p> : null}
          </div>
        </div>
      </div>

      <Dialog
        open={pdfOpen}
        onOpenChange={(open) => {
          setPdfOpen(open);
          if (!open) {
            if (pdfUrl) URL.revokeObjectURL(pdfUrl);
            setPdfUrl(null);
            setPdfError(null);
          }
        }}
      >
        <DialogContent className="flex h-[85vh] flex-col sm:max-w-[56rem]" data-testid="spec-sheet-dialog">
          <DialogHeader>
            <DialogTitle>Card specification</DialogTitle>
            <DialogDescription>The spec sheet for this request.</DialogDescription>
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
              <PdfPane url={pdfUrl} name="spec.pdf" rootClassName="flex flex-1 min-h-0 flex-col" />
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

export default SupplierRfePage;
