/**
 * Proposal — the sell-side document the client accepts.
 *
 * Two artefacts, deliberately distinct:
 *   · the CS PREVIEW below, which shows supplier cost, margin AND client
 *     price, matching the demo's "Proposal preview · {bestSupplier}" panel;
 *   · the CLIENT PDF, which shows sell prices only. `buildClientProposalHtml`
 *     is never handed cost or margin, so the redaction cannot be lost to a
 *     careless edit here.
 *
 * Order of operations on send, and it matters: generate the document, store
 * its Drive id against the proposal, write the award record, THEN signal the
 * workflow. Each step depends on the last, and a failure anywhere leaves the
 * order at Proposal rather than advancing past evidence that does not exist.
 */
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { useDriveFiles } from '@/hooks';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { APP_BRAND } from '@/pages/_shared/brand';
import { buildClientProposalHtml } from './client-proposal';
import { createProposal, generatePdfFromHtml, updateProposal, type ProposalRow } from './order-api';
import { money, pct, unitMoney, type DealSummary } from './deal-helpers';

/** Lazy: react-pdf is heavy and only needed when a document is opened. */
const PdfPane = lazy(() =>
  import('@/components/shared/PdfPane').then((m) => ({ default: m.PdfPane })),
);

export function ProposalPanel({
  orderId,
  orderNo,
  clientName,
  requestedDelivery,
  deal,
  proposals,
  busy,
  readOnly = false,
  onChanged,
  onSendToClient,
}: {
  orderId: string;
  orderNo: string;
  clientName: string | null;
  requestedDelivery?: string | null;
  deal: DealSummary;
  /** Newest version first, from `order_proposals`. */
  proposals: ProposalRow[];
  busy: boolean;
  /**
   * Past the Proposal state: the document is a RECORD of what went to the
   * client. The preview stays — that is the whole point of keeping it — but
   * nothing here may build or send another.
   */
  readOnly?: boolean;
  /** Refetch the proposal list after a write. */
  onChanged: () => Promise<unknown>;
  /** Writes the award record and signals the workflow. */
  onSendToClient: (proposal: ProposalRow) => Promise<void>;
}) {
  const [working, setWorking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  /** True when showing a local render because no PDF has been generated yet. */
  const [draftRender, setDraftRender] = useState(false);
  const drive = useDriveFiles();

  // Object URLs are a real allocation — released on unmount so opening the
  // preview repeatedly cannot leak a blob per open.
  useEffect(
    () => () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    },
    [pdfUrl],
  );

  const live = proposals[0] ?? null;
  const nextVersion = (proposals[0]?.version ?? 0) + 1;
  const sent = live?.status === 'sent';
  /**
   * Once the client has ACCEPTED, re-pricing is no longer a new proposal.
   *
   * The domain model is explicit about this on AwardRecord: "supersession is
   * a change order, never an in-place edit". So accepted closes the door here,
   * while a merely SENT proposal can still be superseded by a new version —
   * which is the normal shape of a negotiation.
   */
  const accepted = live?.status === 'accepted';

  /** Only lines with a sell price can be quoted to anybody. */
  const sellable = useMemo(
    () => deal.lines.filter((l) => l.unitSellMicros !== null),
    [deal.lines],
  );
  const unpriced = deal.lines.length - sellable.length;

  const blocked: string | null = (() => {
    if (deal.lines.length === 0) return 'Nothing to propose yet.';
    if (sellable.length === 0) return 'No line has a sell price — check the margins.';
    if (unpriced > 0)
      return `${unpriced} line${unpriced === 1 ? ' has' : 's have'} no sell price. Fix the margins before quoting.`;
    return null;
  })();

  function docInput(version: number) {
    return {
      appLabel: APP_BRAND,
      clientName: clientName ?? 'Client',
      orderNo: orderNo || '—',
      version,
      currency: 'USD',
      // Sell side ONLY — no cost, no margin, no supplier.
      lines: sellable.map((l) => ({
        name: l.name,
        qty: l.qty,
        unitSellMicros: l.unitSellMicros,
        extendedSellMicros: l.extendedSellMicros,
      })),
      totalSellMicros: deal.totalSellMicros,
      requestedDelivery: requestedDelivery ?? null,
      generatedAt: new Date().toLocaleString(),
    };
  }

  /**
   * Price and build the proposal — the demo's "Price & build proposal".
   *
   * Writes the version FIRST so the document can never exist without a row
   * pointing at it, then renders the HTML, then attaches the Drive id.
   */
  async function handleBuild() {
    setWorking(true);
    setNote(null);
    try {
      const version = nextVersion;
      const proposalId = await createProposal({
        orderId,
        version,
        currency: 'USD',
        layout: 'Direct',
        // The immutable payload: what was priced, at what margin, and the
        // gate state at generation.
        dealSnap: {
          lines: deal.lines.map((l) => ({
            order_line_id: l.orderLineId,
            name: l.name,
            qty: l.qty,
            supplier_id: l.supplierId,
            supplier_name: l.supplierName,
            unit_cost_micros: l.unitCostMicros,
            unit_sell_micros: l.unitSellMicros,
            realised_bps: l.realisedBps,
            materials: l.materials.map((m) => ({
              component_role: m.componentRole,
              unit_cost_micros: m.unitCostMicros,
              unit_sell_micros: m.unitSellMicros,
              margin_bps: m.marginBps,
              declined: m.declined,
            })),
          })),
          total_cost_micros: deal.totalCostMicros,
          total_sell_micros: deal.totalSellMicros,
          blended_bps: deal.blendedBps,
          floor_bps: deal.floorBps,
          any_below_floor: deal.anyBelowFloor,
          template_name: deal.templateName,
        },
        totalCostMicros: deal.totalCostMicros,
        totalSellMicros: deal.totalSellMicros,
        blendedBps: deal.blendedBps,
      });

      const filename = `${orderNo || 'order'}-proposal-v${version}.pdf`
        .replace(/[^\w.-]+/g, '-')
        .toLowerCase();
      const pdf = await generatePdfFromHtml(buildClientProposalHtml(docInput(version)), filename);
      const fileId = (pdf as { file_id?: string; id?: string })?.file_id ?? (pdf as { id?: string })?.id ?? null;

      await updateProposal({
        proposalId,
        status: 'draft',
        pdfFileId: fileId,
        pdfName: filename,
        pdfAt: new Date().toISOString(),
      });
      await onChanged();
      setNote(`Proposal v${version} built — ${fileId ? 'PDF stored.' : 'PDF id not returned.'}`);
    } catch (e) {
      setNote(`Could not build the proposal: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setWorking(false);
    }
  }

  /**
   * Open the document the client receives.
   *
   * Prefers the PDF actually STORED in Jiffy Drive — that is the artefact that
   * was sent, and rendering the HTML afresh could differ from it if anything
   * has been re-priced since. Falls back to a local render only when no
   * version has been generated yet, and says so.
   */
  async function handlePreview() {
    setPdfOpen(true);
    setPdfUrl(null);
    setPdfError(null);
    const fileId = live?.pdf_file_id;

    if (typeof fileId === 'string' && fileId) {
      setDraftRender(false);
      try {
        const blob = await drive.download(fileId);
        setPdfUrl(URL.createObjectURL(blob));
      } catch (e) {
        setPdfError(e instanceof Error ? e.message : String(e));
      }
      return;
    }

    setDraftRender(true);
    setPdfUrl(
      URL.createObjectURL(
        new Blob([buildClientProposalHtml(docInput(nextVersion))], { type: 'text/html' }),
      ),
    );
  }

  async function handleSend() {
    if (!live) return;
    setWorking(true);
    setNote(null);
    try {
      await updateProposal({
        proposalId: live.id as string,
        status: 'sent',
        // Full merged state — proposal_update replaces every column it names.
        pdfFileId: live.pdf_file_id ?? null,
        pdfName: live.pdf_name ?? null,
        pdfAt: live.pdf_at ?? null,
        sentAt: new Date().toISOString(),
        sentBy: 'cs',
      });
      await onChanged();
      await onSendToClient(live);
      setNote('Proposal sent to the client.');
    } catch (e) {
      setNote(`Could not send: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setWorking(false);
    }
  }

  const inFlight = busy || working;

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4" data-testid="proposal-panel">
      <div className="flex items-baseline gap-2">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
          Proposal preview
        </h3>
        {live ? (
          <span className="text-[12px] text-muted-foreground">
            v{live.version} · {live.status}
          </span>
        ) : (
          <span className="text-[12px] text-muted-foreground">Not built</span>
        )}
      </div>

      {/* CS view: cost and margin sit here and ONLY here. */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
              <th className="px-3 py-2">Line</th>
              <th className="px-3 py-2 text-right">Supplier cost</th>
              <th className="px-3 py-2 text-right">Margin</th>
              <th className="px-3 py-2 text-right">Client price</th>
              <th className="px-3 py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {deal.lines.map((l) => (
              <tr key={l.tierId} className="border-b border-border last:border-b-0">
                <td className="px-3 py-2 text-[13px] text-foreground">
                  {l.name}
                  <span className="ml-1.5 text-[11.5px] text-muted-foreground">
                    {l.qty.toLocaleString()} units
                  </span>
                </td>
                <td className="px-3 py-2 text-right text-[12.5px] tabular-nums text-muted-foreground">
                  {unitMoney(l.unitCostMicros)}
                </td>
                <td className="px-3 py-2 text-right text-[12.5px] tabular-nums text-muted-foreground">
                  {pct(l.realisedBps)}
                </td>
                <td className="px-3 py-2 text-right text-[13px] font-semibold tabular-nums text-foreground">
                  {unitMoney(l.unitSellMicros)}
                </td>
                <td className="px-3 py-2 text-right text-[13px] font-semibold tabular-nums text-foreground">
                  {money(l.extendedSellMicros)}
                </td>
              </tr>
            ))}
            <tr className="bg-muted/40 font-semibold">
              <td className="px-3 py-2 text-[12px] uppercase tracking-[0.06em] text-muted-foreground">
                Order total
              </td>
              <td className="px-3 py-2 text-right text-[12.5px] tabular-nums text-muted-foreground">
                {money(deal.totalCostMicros)}
              </td>
              <td className="px-3 py-2 text-right text-[12.5px] tabular-nums text-muted-foreground">
                {pct(deal.blendedBps)}
              </td>
              <td className="px-3 py-2" />
              <td className="px-3 py-2 text-right text-[13px] tabular-nums text-foreground">
                {money(deal.totalSellMicros)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="text-[11.5px] text-muted-foreground">
        Supplier cost, margin and supplier names are shown here for review only —
        the client document carries prices and totals alone.
      </p>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        {/* Build ONCE. Re-pricing an issued proposal is not a rebuild — the
            domain model routes it through a change order ("supersession is a
            change order, never an in-place edit"), which is its own flow with
            its own reason and impact tracking. Offering a Rebuild button here
            would quietly create versions outside that governance, so it is
            absent rather than disabled. */}
        {live || readOnly ? null : (
          <Button
            data-testid="build-proposal-pdf"
            onClick={handleBuild}
            aria-busy={inFlight}
            disabled={inFlight || Boolean(blocked)}
            title={blocked ?? 'Price and build the client proposal'}
          >
            <i className="icon icon_-Tb_file_dollar" aria-hidden="true" />
            Price &amp; build proposal
          </Button>
        )}

        <Button
          variant="outline"
          data-testid="preview-proposal"
          onClick={handlePreview}
          disabled={Boolean(blocked)}
          title="Open the document exactly as the client receives it"
        >
          <i className="icon icon_-Tb_eye" aria-hidden="true" />
          Preview client document
        </Button>

        <Button
          data-testid="send-to-client"
          onClick={handleSend}
          aria-busy={inFlight}
          disabled={inFlight || !live || sent || accepted || readOnly}
          title={
            !live
              ? 'Build the proposal first'
              : accepted
                ? 'Already accepted'
                : sent
                  ? `v${live.version} is already with the client — rebuild as v${nextVersion} to send revised pricing`
                  : 'Send to the client and advance the order'
          }
        >
          <i className="icon icon_-Tb_send" aria-hidden="true" />
          Send to client
        </Button>

        <span className="text-[12.5px] text-muted-foreground">
          {blocked ??
            (accepted
              ? `v${live?.version} accepted — any change from here is a change order.`
              : sent
                ? `v${live?.version} sent ${live?.sent_at?.slice(0, 10) ?? ''} — awaiting the client's decision. Re-pricing is a change order.`
                : live
                  ? `v${live.version} ready · ${money(live.total_sell_micros ?? null)}`
                  : 'Build the document, then send it.')}
        </span>
      </div>

      {note ? <p className="text-[12.5px] text-muted-foreground">{note}</p> : null}

      <Dialog
        open={pdfOpen}
        onOpenChange={(open) => {
          setPdfOpen(open);
          if (!open) {
            // Revoked here as well as on unmount, so reopening cannot stack a
            // second live blob on the first.
            if (pdfUrl) URL.revokeObjectURL(pdfUrl);
            setPdfUrl(null);
            setPdfError(null);
          }
        }}
      >
        <DialogContent
          className="flex h-[85vh] flex-col sm:max-w-[56rem]"
          data-testid="proposal-pdf-dialog"
        >
          <DialogHeader>
            <DialogTitle>Client proposal</DialogTitle>
            <DialogDescription>
              {draftRender
                ? 'Not generated yet — this is a local render of what will be produced.'
                : (live?.pdf_name ?? 'The document as the client receives it.')}
            </DialogDescription>
          </DialogHeader>
          {pdfError ? (
            <p className="text-[13px] text-destructive" role="alert">
              Could not open the document: {pdfError}
            </p>
          ) : !pdfUrl ? (
            <div className="grid flex-1 place-items-center" role="status" aria-busy="true">
              <Spinner />
            </div>
          ) : draftRender ? (
            // A local HTML render, not a PDF — an iframe is right here, and
            // PdfPane would fail on it.
            <iframe
              src={pdfUrl}
              title="Client proposal draft"
              className="min-h-0 flex-1 rounded-lg border border-border bg-white"
              data-testid="proposal-draft-frame"
            />
          ) : (
            <Suspense
              fallback={
                <div className="grid flex-1 place-items-center">
                  <Spinner />
                </div>
              }
            >
              <PdfPane
                url={pdfUrl}
                name={live?.pdf_name ?? 'proposal.pdf'}
                rootClassName="flex flex-1 min-h-0 flex-col"
              />
            </Suspense>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default ProposalPanel;
