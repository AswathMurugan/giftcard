/**
 * The cards on an order, read-only and collapsed.
 *
 * Shown at every stage EXCEPT Specs, where the full studio renders instead.
 * It exists because the workflow does not linger at Specs — a single signal
 * carries an order from Order straight through to Quote — so by the time
 * anyone reviews quotes the studio is gone. Reviewing a supplier's price with
 * no way to see what is being priced is the gap this closes.
 *
 * Deliberately read-only: past Specs the design is what suppliers were asked
 * to quote against, so changing it here would silently invalidate every RFE
 * already out. Editing stays where the revision does.
 */
import { useState } from 'react';
import { useSavedQuerySingle } from '@/hooks';
import { Skeleton } from '@/components/ui/skeleton';
import { buildBom, buildSpecGroups, type OrderCardSpecResult } from './spec-helpers';

/** The parameters worth showing without opening anything — the ones a
 *  supplier prices against. The rest stay in the spec sheet. */
const HEADLINE_KEYS = ['shape', 'substrate', 'thickness_mil', 'finish'] as const;

export function CardSummary({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);

  const cardSpec = useSavedQuerySingle('order_card_spec', {
    input: { orderId },
    enabled: Boolean(orderId),
  });
  const bom = buildBom(cardSpec.data as OrderCardSpecResult | null);

  if (cardSpec.isLoading) {
    return <Skeleton className="h-[3.25rem] rounded-xl" />;
  }
  /**
   * Nothing to show, so show nothing.
   *
   * This is a context strip, not a stage panel: with no cards it added a bar
   * saying "No cards on this order" directly above the Specs panel's own empty
   * state, which says the same thing AND offers the button that fixes it. The
   * absence is not worth a row.
   */
  if (bom.length === 0) return null;

  /**
   * Styled as a stage panel rather than a bare toggle.
   *
   * It sits directly above the stage panel and outlives it — the cards are a
   * property of the ORDER, true from Specs through to Close — so it has to
   * read as a peer of that panel, not as a stray link floating on the page
   * background.
   */
  return (
    <div className="mb-4 overflow-hidden rounded-xl border border-border bg-card">
      <button
        type="button"
        data-testid="card-summary-toggle"
        aria-expanded={open}
        aria-label={`${open ? 'Collapse' : 'Expand'} the cards on this order`}
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center gap-2.5 px-4 py-3.5 text-left ${
          open ? 'border-b border-border' : ''
        }`}
      >
        {/* Chevron first, like every ChainBlock below it. These cards stack
            into one column, so the control that opens them has to sit in the
            same place on each — one on the right and the rest on the left
            reads as two different kinds of card. */}
        <i
          className={`icon icon_-Tb_chevron_right text-[1.125rem] text-muted-foreground transition-transform ${
            open ? 'rotate-90' : ''
          }`}
          aria-hidden="true"
        />
        <i className="icon icon_-Tb_credit_card text-[17px] text-primary-600" aria-hidden="true" />
        <span className="text-[13.5px] font-bold text-foreground">Cards on this order</span>
        <span className="rounded-full bg-muted px-2.5 py-0.5 text-[12px] font-bold text-muted-foreground">
          {bom.length}
        </span>
      </button>

      {open ? (
        <div className="grid gap-3 px-4 py-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {bom.map((entry) => {
            const preview = (entry.spec?.artwork_preview ?? {}) as {
              front?: unknown;
            };
            const groups = buildSpecGroups(entry.spec ?? null);
            const params = groups
              .flatMap((g) => g.params)
              .filter((p) => (HEADLINE_KEYS as readonly string[]).includes(p.key));

            return (
              <div
                key={entry.lineId}
                data-testid={`card-summary-${entry.name}`}
                className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3"
              >
                {typeof preview.front === 'string' ? (
                  <img
                    src={preview.front}
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
                <div>
                  <span className="block text-[13px] font-bold text-foreground">
                    {entry.name}
                  </span>
                  <span className="block text-[11.5px] text-muted-foreground">
                    {entry.qty !== null ? entry.qty.toLocaleString() : '—'} units
                    {entry.rev !== null ? ` · rev ${entry.rev}` : ''}
                  </span>
                </div>
                <dl className="flex flex-col gap-0.5">
                  {params.map((p) => (
                    <div key={p.key} className="flex items-baseline justify-between gap-2">
                      <dt className="text-[11.5px] text-muted-foreground">{p.label}</dt>
                      <dd className="text-[11.5px] font-semibold text-foreground">
                        {p.value ?? '—'}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export default CardSummary;
