/**
 * Which proofs a client can act on, and what happened to the earlier rounds.
 *
 * A proof is a conversation, not a document: round 1 goes out, the client asks
 * for a change, round 2 replaces it. The viewer has to show that history, so
 * rounds are grouped into conversations keyed on (order, proof type) and each
 * superseded round is captioned from the decision that ended it.
 *
 * Pure functions, no DOM — the vitest environment here is `node`.
 */
import { asText, asNumber } from '@/lib/runtime';
import type {
  ClientProofListRow,
  ClientProofRound,
  ClientProofVerdict,
} from '@/types/saved-queries.generated';

/** The reasons a client picks from when rejecting a round. */
export const CHANGE_REASONS = [
  'Colour / finish',
  'Logo or artwork',
  'Text / copy',
  'Layout / bleed',
  'Other',
] as const;

/**
 * `review_request` covers more than client sign-off.
 *
 * `deal_review` rows are Fiserv's INTERNAL margin check — they live on the
 * same entity and would otherwise appear on the client's screen, showing them
 * a review of their own deal. Only `proof` rounds belong here.
 */
export const CLIENT_VISIBLE_KIND = 'proof';

/** Statuses that mean the client has already answered this round. */
const DECIDED = new Set(['approved', 'rejected', 'cancelled']);

export interface ProofVersion {
  id: string;
  round: number;
  /** current — the live round · superseded — replaced by a later one. */
  state: 'current' | 'superseded';
  /** "Today · awaiting your approval", "Jun 19 · you requested changes". */
  caption: string;
  decidedAt: string | null;
  decidedBy: string | null;
}

export interface ProofRow {
  id: string;
  /** The demand order, so a decided round can link to its decision log. */
  orderId: string;
  orderCode: string;
  brief: string;
  proofType: string;
  round: number;
  status: string;
  requestedAt: string | null;
  fileName: string | null;
  /** The stored proof document, when one has been uploaded. */
  fileId: string | null;
  uploadedAt: string | null;
  /** The order's workflow instance — approving signals it. */
  instanceId: string | null;
  awaitingYou: boolean;
  label: string;
  /** Every round of this conversation, newest first. */
  versions: ProofVersion[];
}

function labelFor(status: string, awaiting: boolean): string {
  if (awaiting) return 'Awaiting your sign-off';
  switch (status) {
    case 'approved':
      return 'Approved';
    case 'rejected':
      return 'Changes requested';
    case 'cancelled':
      return 'Withdrawn';
    default:
      return status ? status : 'In progress';
  }
}

/** "Jun 19" — short enough for a history row, and "Today" when it is. */
export function historyDate(iso: string | null, today: string): string {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '—';
  if (iso.slice(0, 10) === today.slice(0, 10)) return 'Today';
  return new Date(ms).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * What ended a superseded round, in the client's own terms.
 *
 * Phrased from their side — "you requested changes", not "rejected" — because
 * this history is shown to the person who made the decision. When no verdict
 * was recorded (rounds decided before the audit trail existed) it falls back
 * to the round's status rather than inventing a reason.
 */
export function versionCaption(
  round: ClientProofRound,
  verdict: ClientProofVerdict | undefined,
  isCurrent: boolean,
  today: string,
): string {
  const when = historyDate(verdict?.decided_at ?? round.requested_at ?? null, today);
  if (isCurrent) {
    const status = asText(round.status).toLowerCase();
    if (status === 'approved') return `${when} · approved by you`;
    if (status === 'rejected') return `${when} · you requested changes`;
    return `${when} · awaiting your approval`;
  }
  const decision = asText(verdict?.decision).toLowerCase();
  if (decision === 'reject') return `${when} · you requested changes`;
  if (decision === 'approve') return `${when} · approved by you`;
  const status = asText(round.status).toLowerCase();
  if (status === 'rejected') return `${when} · you requested changes`;
  if (status === 'approved') return `${when} · approved by you`;
  return (asNumber(round.round) ?? 1) === 1 ? `${when} · first draft` : `${when} · superseded`;
}

/**
 * Group the rounds into conversations and decorate the live one.
 *
 * Only the HIGHEST round of each (order, proof type) is returned as a row —
 * the earlier ones become its `versions`. Listing every round as its own row
 * is what the first version did, and it made a three-round conversation look
 * like three separate outstanding jobs.
 */
export function decorateProofs(packet: ClientProofListRow | null): ProofRow[] {
  const rounds = (packet?.proofs ?? []).filter(
    (r) => r.id && asText(r.review_kind) === CLIENT_VISIBLE_KIND,
  );

  // Verdicts by the round they decided, so a caption can name what happened.
  const verdictByRound = new Map<string, ClientProofVerdict>();
  for (const v of packet?.verdicts ?? []) {
    const rid = v.review_request?.id;
    if (!rid) continue;
    // Last decision wins — a round re-decided keeps its latest answer.
    verdictByRound.set(rid, v);
  }

  // One bucket per conversation.
  const groups = new Map<string, ClientProofRound[]>();
  for (const r of rounds) {
    const key = `${r.subject_order?.id ?? ''}::${asText(r.proof_type)}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(r);
    else groups.set(key, [r]);
  }

  const today = new Date().toISOString().slice(0, 10);

  const out: ProofRow[] = [];
  for (const bucket of groups.values()) {
    const ordered = [...bucket].sort(
      (a, b) => (asNumber(b.round) ?? 0) - (asNumber(a.round) ?? 0),
    );
    const live = ordered[0];
    const status = asText(live.status).toLowerCase();
    const awaitingYou = !DECIDED.has(status);

    out.push({
      id: live.id as string,
      orderId: live.subject_order?.id ?? '',
      orderCode: asText(live.subject_order?.order_code) || '—',
      brief: asText(live.subject_order?.order_brief) || 'No description',
      proofType: asText(live.proof_type) || 'Proof',
      round: asNumber(live.round) ?? 1,
      status,
      requestedAt: live.requested_at ?? null,
      fileName: live.proof_file_name ?? null,
      fileId: live.proof_file_id ?? null,
      uploadedAt: live.proof_uploaded_at ?? null,
      instanceId: live.subject_order?.tq_instance?.id ?? null,
      awaitingYou,
      label: labelFor(status, awaitingYou),
      versions: ordered.map((r, i) => ({
        id: r.id as string,
        round: asNumber(r.round) ?? 1,
        state: i === 0 ? 'current' : 'superseded',
        caption: versionCaption(r, verdictByRound.get(r.id as string), i === 0, today),
        decidedAt: verdictByRound.get(r.id as string)?.decided_at ?? null,
        decidedBy: verdictByRound.get(r.id as string)?.decided_by ?? null,
      })),
    });
  }

  return out.sort((a, b) => {
    // Work first, then newest conversation.
    if (a.awaitingYou !== b.awaitingYou) return a.awaitingYou ? -1 : 1;
    return (b.requestedAt ?? '').localeCompare(a.requestedAt ?? '');
  });
}

/** How many conversations are waiting on the client right now. */
export function waitingCount(rows: ProofRow[]): number {
  return rows.filter((r) => r.awaitingYou).length;
}
