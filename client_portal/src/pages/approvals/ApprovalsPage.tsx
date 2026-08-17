/**
 * Approvals — the commercial documents a client signs.
 *
 * The other half of Vista's sign-off surface: Proofs is "does the artwork look
 * right", this is "do you accept the price". A signature here is typed, the
 * same way it is on a proof, so the two feel like one act rather than two
 * different products.
 */
import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { DialogError } from '@/pages/_shared/DialogError';
import { useSavedQueryList } from '@/hooks';
import { PAGE_CONTAINER } from '@/pages/page-shell';
import { useClientSession } from '@/pages/_shared/client-session';
import { ClientSwitcher } from '@/pages/_shared/ClientSwitcher';
import type { ClientProposalListRow } from '@/types/saved-queries.generated';
import { decideProposal } from './approval-api';
import { CertificateLink } from '@/pages/_shared/CertificateLink';
import { readCertificateRef } from '@/pages/_shared/signature-certificate';
import { decorateApprovals, formatUsd, waitingCount, type ApprovalRow } from './approval-helpers';

function shortDate(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '—';
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function ApprovalsPage() {
  const { clientId, clientName, isLoading: sessionLoading } = useClientSession();
  const [signing, setSigning] = useState<ApprovalRow | null>(null);
  const [declining, setDeclining] = useState<ApprovalRow | null>(null);
  const [signature, setSignature] = useState('');
  const [comments, setComments] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const proposals = useSavedQueryList('client_proposal_list', {
    input: { clientId },
    enabled: Boolean(clientId),
  });

  const rows = useMemo(
    () => decorateApprovals((proposals.data ?? []) as ClientProposalListRow[]),
    [proposals.data],
  );
  const waiting = waitingCount(rows);

  const closeDialogs = () => {
    setSigning(null);
    setDeclining(null);
    setSignature('');
    setComments('');
    setProblem(null);
  };

  const handleSign = useCallback(async () => {
    if (!signing) return;
    // The typed name IS the signature — an empty one is not an acceptance.
    if (signature.trim().length < 3) {
      setProblem('Type your full name to sign.');
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const { certificateProblem } = await decideProposal(
        signing,
        'accepted',
        `Signed by ${signature.trim()}`,
        signature.trim(),
        clientName,
      );
      proposals.refetch();
      toast.success(`${signing.orderCode} — proposal v${signing.version} accepted`, {
        testId: 'toast-proposal-accepted',
      });
      // The signature stuck; only the certificate did not. Say which.
      if (certificateProblem) {
        setProblem(certificateProblem);
        setBusy(false);
        return;
      }
      closeDialogs();
    } catch (error) {
      setProblem(
        error instanceof Error ? `Could not record your signature: ${error.message}` : 'Could not sign.',
      );
    } finally {
      setBusy(false);
    }
  }, [signing, signature, proposals]);

  const handleDecline = useCallback(async () => {
    if (!declining) return;
    // A decline without a reason costs a round trip to find out why.
    if (comments.trim().length < 5) {
      setProblem('Tell your account team what needs to change.');
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await decideProposal(declining, 'rejected', comments, signature.trim(), clientName);
      proposals.refetch();
      toast.success(`${declining.orderCode} — sent back to your account team`, {
        testId: 'toast-proposal-declined',
      });
      closeDialogs();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not send your response.');
    } finally {
      setBusy(false);
    }
  }, [declining, comments, proposals]);

  if (sessionLoading || proposals.isLoading) {
    return (
      <div className={PAGE_CONTAINER}>
        <Skeleton className="mb-4 h-10 w-64" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }

  return (
    <div className={PAGE_CONTAINER} data-testid="approvals-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-[28px] font-extrabold tracking-[-0.02em] text-foreground">Approvals</h1>
        <ClientSwitcher />
      </div>
      <p className="mt-1 text-[15px] text-muted-foreground">
        {rows.length === 0
          ? `No proposals issued to ${clientName} yet.`
          : waiting === 0
            ? 'Nothing waiting on you. Earlier versions stay listed below.'
            : `${waiting} proposal${waiting === 1 ? '' : 's'} waiting on your signature.`}
      </p>

      {rows.length === 0 ? (
        <div
          className="mt-6 rounded-xl border border-border bg-card px-4 py-10 text-center"
          data-testid="approvals-empty"
        >
          <p className="text-[14px] font-semibold text-foreground">No proposals yet</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            When your account team prices an order, the proposal appears here for signature.
          </p>
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-2">
          {rows.map((row) => (
            <div
              key={row.id}
              data-testid={`approval-row-${row.orderCode}-v${row.version}`}
              data-row-key={`${row.orderCode}-v${row.version}`}
              className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card px-4 py-3.5"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to={`/my-orders/${row.orderId}`}
                    className="text-[13px] font-bold text-foreground underline-offset-2 hover:underline"
                    data-testid={`approval-open-${row.orderCode}`}
                  >
                    {row.orderCode}
                  </Link>
                  <span className="text-[12.5px] text-muted-foreground">v{row.version}</span>
                  <Badge variant={row.awaitingYou ? 'outline' : 'secondary'}>{row.label}</Badge>
                </div>
                <p className="line-clamp-1 text-[13px] text-muted-foreground">{row.brief}</p>
                <p className="text-[11.5px] text-muted-foreground/80">
                  {row.acceptedAt
                    ? `signed ${shortDate(row.acceptedAt)}`
                    : `issued ${shortDate(row.sentAt)}`}
                  {row.pdfName ? ` · ${row.pdfName}` : ''}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-4">
                <div className="text-right">
                  <p className="text-[15px] font-bold tabular-nums text-foreground">
                    {formatUsd(row.totalSell)}
                  </p>
                  <p className="text-[11.5px] text-muted-foreground">{row.currency}</p>
                </div>
                {row.acceptedAt ? (
                  <CertificateLink
                    certificate={readCertificateRef(row.comments)}
                    testId={`view-certificate-${row.orderCode}`}
                  />
                ) : null}
                {row.awaitingYou ? (
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid={`approval-decline-${row.orderCode}`}
                      onClick={() => {
                        setDeclining(row);
                        setProblem(null);
                      }}
                    >
                      Request changes
                    </Button>
                    <Button
                      size="sm"
                      data-testid={`approval-sign-${row.orderCode}`}
                      onClick={() => {
                        setSigning(row);
                        setProblem(null);
                      }}
                    >
                      Sign
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Sign ─────────────────────────────────────────────────────── */}
      <Dialog open={signing !== null} onOpenChange={(open) => !open && closeDialogs()}>
        <DialogContent className="sm:max-w-[480px]" data-testid="approval-sign-dialog">
          <DialogHeader>
            <DialogTitle>Sign proposal</DialogTitle>
            <DialogDescription>
              {signing?.orderCode} · version {signing?.version} ·{' '}
              {signing ? formatUsd(signing.totalSell) : ''}. Signing accepts this price.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor="approval-signature">Type your full name to sign</Label>
            <Input
              id="approval-signature"
              name="signature"
              data-testid="approval-signature-input"
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
              placeholder="Full name"
              aria-invalid={Boolean(problem)}
              aria-describedby={problem ? 'approval-sign-error' : undefined}
            />
            <DialogError id="approval-sign-error" message={problem} />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialogs} disabled={busy}>
              Cancel
            </Button>
            <Button
              data-testid="approval-sign-confirm"
              aria-busy={busy}
              disabled={busy}
              onClick={handleSign}
            >
              Accept &amp; sign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Decline ──────────────────────────────────────────────────── */}
      <Dialog open={declining !== null} onOpenChange={(open) => !open && closeDialogs()}>
        <DialogContent className="sm:max-w-[480px]" data-testid="approval-decline-dialog">
          <DialogHeader>
            <DialogTitle>Request changes</DialogTitle>
            <DialogDescription>
              {declining?.orderCode} — your notes go to your account team, who will re-price and
              issue a new version.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor="approval-comments">What needs to change?</Label>
            <Textarea
              id="approval-comments"
              name="comments"
              data-testid="approval-comments-input"
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              placeholder="Quantity, timing, price…"
              aria-invalid={Boolean(problem)}
              aria-describedby={problem ? 'approval-decline-error' : undefined}
            />
            <DialogError id="approval-decline-error" message={problem} />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialogs} disabled={busy}>
              Cancel
            </Button>
            <Button
              data-testid="approval-decline-confirm"
              aria-busy={busy}
              disabled={busy}
              onClick={handleDecline}
            >
              Send to my team
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default ApprovalsPage;
