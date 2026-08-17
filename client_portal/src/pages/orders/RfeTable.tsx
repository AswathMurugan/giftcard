/**
 * RFEs out for an order — the Quote stage's "who has been asked" table.
 *
 * Reads `order_rfes`, which is the same set the Send-for-quotes dialog writes.
 * Nothing here is derived or assumed: if a supplier is missing from this table,
 * no RFE row exists for them.
 */
import { Skeleton } from '@/components/ui/skeleton';

export interface OrderRfeRow {
  id?: string;
  status?: string;
  respond_by?: string;
  sent_at?: string | null;
  setup_instructions?: string;
  supplier?: { id?: string; name?: string };
}

/**
 * Display treatment per stored status.
 *
 * The stored vocabulary is the entity's own — draft / sent / responded /
 * returned / outdated / cancelled. `sent` is deliberately labelled "Awaiting
 * quote" rather than relabelled in the data: the row means the RFE has gone
 * out and no response is back yet, and inventing a `requested` status would
 * put a value in the table that nothing else in the system understands.
 */
const STATUS_UI: Record<string, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'bg-muted text-muted-foreground' },
  sent: { label: 'Awaiting quote', className: 'bg-teal-50 text-teal-700' },
  responded: { label: 'Quoted', className: 'bg-success-50 text-success-500' },
  returned: { label: 'Returned', className: 'bg-warning-50 text-warning-700' },
  outdated: { label: 'Outdated', className: 'bg-muted text-muted-foreground' },
  cancelled: { label: 'Cancelled', className: 'bg-muted text-muted-foreground' },
};

function StatusBadge({ status }: { status?: string }) {
  // An unrecognised value is shown verbatim rather than swallowed — a status
  // this UI doesn't know about is worth seeing, not hiding.
  const ui = STATUS_UI[status ?? ''] ?? {
    label: status || 'Unknown',
    className: 'bg-muted text-muted-foreground',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.04em] ${ui.className}`}
    >
      {ui.label}
    </span>
  );
}

/**
 * Presentational. The query is owned by the workspace so that sending RFEs can
 * REFETCH it — remounting this component would just re-read React Query's
 * cache and show the same empty list back.
 */
export function RfeTable({
  rows,
  loading,
}: {
  rows: OrderRfeRow[];
  loading: boolean;
}) {
  if (loading) {
    return <Skeleton className="h-24 rounded-lg" />;
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-[13.5px] text-muted-foreground">
        No RFEs sent yet. Use{' '}
        <span className="font-semibold text-foreground">Send for quotes</span> to put the cards
        out to bid.
      </p>
    );
  }

  const awaiting = rows.filter((r) => r.status === 'sent').length;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <span className="text-[13px] font-bold text-foreground">
          {rows.length} RFE{rows.length === 1 ? '' : 's'} out
        </span>
        <span className="text-[12.5px] text-muted-foreground">
          · {awaiting} awaiting a quote
        </span>
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                Supplier
              </th>
              <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                Status
              </th>
              <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                Respond by
              </th>
              <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                Sent
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                data-row-key={r.supplier?.name ?? r.id}
                data-testid={`rfe-row-${r.supplier?.name ?? r.id}`}
                className="border-b border-border last:border-b-0"
              >
                <td
                  className="px-3 py-2 text-[13px] font-semibold text-foreground"
                  data-testid={`${r.supplier?.name ?? r.id}-supplier`}
                >
                  {r.supplier?.name ?? '—'}
                </td>
                <td className="px-3 py-2" data-testid={`${r.supplier?.name ?? r.id}-status`}>
                  <StatusBadge status={r.status} />
                </td>
                <td className="px-3 py-2 text-[13px] tabular-nums text-muted-foreground">
                  {r.respond_by ?? '—'}
                </td>
                <td className="px-3 py-2 text-[13px] text-muted-foreground">
                  {/* When the request actually went out — what respond_by is
                      counted from. RFEs created before sent_at was written
                      keep a null here; it cannot be backfilled because `rfe`
                      has no created_at to derive it from. */}
                  {r.sent_at ? r.sent_at.slice(0, 10) : 'Not recorded'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default RfeTable;
