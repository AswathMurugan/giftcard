/**
 * Proofs — the client's sign-off surface.
 *
 * The one screen in Vista that writes back into the order lifecycle:
 * approving a proof releases production, and that goes to the workflow as a
 * signal rather than a column. Requesting changes records the rejection and
 * deliberately leaves the order where it is.
 *
 * A row is a CONVERSATION, not a round — a three-round proof is one line with
 * its history inside, because three lines would read as three outstanding jobs.
 * Opening a row opens the viewer, and the decision is taken there beside the
 * artwork rather than in a dialog reached from somewhere else.
 */
import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { useSavedQuerySingle } from '@/hooks';
import { PAGE_CONTAINER } from '@/pages/page-shell';
import { useClientSession } from '@/pages/_shared/client-session';
import { ClientSwitcher } from '@/pages/_shared/ClientSwitcher';
import type {
  ClientOrderDetailRow,
  ClientProofListRow,
} from '@/types/saved-queries.generated';
import { artworkFor } from '@/pages/my-orders/order-detail-helpers';
import { decideProof } from './proof-api';
import { explainSignalFailure } from '@/pages/_shared/sign-with-certificate';
import { decorateProofs, waitingCount, type ProofRow } from './proof-helpers';
import { ProofViewer } from './ProofViewer';

function shortDate(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '—';
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function ProofsPage() {
  const { clientId, clientName, isLoading: sessionLoading } = useClientSession();
  const [open, setOpen] = useState<ProofRow | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const packet = useSavedQuerySingle('client_proof_list', {
    input: { clientId },
    enabled: Boolean(clientId),
  });

  const rows = useMemo(
    () => decorateProofs((packet.data ?? null) as ClientProofListRow | null),
    [packet.data],
  );
  const waiting = waitingCount(rows);

  /**
   * The card's design for the viewer's preview pane.
   *
   * Fetched only once a proof is open, and only for that order — pulling every
   * order's artwork to render a list nobody has clicked would put a lot of
   * base64 on the wire for nothing.
   */
  const orderPacket = useSavedQuerySingle('client_order_detail', {
    input: { orderId: open?.orderId ?? '' },
    enabled: Boolean(open?.orderId),
  });

  const designPreview = useMemo(() => {
    const p = (orderPacket.data ?? null) as ClientOrderDetailRow | null;
    const revId = p?.lines?.[0]?.item?.item_rev_id ?? null;
    return artworkFor(p, typeof revId === 'string' ? revId : null);
  }, [orderPacket.data]);

  const close = useCallback(() => {
    setOpen(null);
    setProblem(null);
  }, []);

  const handleApprove = useCallback(
    async (signature: string) => {
      if (!open) return;
      // The typed name IS the signature — an empty one is not a sign-off.
      if (signature.trim().length < 3) {
        setProblem('Type your full name to sign.');
        return;
      }
      setBusy(true);
      setProblem(null);
      try {
        const { certificateProblem } = await decideProof(
          open,
          'approved',
          signature.trim(),
          clientName,
          `Approved by ${signature.trim()}`,
        );
        packet.refetch();
        toast.success(`${open.orderCode} — proof approved, production released`, {
          testId: 'toast-proof-approved',
        });
        // The approval stuck; only the certificate did not. Say which.
        if (certificateProblem) {
          setProblem(certificateProblem);
          setBusy(false);
          return;
        }
        close();
      } catch (error) {
        // The decision is already written; only the signal failed. Say so in
        // terms a client can act on, and never invite a second signature.
        setProblem(explainSignalFailure(error));
      } finally {
        setBusy(false);
      }
    },
    [open, clientName, packet, close],
  );

  const handleRequestChanges = useCallback(
    async (reason: string, comments: string) => {
      if (!open) return;
      // Comments are required so the account team knows what to change —
      // "rejected" with no reason just costs a round trip.
      if (comments.trim().length < 5) {
        setProblem('Tell your account team what needs to change.');
        return;
      }
      setBusy(true);
      setProblem(null);
      try {
        await decideProof(
          open,
          'rejected',
          clientName,
          clientName,
          `${reason}: ${comments.trim()}`,
        );
        packet.refetch();
        toast.success(`${open.orderCode} — changes requested`, {
          testId: 'toast-proof-rejected',
        });
        close();
      } catch (error) {
        setProblem(error instanceof Error ? error.message : 'Could not send your changes.');
      } finally {
        setBusy(false);
      }
    },
    [open, clientName, packet, close],
  );

  if (sessionLoading || packet.isLoading) {
    return (
      <div className={PAGE_CONTAINER}>
        <Skeleton className="mb-4 h-10 w-64" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }

  return (
    <div className={PAGE_CONTAINER} data-testid="proofs-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-[28px] font-extrabold tracking-[-0.02em] text-foreground">Proofs</h1>
        <ClientSwitcher />
      </div>
      <p className="mt-1 text-[15px] text-muted-foreground">
        {rows.length === 0
          ? `No proofs on ${clientName}'s orders yet.`
          : waiting === 0
            ? 'Nothing waiting on you. Earlier rounds stay listed below.'
            : `${waiting} proof${waiting === 1 ? '' : 's'} waiting on your sign-off. Approving releases production.`}
      </p>

      {rows.length === 0 ? (
        <div
          className="mt-6 rounded-xl border border-border bg-card px-4 py-10 text-center"
          data-testid="proofs-empty"
        >
          <p className="text-[14px] font-semibold text-foreground">No proofs yet</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            When artwork is ready for your approval it appears here.
          </p>
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-2">
          {rows.map((row) => (
            <div
              key={row.id}
              data-testid={`proof-row-${row.orderCode}-r${row.round}`}
              data-row-key={`${row.orderCode}-${row.round}`}
              className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card px-4 py-3.5"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-bold text-foreground">{row.orderCode}</span>
                  <span className="text-[12.5px] text-muted-foreground">
                    {row.proofType} · v{row.round}
                  </span>
                  <Badge variant={row.awaitingYou ? 'outline' : 'secondary'}>{row.label}</Badge>
                  {row.versions.length > 1 ? (
                    <span
                      className="text-[11.5px] text-muted-foreground"
                      data-testid={`proof-rounds-${row.orderCode}`}
                    >
                      {row.versions.length} rounds
                    </span>
                  ) : null}
                </div>
                <p className="line-clamp-1 text-[13px] text-muted-foreground">{row.brief}</p>
                <p className="text-[11.5px] text-muted-foreground/80">
                  {row.fileName ? `${row.fileName} · ` : ''}requested{' '}
                  {shortDate(row.requestedAt)}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <Button
                  size="sm"
                  variant={row.awaitingYou ? 'default' : 'outline'}
                  onClick={() => {
                    setProblem(null);
                    setOpen(row);
                  }}
                  data-testid={`proof-open-${row.orderCode}`}
                >
                  <i className="icon icon_-Tb_eye text-[1.125rem]" aria-hidden="true" />
                  {row.awaitingYou ? 'Review & approve' : 'View'}
                </Button>
                {!row.awaitingYou ? (
                  <Link
                    to={`/my-orders/${row.orderId}`}
                    className="text-[12px] font-semibold text-primary-600"
                    data-testid={`proof-open-order-${row.orderCode}`}
                  >
                    Record →
                  </Link>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      <ProofViewer
        proof={open}
        designPreview={designPreview}
        busy={busy}
        problem={problem}
        onClose={close}
        onApprove={handleApprove}
        onRequestChanges={handleRequestChanges}
      />
    </div>
  );
}

export default ProofsPage;
