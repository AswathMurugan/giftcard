/**
 * The proof viewer — where a client actually looks before signing.
 *
 * Two panes, per the Vista reference: the artwork on a dark ground so the card
 * reads as an object rather than a page element, and the decision beside it
 * with the version history that led here. Signing from the same view as the
 * artwork is the point — a client should never approve something they had to
 * navigate away from to see.
 *
 * On what is shown in the preview: the uploaded proof DOCUMENT is a PDF, and a
 * PDF cannot go in an `<img>`. Where one exists it is offered as a download
 * rather than rendered inline, because doing it properly needs the react-pdf
 * viewer and that is its own screen. Where none exists the card's own DESIGN is
 * shown instead, labelled as the design — the two are not the same thing and
 * conflating them silently would let a client believe they had seen a proof
 * nobody had uploaded.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Textarea } from '@/components/ui/textarea';
import { useDriveFiles } from '@/hooks';
import { DialogError } from '@/pages/_shared/DialogError';
import { CHANGE_REASONS, type ProofRow } from './proof-helpers';

export interface ProofViewerProps {
  proof: ProofRow | null;
  /** The card's own design, when the order detail could supply one. */
  designPreview: string | null;
  busy: boolean;
  problem: string | null;
  onClose: () => void;
  onApprove: (signature: string) => void;
  onRequestChanges: (reason: string, comments: string) => void;
}

/** The version history — every round of this conversation, newest first. */
function VersionHistory({ proof }: { proof: ProofRow }) {
  return (
    <div data-testid="proof-version-history">
      <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
        Version history
      </p>
      <ol className="mt-2 flex flex-col gap-2">
        {proof.versions.map((v) => (
          <li key={v.id} className="flex gap-2.5" data-testid={`proof-version-v${v.round}`}>
            <span
              aria-hidden="true"
              className={[
                'mt-1.5 size-2 shrink-0 rounded-full',
                v.state === 'current' ? 'bg-primary-500' : 'bg-border',
              ].join(' ')}
            />
            <div>
              <p
                className={[
                  'text-[12.5px]',
                  v.state === 'current'
                    ? 'font-bold text-foreground'
                    : 'font-semibold text-muted-foreground',
                ].join(' ')}
              >
                v{v.round} — {v.state}
              </p>
              <p className="text-[11.5px] text-muted-foreground">{v.caption}</p>
              {v.decidedBy ? (
                <p className="text-[11.5px] text-muted-foreground">by {v.decidedBy}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function ProofViewer({
  proof,
  designPreview,
  busy,
  problem,
  onClose,
  onApprove,
  onRequestChanges,
}: ProofViewerProps) {
  const drive = useDriveFiles();
  const [mode, setMode] = useState<'view' | 'sign' | 'changes'>('view');
  const [signature, setSignature] = useState('');
  const [reason, setReason] = useState<string>(CHANGE_REASONS[0]);
  const [comments, setComments] = useState('');
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const urls = useRef<string[]>([]);

  // Object URLs are not garbage-collected; revoke or every opened document
  // stays resident until the tab closes.
  useEffect(
    () => () => {
      for (const u of urls.current) URL.revokeObjectURL(u);
      urls.current = [];
    },
    [],
  );

  // Reset to the viewing state whenever a different proof is opened, so a
  // half-typed signature can never carry across to another round.
  useEffect(() => {
    setMode('view');
    setSignature('');
    setComments('');
    setReason(CHANGE_REASONS[0]);
    setDownloadError(null);
  }, [proof?.id]);

  const openDocument = useCallback(async () => {
    if (!proof?.fileId) return;
    setDownloadError(null);
    try {
      const blob = await drive.download(proof.fileId);
      const url = URL.createObjectURL(blob);
      urls.current.push(url);
      window.open(url, '_blank', 'noopener');
    } catch (error) {
      setDownloadError(
        error instanceof Error
          ? `Could not open the proof: ${error.message}`
          : 'Could not open the proof.',
      );
    }
  }, [proof, drive]);

  if (!proof) return null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="gap-0 p-0 sm:max-w-[56rem]"
        data-testid="proof-viewer"
      >
        <div className="grid md:grid-cols-[1fr_20rem]">
          {/* ── Preview ─────────────────────────────────────────────── */}
          <div className="flex min-h-[20rem] flex-col items-center justify-center gap-3 rounded-l-lg bg-[#1c1c1c] p-6">
            {designPreview ? (
              <>
                <img
                  src={designPreview}
                  alt={`${proof.proofType} artwork`}
                  className="max-h-[15rem] w-auto max-w-full rounded-md shadow-lg"
                  data-testid="proof-preview-image"
                />
                <p className="text-[11.5px] text-white/60">
                  {proof.fileId
                    ? `v${proof.round} · design preview — open the PDF for the exact proof`
                    : `v${proof.round} · design preview`}
                </p>
              </>
            ) : (
              <p
                className="max-w-[16rem] text-center text-[12.5px] text-white/60"
                data-testid="proof-preview-empty"
              >
                No preview available for this round yet.
              </p>
            )}

            {proof.fileId ? (
              <Button
                size="sm"
                variant="outline"
                onClick={openDocument}
                data-testid="proof-open-document"
                className="border-white/25 bg-transparent text-white hover:bg-white/10"
              >
                <i className="icon icon_-Tb_download text-[1.125rem]" aria-hidden="true" />
                Open {proof.fileName ?? 'proof document'}
              </Button>
            ) : (
              <p className="text-[11.5px] text-white/45" data-testid="proof-no-document">
                The proof document has not been uploaded yet.
              </p>
            )}

            {downloadError ? (
              <p role="alert" className="text-[11.5px] text-red-300">
                {downloadError}
              </p>
            ) : null}
          </div>

          {/* ── Decision ────────────────────────────────────────────── */}
          <div className="flex flex-col gap-4 p-5">
            <DialogHeader className="space-y-1 text-left">
              <DialogTitle className="text-[16px] font-bold">
                {proof.proofType} · v{proof.round}
              </DialogTitle>
              <DialogDescription className="text-[12.5px]">
                {proof.orderCode} · uploaded by your account team
              </DialogDescription>
            </DialogHeader>

            {proof.awaitingYou ? (
              <p className="rounded-md bg-primary-50 px-3 py-2 text-[12px] text-foreground">
                Approving releases production — nothing auto-approves.
              </p>
            ) : (
              <Badge variant="secondary" className="w-fit">
                {proof.label}
              </Badge>
            )}

            <VersionHistory proof={proof} />

            {/* ── Actions ───────────────────────────────────────────── */}
            {!proof.awaitingYou ? null : mode === 'view' ? (
              <div className="mt-auto flex flex-col gap-2">
                <Button
                  onClick={() => setMode('sign')}
                  data-testid="proof-begin-sign"
                  className="w-full bg-success-600 text-white hover:bg-success-700"
                >
                  <i className="icon icon_-Tb_writing_sign text-[1.25rem]" aria-hidden="true" />
                  Approve &amp; sign off
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setMode('changes')}
                  data-testid="proof-begin-changes"
                  className="w-full"
                >
                  Request changes
                </Button>
              </div>
            ) : mode === 'sign' ? (
              <div className="mt-auto flex flex-col gap-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="proof-signature">Type your full name to sign</Label>
                  <Input
                    id="proof-signature"
                    name="signature"
                    data-testid="proof-signature-input"
                    value={signature}
                    onChange={(e) => setSignature(e.target.value)}
                    placeholder="Full name"
                    aria-invalid={Boolean(problem)}
                    aria-describedby={problem ? 'proof-sign-error' : undefined}
                  />
                  <DialogError id="proof-sign-error" message={problem} />
                </div>
                <Button
                  onClick={() => onApprove(signature)}
                  aria-busy={busy}
                  disabled={busy}
                  data-testid="proof-sign-confirm"
                  className="w-full bg-success-600 text-white hover:bg-success-700"
                >
                  Confirm sign-off &amp; release
                </Button>
                <Button variant="ghost" onClick={() => setMode('view')} disabled={busy}>
                  Back
                </Button>
              </div>
            ) : (
              <div className="mt-auto flex flex-col gap-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="proof-reason">Reason</Label>
                  <SegmentedControl
                    value={reason}
                    onValueChange={setReason}
                    options={[...CHANGE_REASONS]}
                    size="sm"
                    aria-label="Reason for changes"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="proof-comments">What needs to change?</Label>
                  <Textarea
                    id="proof-comments"
                    name="comments"
                    data-testid="proof-comments-input"
                    value={comments}
                    onChange={(e) => setComments(e.target.value)}
                    placeholder="Colour, artwork, copy…"
                    aria-invalid={Boolean(problem)}
                    aria-describedby={problem ? 'proof-changes-error' : undefined}
                  />
                  <DialogError id="proof-changes-error" message={problem} />
                </div>
                <Button
                  onClick={() => onRequestChanges(reason, comments)}
                  aria-busy={busy}
                  disabled={busy}
                  data-testid="proof-changes-confirm"
                  className="w-full"
                >
                  Send to my team
                </Button>
                <Button variant="ghost" onClick={() => setMode('view')} disabled={busy}>
                  Back
                </Button>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ProofViewer;
