/**
 * Proofing — four proof types, each a chain of versions with an owner.
 *
 * Modelled on the demo's `proofs` array, which carries per type: the current
 * version, a status, WHO the ball is with, whether it is client-facing, and
 * the full version history with a reason on every rejection.
 *
 * The important shape is that a proof is not one approval — it is a LOOP:
 *
 *     not requested ──request──▶ awaiting upload ──supplier──▶ in review
 *          ▲                                                      │
 *          │                                              CS reviews
 *          │                                            ╱          ╲
 *          └──────── changes requested ◀── reject     approve       ╲
 *                        (new version)                               ▼
 *                                                    client-facing? ─┬─ no ──▶ approved
 *                                                                    └─ yes ─▶ awaiting sign
 *                                                                                  │
 *                                                                          client signs ──▶ approved
 *
 * Only the ART proof goes to the client in the demo; data, label and affixing
 * proofs are internal, so approving those completes them outright. Getting
 * that wrong would either send the client a data file they should never see,
 * or hold an internal proof waiting for a signature that is never coming.
 *
 * Stored as `review_request` rows (review_kind `proof`, one per version via
 * `round`) plus a `verdict` per decision — so the history survives, which is
 * the point of keeping versions at all.
 */
import { asNumber, asText } from '@/lib/runtime';

export type ProofStatus =
  | 'not_requested'
  | 'awaiting_upload'
  | 'in_review'
  | 'changes_requested'
  | 'awaiting_sign'
  | 'approved';

/** Whose court the ball is in. */
export type ProofOwner = 'Supplier' | 'CS' | 'Client' | '—';

export interface ProofTypeSpec {
  type: string;
  /** Only a client-facing proof needs a client signature. */
  clientFacing: boolean;
  hint: string;
}

/**
 * The four proofs the demo runs, in its order.
 *
 * Art is the only client-facing one — the client signs off how the card
 * LOOKS. Data (the personalisation file), label and affixing are production
 * checks between us and the supplier.
 */
export const PROOF_TYPES: ProofTypeSpec[] = [
  { type: 'Art proof', clientFacing: true, hint: 'How the card looks — the client signs this off.' },
  { type: 'Data proof', clientFacing: false, hint: 'The personalisation file. Internal.' },
  { type: 'Label proof', clientFacing: false, hint: 'Packaging and labelling. Internal.' },
  { type: 'Affixing proof', clientFacing: false, hint: 'Card affixed to its carrier. Internal.' },
];

/** Display treatment per status, and who is expected to act. */
export const PROOF_UI: Record<ProofStatus, { label: string; owner: ProofOwner; className: string }> =
  {
    not_requested: {
      label: 'Not requested',
      owner: '—',
      className: 'bg-muted text-muted-foreground',
    },
    awaiting_upload: {
      label: 'Awaiting upload',
      owner: 'Supplier',
      className: 'bg-muted text-muted-foreground',
    },
    in_review: { label: 'In review', owner: 'CS', className: 'bg-teal-50 text-teal-700' },
    changes_requested: {
      label: 'Changes requested',
      owner: 'Supplier',
      className: 'bg-warning-50 text-warning-700',
    },
    awaiting_sign: {
      label: 'Awaiting signature',
      owner: 'Client',
      className: 'bg-purple-50 text-purple-600',
    },
    approved: { label: 'Approved', owner: '—', className: 'bg-success-50 text-success-500' },
  };

/**
 * Why a proof was sent back. The demo's own six codes.
 *
 * A rejection without a code is just "no" — the supplier needs to know what
 * to change, and the codes are what make a repeated fault visible across
 * rounds rather than buried in free text.
 */
export const REJECT_CODES: Array<{ code: string; label: string }> = [
  { code: 'logo', label: 'Logo placement' },
  { code: 'color', label: 'Color out of brand' },
  { code: 'prohibited', label: 'Prohibited element' },
  { code: 'legal', label: 'Legal text missing' },
  { code: 'safezone', label: 'Safe-zone / bleed' },
  { code: 'cardart', label: 'Card-art region conflict' },
];

export interface ProofReviewRow {
  id?: string;
  proof_file_id?: string | null;
  proof_file_name?: string | null;
  proof_uploaded_at?: string | null;
  review_kind?: string;
  proof_type?: string;
  round?: number;
  status?: string;
  requested_at?: string;
  due_at?: string | null;
}

export interface ProofVersion {
  reviewId: string;
  round: number;
  status: ProofStatus;
  requestedAt: string | null;
  /** The document this round is an approval of. */
  fileId: string | null;
  fileName: string | null;
}

export interface ProofState {
  type: string;
  clientFacing: boolean;
  hint: string;
  status: ProofStatus;
  owner: ProofOwner;
  /** Current version number; 0 when never requested. */
  round: number;
  versions: ProofVersion[];
  /** The live review row, when one is open. */
  reviewId: string | null;
  /** The current round's document, when one has been uploaded. */
  fileId: string | null;
  fileName: string | null;
}

/** A stored status string → the state machine's vocabulary. */
export function toProofStatus(value: unknown): ProofStatus {
  const raw = asText(value).toLowerCase().replace(/[\s-]/g, '_');
  if (raw === 'approved') return 'approved';
  if (raw === 'changes_requested') return 'changes_requested';
  if (raw === 'awaiting_sign') return 'awaiting_sign';
  if (raw === 'in_review') return 'in_review';
  if (raw === 'awaiting_upload') return 'awaiting_upload';
  // `review_request_create` opens rows as `open`; a freshly requested proof is
  // waiting on the supplier's file.
  return 'awaiting_upload';
}

/**
 * Fold the review rows into one state per proof type.
 *
 * Every type appears, even with no rows: a proof that has not been requested
 * is a real state an operator needs to see, not an absence.
 */
export function buildProofs(reviews: ProofReviewRow[]): ProofState[] {
  const proofRows = reviews.filter((r) => r.review_kind === 'proof');

  return PROOF_TYPES.map((spec) => {
    const mine = proofRows
      .filter((r) => asText(r.proof_type) === spec.type)
      .sort((a, b) => (asNumber(a.round) ?? 0) - (asNumber(b.round) ?? 0));

    const versions: ProofVersion[] = mine.map((r) => ({
      reviewId: asText(r.id),
      round: asNumber(r.round) ?? 0,
      status: toProofStatus(r.status),
      requestedAt: r.requested_at ?? null,
      fileId: r.proof_file_id ?? null,
      fileName: r.proof_file_name ?? null,
    }));

    const latest = versions[versions.length - 1] ?? null;
    const status: ProofStatus = latest ? latest.status : 'not_requested';

    return {
      type: spec.type,
      clientFacing: spec.clientFacing,
      hint: spec.hint,
      status,
      owner: PROOF_UI[status].owner,
      round: latest?.round ?? 0,
      versions,
      // Only an OPEN version can be acted on; an approved or superseded one
      // must not offer buttons that would write against settled history.
      reviewId:
        latest && latest.status !== 'approved' && latest.status !== 'changes_requested'
          ? latest.reviewId
          : null,
      fileId: latest?.fileId ?? null,
      fileName: latest?.fileName ?? null,
    };
  });
}

/**
 * What approving this proof leads to.
 *
 * A client-facing proof is not finished when CS approves it — it goes to the
 * client for signature. An internal one is.
 */
export function statusAfterApproval(proof: ProofState): ProofStatus {
  if (proof.status === 'awaiting_sign') return 'approved';
  return proof.clientFacing ? 'awaiting_sign' : 'approved';
}

/** The action available to CS right now, or null when it is not their move. */
export function nextAction(
  proof: ProofState,
): { kind: 'request' | 'receive' | 'review' | 'sign'; label: string } | null {
  switch (proof.status) {
    case 'not_requested':
      return { kind: 'request', label: `Request ${proof.type.toLowerCase()}` };
    case 'awaiting_upload':
      // Standing in for the supplier's upload, which in production arrives
      // through their portal. The document is the proof — receiving it and
      // putting it in review are one act.
      return { kind: 'receive', label: 'Upload proof document' };
    case 'in_review':
      return { kind: 'review', label: 'Review' };
    case 'awaiting_sign':
      return { kind: 'sign', label: 'Record client signature' };
    default:
      return null;
  }
}

/** Reason text from selected codes plus an optional note. */
export function rejectionReason(codes: string[], note: string): string {
  const labels = codes
    .map((c) => REJECT_CODES.find((r) => r.code === c)?.label)
    .filter(Boolean) as string[];
  const joined = labels.join(', ');
  const trimmed = note.trim();
  if (!joined) return trimmed;
  return trimmed ? `${joined} — ${trimmed}` : joined;
}

/** Every proof settled: the stage's own exit condition. */
export function allProofsApproved(proofs: ProofState[]): boolean {
  const requested = proofs.filter((p) => p.status !== 'not_requested');
  return requested.length > 0 && requested.every((p) => p.status === 'approved');
}
