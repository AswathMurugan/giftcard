/**
 * Send for quotes — pick the cards, pick the suppliers, send.
 *
 * The write happens HERE, in the UI, and the workflow signal fires only once
 * every RFE is on disk. The signal therefore means "the RFEs exist, advance",
 * not "please create RFEs". That ordering is deliberate:
 *
 *   · UI-first  — an insert fails, nothing is signalled, the order stays at
 *     Specs and the operator can retry. The stage moves only once the data
 *     backing it is real.
 *   · Signal-first — the workflow's insert fails and the stage has ALREADY
 *     advanced to Quote with no RFEs behind it, with no way for the UI to
 *     learn that. The Quote grid would read an empty set as a real one.
 *
 * It is also what the platform allows: every stage template in `create_order`
 * reports "does not have a block:{} slot", so a query node cannot be injected
 * into the Quote stage, and the single shared signal listener types its payload
 * as one `orders` object — not an RFE tree.
 */
import { useMemo, useState } from 'react';
import { useSavedQueryList, useSavedQuerySingle } from '@/hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { createRfeForSupplier, type RfeBidLine } from './order-api';
import { buildBom, type OrderCardSpecResult } from './spec-helpers';

interface SupplierRow {
  id?: string;
  name?: string;
  kind?: string;
  status?: string;
}

/** Per-supplier outcome, so a partial send can be reported honestly. */
interface SendResult {
  supplierId: string;
  name: string;
  ok: boolean;
  error?: string;
}

/** Default respond-by: two weeks out, which is the usual quoting window. */
function defaultRespondBy(today: Date): string {
  const d = new Date(today.getTime());
  d.setDate(d.getDate() + 14);
  // Date-only, local — toISOString would shift the day for anyone west of UTC.
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function SendForQuotesDialog({
  open,
  onOpenChange,
  orderId,
  orderNo,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  orderNo?: string | null;
  /** Fired only after every selected supplier's RFE is written. */
  onSent: (summary: { rfeCount: number; supplierNames: string[] }) => void;
}) {
  const [step, setStep] = useState<'cards' | 'suppliers'>('cards');
  /**
   * null = untouched, meaning "every quotable card". Derived rather than
   * seeded by an effect: the card list arrives asynchronously, so an effect
   * would have to write state on every load and would clobber a selection the
   * operator had already made.
   */
  const [pickedLines, setPickedLines] = useState<Set<string> | null>(null);
  const [pickedSuppliers, setPickedSuppliers] = useState<Set<string>>(new Set());
  const [respondBy, setRespondBy] = useState(() => defaultRespondBy(new Date()));
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<SendResult[]>([]);

  // Same query key the Specs panel uses, so this is a cache hit rather than a
  // second round trip.
  const cardSpec = useSavedQuerySingle('order_card_spec', {
    input: { orderId },
    enabled: Boolean(orderId) && open,
  });
  const bom = useMemo(
    () => buildBom(cardSpec.data as OrderCardSpecResult | null),
    [cardSpec.data],
  );

  const suppliers = useSavedQueryList('supplier_list', { enabled: open });
  const supplierRows = (suppliers.data ?? []) as SupplierRow[];

  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  /**
   * A card can only be quoted if it has an item revision — an RFE bid line is
   * keyed by revision, so a card without one cannot be put out to bid.
   */
  const quotable = bom.filter((b) => b.itemRevId);
  const unquotable = bom.filter((b) => !b.itemRevId);

  // Every card ticked until the operator says otherwise: quoting the whole
  // order is the common case, and deselecting beats selecting when there are
  // several.
  const effectiveLines =
    pickedLines ?? new Set(quotable.map((b) => b.lineId));

  // Selected cards whose revision has not been approved.
  const draftCount = quotable.filter(
    (b) => effectiveLines.has(b.lineId) && b.revStatus !== 'Approved',
  ).length;

  const lines: RfeBidLine[] = quotable
    .filter((b) => effectiveLines.has(b.lineId))
    .map((b) => ({
      orderLineId: b.lineId,
      itemRevId: b.itemRevId as string,
      qty: b.qty ?? 0,
    }));

  async function handleSend() {
    setBusy(true);
    setResults([]);
    const chosen = supplierRows.filter((s) => s.id && pickedSuppliers.has(s.id));
    const out: SendResult[] = [];
    for (const supplier of chosen) {
      try {
        await createRfeForSupplier({
          orderId,
          supplierId: supplier.id as string,
          setupInstructions:
            instructions.trim() ||
            `Quote request for ${orderNo ?? 'this order'} — ${lines.length} card${
              lines.length === 1 ? '' : 's'
            }.`,
          respondBy,
          lines,
        });
        out.push({ supplierId: supplier.id as string, name: supplier.name ?? '—', ok: true });
      } catch (e) {
        out.push({
          supplierId: supplier.id as string,
          name: supplier.name ?? '—',
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
      // Rendered as each supplier settles, so a slow send shows progress.
      setResults([...out]);
    }
    setBusy(false);

    const sent = out.filter((r) => r.ok);
    // Signal ONLY if every RFE landed. A partial send leaves the order at
    // Specs on purpose: advancing to Quote with some suppliers missing would
    // present an incomplete comparison as a complete one.
    if (sent.length > 0 && sent.length === out.length) {
      onSent({ rfeCount: sent.length, supplierNames: sent.map((r) => r.name) });
    }
  }

  const failed = results.filter((r) => !r.ok);
  const succeeded = results.filter((r) => r.ok);

  return (
    <Dialog open={open} onOpenChange={busy ? () => {} : onOpenChange}>
      <DialogContent className="sm:max-w-[38rem]" data-testid="send-for-quotes-dialog">
        <DialogHeader>
          <DialogTitle>
            {step === 'cards' ? 'Which cards go out to bid?' : 'Which suppliers?'}
          </DialogTitle>
          <DialogDescription>
            {step === 'cards'
              ? 'Each card becomes a bid line on every RFE, quoted at its own quantity.'
              : `One RFE per supplier, each with ${lines.length} bid line${
                  lines.length === 1 ? '' : 's'
                }. The order advances to Quote once all are sent.`}
          </DialogDescription>
        </DialogHeader>

        {step === 'cards' ? (
          <div className="flex flex-col gap-3">
            {cardSpec.isLoading ? (
              <Skeleton className="h-24 rounded-lg" />
            ) : quotable.length === 0 ? (
              <p className="py-4 text-[13.5px] text-warning-700">
                No card on this order has an item revision, so there is nothing to quote.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {quotable.map((b) => (
                  <label
                    key={b.lineId}
                    data-testid={`quote-line-${b.name}`}
                    className="flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-card px-3 py-2"
                  >
                    <input
                      type="checkbox"
                      className="size-4 accent-primary-600"
                      checked={effectiveLines.has(b.lineId)}
                      onChange={() => setPickedLines(toggle(effectiveLines, b.lineId))}
                      aria-label={`Include ${b.name}`}
                    />
                    <span className="flex-1">
                      <span className="block text-[13px] font-bold text-foreground">
                        {b.name}
                      </span>
                      <span className="block text-[11.5px] text-muted-foreground">
                        {b.qty !== null ? b.qty.toLocaleString() : '—'} units
                        {b.rev !== null ? ` · rev ${b.rev}` : ''}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}

            {unquotable.length > 0 ? (
              <p className="text-[12.5px] text-muted-foreground">
                {unquotable.length} card{unquotable.length === 1 ? '' : 's'} skipped — no item
                revision to bid against.
              </p>
            ) : null}

            {/* An RFE quotes a REVISION. Sending against a draft means the
                supplier bids on a design that can still change under them —
                worth saying out loud, but not blocked: re-quoting a changed
                design is a normal part of the process. */}
            {draftCount > 0 ? (
              <p className="text-[12.5px] text-warning-700" role="status">
                {draftCount} of the selected {draftCount === 1 ? 'card is' : 'cards are'} still
                a draft design. Suppliers will quote a revision that can still change — approve
                the design first if it is settled.
              </p>
            ) : null}

            <div className="flex items-center gap-2">
              <Button
                data-testid="quotes-next"
                onClick={() => setStep('suppliers')}
                disabled={lines.length === 0}
              >
                Next
              </Button>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {suppliers.isLoading ? (
              <Skeleton className="h-24 rounded-lg" />
            ) : (
              <div className="flex max-h-[16rem] flex-col gap-2 overflow-y-auto">
                {supplierRows.map((s) => {
                  const result = results.find((r) => r.supplierId === s.id);
                  return (
                    <label
                      key={s.id}
                      data-testid={`quote-supplier-${s.name}`}
                      className="flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-card px-3 py-2"
                    >
                      <input
                        type="checkbox"
                        className="size-4 accent-primary-600"
                        checked={Boolean(s.id && pickedSuppliers.has(s.id))}
                        disabled={busy}
                        onChange={() => s.id && setPickedSuppliers((v) => toggle(v, s.id as string))}
                        aria-label={`Send to ${s.name}`}
                      />
                      <span className="flex-1 text-[13px] font-bold text-foreground">
                        {s.name}
                      </span>
                      {result ? (
                        <span
                          className={`text-[11.5px] font-semibold ${
                            result.ok ? 'text-success-600' : 'text-destructive'
                          }`}
                        >
                          {result.ok ? 'Sent' : 'Failed'}
                        </span>
                      ) : null}
                    </label>
                  );
                })}
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="respond-by">Respond by</Label>
              <Input
                id="respond-by"
                name="respondBy"
                type="date"
                data-testid="respond-by-input"
                value={respondBy}
                disabled={busy}
                onChange={(e) => setRespondBy(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="setup-instructions">Instructions to suppliers</Label>
              <Input
                id="setup-instructions"
                name="setupInstructions"
                data-testid="instructions-input"
                placeholder="Optional — snapshot onto every RFE"
                value={instructions}
                disabled={busy}
                onChange={(e) => setInstructions(e.target.value)}
              />
            </div>

            {failed.length > 0 ? (
              <p className="text-[12.5px] text-destructive" role="alert">
                {succeeded.length} of {results.length} sent. {failed[0].name} failed:{' '}
                {failed[0].error}. The order stays at Specs — fix and send to the rest.
              </p>
            ) : null}

            <div className="flex items-center gap-2">
              <Button
                data-testid="confirm-send-quotes"
                onClick={handleSend}
                aria-busy={busy}
                disabled={busy || pickedSuppliers.size === 0 || !respondBy}
              >
                {busy
                  ? `Sending ${results.length + 1} of ${pickedSuppliers.size}…`
                  : `Send to ${pickedSuppliers.size || 0} supplier${
                      pickedSuppliers.size === 1 ? '' : 's'
                    }`}
              </Button>
              <Button variant="outline" onClick={() => setStep('cards')} disabled={busy}>
                Back
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default SendForQuotesDialog;
