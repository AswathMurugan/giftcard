/**
 * Proofing — four proof types, each looping until it is signed off.
 *
 * Follows the demo: a proof shows its current version, its status, WHO the
 * ball is with, and its full version history with the reason on every
 * rejection. Sending one back demands reason codes, because "no" without a
 * fault is not something a supplier can act on.
 *
 * The business rule this panel exists to enforce: only the ART proof goes to
 * the client. Approving it means "fit to show", not "done" — the client still
 * signs. The data, label and affixing proofs are internal and complete on CS
 * approval.
 *
 * The DOCUMENT is the proof. There is nothing to review until a file exists,
 * so the upload is the transition into review — the file lands in Jiffy Drive
 * and its id is stored on the ROUND, so every version keeps the artefact it
 * was judged on and a rejected v1 can still be opened after v2 supersedes it.
 */
import { Suspense, lazy, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useDriveFiles } from '@/hooks';
import {
  PROOF_UI,
  REJECT_CODES,
  nextAction,
  rejectionReason,
  type ProofState,
} from './proof-helpers';

const PdfPane = lazy(() =>
  import('@/components/shared/PdfPane').then((m) => ({ default: m.PdfPane })),
);

/**
 * Where proof documents live.
 *
 * APPS scope with a three-year retention: a proof is the evidence of what the
 * client and the supplier agreed the card would look like, so it has to
 * outlive the order rather than expire with a temp policy.
 */
const PROOF_SCOPE = 'APPS' as const;
const PROOF_RETENTION = 'BUSINESS_3_YEAR' as const;

/** A proof type as a DOM-safe id fragment. */
function slug(type: string): string {
  return type.replace(/\s+/g, '-').toLowerCase();
}

function isPdf(name: string | null): boolean {
  return (name ?? '').toLowerCase().endsWith('.pdf');
}

function isImage(name: string | null): boolean {
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(name ?? '');
}

export function ProofPanel({
  proofs,
  live,
  busy,
  onRequest,
  onUpload,
  onApprove,
  onReject,
}: {
  proofs: ProofState[];
  /** False past the Proof stage: a record, not a workbench. */
  live: boolean;
  busy: boolean;
  onRequest: (proof: ProofState) => Promise<void>;
  /** The Drive upload has already happened; this records it on the round. */
  onUpload: (proof: ProofState, file: { fileId: string; fileName: string }) => Promise<void>;
  onApprove: (proof: ProofState) => Promise<void>;
  onReject: (proof: ProofState, reason: string) => Promise<void>;
}) {
  const drive = useDriveFiles();
  const [rejecting, setRejecting] = useState<ProofState | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [note, setNote] = useState('');

  /** Which proof type is mid-upload — the rows upload independently. */
  const [uploadingType, setUploadingType] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  /** The document being looked at. */
  const [viewing, setViewing] = useState<ProofState | null>(null);
  const [docUrl, setDocUrl] = useState<string | null>(null);
  const [docError, setDocError] = useState<string | null>(null);

  useEffect(() => {
    // The object URL holds the blob alive; leaking one per open would keep
    // every proof ever viewed in memory for the life of the page.
    return () => {
      if (docUrl) URL.revokeObjectURL(docUrl);
    };
  }, [docUrl]);

  function toggleCode(code: string) {
    setCodes((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  }

  async function confirmReject() {
    if (!rejecting) return;
    await onReject(rejecting, rejectionReason(codes, note));
    setRejecting(null);
    setCodes([]);
    setNote('');
  }

  async function handleFile(proof: ProofState, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Cleared immediately so picking the SAME file twice still fires `change`.
    e.target.value = '';
    if (!file) return;

    setUploadingType(proof.type);
    setUploadError(null);
    try {
      const result = await drive.upload(file, {
        scope: PROOF_SCOPE,
        retentionPolicy: PROOF_RETENTION,
        classification: 'CONFIDENTIAL',
        preserveFilename: true,
        // Foldered by proof type so the four chains stay separable in Drive
        // itself, not only through the database rows.
        folderPath: `proofs/${slug(proof.type)}`,
      });
      await onUpload(proof, { fileId: result.file_id, fileName: file.name });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploadingType(null);
    }
  }

  async function openDocument(proof: ProofState) {
    if (!proof.fileId) return;
    setViewing(proof);
    setDocError(null);
    setDocUrl(null);
    try {
      // Downloaded to a blob rather than opened from a presigned S3 URL:
      // react-pdf's fetch is CORS-blocked against S3.
      const blob = await drive.download(proof.fileId);
      setDocUrl(URL.createObjectURL(blob));
    } catch (err) {
      setDocError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="flex flex-col gap-2" data-testid="proof-panel">
      {proofs.map((proof) => {
        const ui = PROOF_UI[proof.status];
        const action = live ? nextAction(proof) : null;
        const uploading = uploadingType === proof.type;
        return (
          <div
            key={proof.type}
            className="rounded-lg border border-border p-3"
            data-testid={`proof-${proof.type}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-semibold text-foreground">{proof.type}</span>
              {proof.round > 0 ? (
                <span className="text-[12px] text-muted-foreground">v{proof.round}</span>
              ) : null}
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${ui.className}`}
                data-testid={`proof-status-${proof.type}`}
              >
                {ui.label}
              </span>
              {/* Whose move it is — the single most useful fact when four
                  proofs are in flight at once. */}
              {ui.owner !== '—' ? (
                <span className="text-[11.5px] text-muted-foreground">with {ui.owner}</span>
              ) : null}
              {proof.clientFacing ? (
                <span className="rounded-full bg-purple-50 px-2 py-0.5 text-[10px] font-bold uppercase text-purple-600">
                  Client-facing
                </span>
              ) : null}

              <span className="ml-auto flex flex-wrap items-center gap-1.5">
                {/* Viewable whether or not the stage is live: a settled proof
                    still has to be producible as evidence. */}
                {proof.fileId ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    data-testid={`proof-view-${proof.type}`}
                    onClick={() => void openDocument(proof)}
                  >
                    <i className="icon icon_-Tb_file_text mr-1 text-[1.125rem]" aria-hidden="true" />
                    View document
                  </Button>
                ) : null}

                {action?.kind === 'review' ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || !proof.fileId}
                      data-testid={`proof-reject-${proof.type}`}
                      onClick={() => setRejecting(proof)}
                    >
                      Request changes
                    </Button>
                    <Button
                      size="sm"
                      // Nothing to judge without the artefact. A round can
                      // only reach review through an upload, but a row put
                      // into review by anything else must not be approvable —
                      // an approval that points at no document is a signature
                      // on a blank page.
                      disabled={busy || !proof.fileId}
                      data-testid={`proof-approve-${proof.type}`}
                      onClick={() => void onApprove(proof)}
                      title={
                        !proof.fileId
                          ? 'No document attached to this round'
                          : proof.clientFacing
                            ? 'Approve and send to the client for signature'
                            : 'Approve — this proof is internal, so it completes here'
                      }
                    >
                      Approve
                    </Button>
                  </>
                ) : action?.kind === 'receive' ? (
                  // Nothing to review until a document exists, so the upload
                  // IS the transition — there is no separate "mark received".
                  //
                  // The input belongs to THIS row and the label opens it. A
                  // single shared input driven by `input.click()` would work
                  // for a person and be untestable — nothing but a real click
                  // can set a file on it, and the handler could not tell which
                  // of the four rows the file was for.
                  <>
                    <input
                      id={`proof-file-${slug(proof.type)}`}
                      type="file"
                      name={`proofDocument-${slug(proof.type)}`}
                      data-testid={`proof-file-input-${proof.type}`}
                      className="sr-only"
                      accept=".pdf,.png,.jpg,.jpeg,.svg,.ai,.eps,.csv,.txt"
                      disabled={busy || uploading}
                      onChange={(e) => void handleFile(proof, e)}
                    />
                    <Button
                      size="sm"
                      asChild
                      aria-busy={uploading}
                      data-testid={`proof-upload-${proof.type}`}
                    >
                      <label htmlFor={`proof-file-${slug(proof.type)}`} className="cursor-pointer">
                        <i
                          className="icon icon_-Tb_upload mr-1 text-[1.125rem]"
                          aria-hidden="true"
                        />
                        {uploading ? `Uploading ${drive.progress}%` : action.label}
                      </label>
                    </Button>
                  </>
                ) : action ? (
                  <Button
                    size="sm"
                    variant={action.kind === 'request' ? 'outline' : 'default'}
                    disabled={busy}
                    data-testid={`proof-action-${proof.type}`}
                    onClick={() => {
                      if (action.kind === 'request') void onRequest(proof);
                      else void onApprove(proof);
                    }}
                  >
                    {action.label}
                  </Button>
                ) : null}
              </span>
            </div>

            <p className="mt-0.5 text-[11.5px] text-muted-foreground">{proof.hint}</p>

            {proof.fileName ? (
              <p
                className="mt-1 text-[11.5px] text-muted-foreground"
                data-testid={`proof-file-${proof.type}`}
              >
                <i className="icon icon_-Tb_paperclip mr-1 text-[1.125rem]" aria-hidden="true" />
                {proof.fileName}
              </p>
            ) : null}

            {/* Every round kept, so a fault repeated across versions is
                visible rather than overwritten. */}
            {proof.versions.length > 1 ? (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {proof.versions.map((v) => (
                  <span
                    key={v.reviewId}
                    className={`rounded-full px-2 py-0.5 text-[10.5px] ${PROOF_UI[v.status].className}`}
                    data-testid={`proof-version-${proof.type}-${v.round}`}
                  >
                    v{v.round} · {PROOF_UI[v.status].label}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}

      {uploadError ? (
        <p className="text-[12.5px] text-destructive" role="alert" data-testid="proof-upload-error">
          Upload failed: {uploadError}
        </p>
      ) : null}

      {/* ── The document ───────────────────────────────────────────────── */}
      <Dialog
        open={Boolean(viewing)}
        onOpenChange={(open) => {
          if (!open) {
            if (docUrl) URL.revokeObjectURL(docUrl);
            setDocUrl(null);
            setDocError(null);
            setViewing(null);
          }
        }}
      >
        <DialogContent
          className="flex h-[85vh] flex-col sm:max-w-[56rem]"
          data-testid="proof-document-dialog"
        >
          <DialogHeader>
            <DialogTitle>
              {viewing?.type} v{viewing?.round}
            </DialogTitle>
            <DialogDescription>{viewing?.fileName ?? 'Proof document'}</DialogDescription>
          </DialogHeader>
          {docError ? (
            <p className="text-[13px] text-destructive" role="alert">
              Could not open the document: {docError}
            </p>
          ) : !docUrl ? (
            <div className="grid flex-1 place-items-center" role="status" aria-busy="true">
              <Spinner />
            </div>
          ) : isPdf(viewing?.fileName ?? null) ? (
            <Suspense
              fallback={
                <div className="grid flex-1 place-items-center">
                  <Spinner />
                </div>
              }
            >
              <PdfPane
                url={docUrl}
                name={viewing?.fileName ?? 'proof.pdf'}
                rootClassName="flex flex-1 min-h-0 flex-col"
              />
            </Suspense>
          ) : isImage(viewing?.fileName ?? null) ? (
            <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-white p-2">
              <img
                src={docUrl}
                alt={viewing?.fileName ?? 'Proof'}
                className="mx-auto max-w-full"
                data-testid="proof-document-image"
              />
            </div>
          ) : (
            // Artwork sources (.ai/.eps) and data files have no in-browser
            // renderer — offering the bytes is more honest than a blank frame.
            <div className="flex flex-1 flex-col items-center justify-center gap-2">
              <p className="text-[13px] text-muted-foreground">
                This file type cannot be previewed in the browser.
              </p>
              <a
                href={docUrl}
                download={viewing?.fileName ?? 'proof'}
                className="text-[13px] font-semibold text-primary underline"
                data-testid="proof-document-download"
              >
                Download {viewing?.fileName}
              </a>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Sending one back ───────────────────────────────────────────── */}
      <Dialog
        open={Boolean(rejecting)}
        onOpenChange={(open) => {
          if (!open) {
            setRejecting(null);
            setCodes([]);
            setNote('');
          }
        }}
      >
        <DialogContent className="sm:max-w-[30rem]" data-testid="proof-reject-dialog">
          <DialogHeader>
            <DialogTitle>Send {rejecting?.type.toLowerCase()} back</DialogTitle>
            <DialogDescription>
              Pick what is wrong. The supplier gets these codes and re-uploads as v
              {(rejecting?.round ?? 0) + 1}.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap gap-1.5">
            {REJECT_CODES.map((c) => (
              <button
                key={c.code}
                type="button"
                data-testid={`reject-code-${c.code}`}
                aria-pressed={codes.includes(c.code)}
                onClick={() => toggleCode(c.code)}
                className={`rounded-full border px-2.5 py-1 text-[12px] ${
                  codes.includes(c.code)
                    ? 'border-primary-300 bg-primary-50 font-semibold text-foreground'
                    : 'border-border bg-card text-muted-foreground'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="reject-note" className="text-[12px] text-muted-foreground">
              Note (optional)
            </label>
            <Input
              id="reject-note"
              name="rejectNote"
              data-testid="reject-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-2">
            <Button
              data-testid="confirm-reject"
              onClick={() => void confirmReject()}
              aria-busy={busy}
              // A rejection with no fault named is not actionable, so it is
              // not allowed — the same rule as a margin override's reason.
              disabled={busy || codes.length === 0}
              title={codes.length === 0 ? 'Pick at least one reason' : 'Send back to the supplier'}
            >
              Send back to supplier
            </Button>
            <Button variant="outline" onClick={() => setRejecting(null)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default ProofPanel;
