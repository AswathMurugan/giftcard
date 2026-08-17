/**
 * The order's Activity feed.
 *
 * DERIVED, never logged. Every entry below is a projection of a record that
 * already exists — a stage transition, an RFE's `sent_at`, a quote's
 * `submitted_at`. Nothing here writes an event row.
 *
 * That is a deliberate choice for an audit surface. A parallel `activity`
 * table has to be written by every code path that does something, and the path
 * that forgets is invisible: the feed looks complete and is quietly wrong.
 * A projection cannot drift from the data, because it IS the data — if a quote
 * exists, its event exists.
 *
 * The Quote-stage collection loop is what makes the supplier half of this feed
 * truthful. Before it, a supplier's quote was a silent insert: nothing recorded
 * when the order learned of it and the order's state did not move. Now each
 * response flips `rfe.status` and signals the order, so "Travel Tags quote
 * received" is a real, timestamped moment rather than a row appearing.
 *
 * What is NOT here: nudges and AI-drafted actions. We do not perform them, so
 * inventing entries for them would put fiction in an audit trail.
 */

import { asText } from '@/lib/runtime';

export type ActivityKind =
  | 'created'
  | 'stage'
  | 'rfe_sent'
  | 'quote_received'
  | 'proposal_sent'
  | 'proposal_signed'
  | 'proposal_declined'
  | 'proof_requested'
  | 'proof_uploaded'
  | 'proof_decided';

export interface ActivityEntry {
  /** Stable within a render — source id plus discriminator, never an index. */
  id: string;
  /** ISO timestamp. Entries without one are dropped rather than shown undated. */
  at: string;
  title: string;
  kind: ActivityKind;
}

/* ── Inputs ───────────────────────────────────────────────────────────
   Each mirrors only the fields this module reads. Declared with `unknown`
   for scalars because the generated types describe what Phoenix DECLARES,
   not what it returns. */

export interface HistoryRowLike {
  id?: unknown;
  created_at?: unknown;
  tq_state_definition?: { state?: unknown } | null;
  tq_sub_task_instance?: {
    tq_sub_task_definition?: { name?: unknown } | null;
  } | null;
}

export interface RfeRowLike {
  id?: unknown;
  sent_at?: unknown;
  supplier?: { name?: unknown } | null;
}

export interface QuoteEventRowLike {
  id?: unknown;
  round?: unknown;
  submitted_at?: unknown;
  supplier_quote_no?: unknown;
  rfe?: { supplier?: { name?: unknown } | null } | null;
}

export interface OrderLike {
  created_at?: unknown;
  order_code?: unknown;
  /** The client. Named in the feed so a proposal line reads as a real hand-off. */
  buyer_party_id?: { name?: unknown } | null;
}

export interface ProposalRowLike {
  id?: unknown;
  version?: unknown;
  status?: unknown;
  sent_at?: unknown;
  accepted_at?: unknown;
  loss_reason?: unknown;
  /** Carries "Signed by <name>" plus the certificate pointer. */
  comments?: unknown;
}

export interface ReviewRowLike {
  id?: unknown;
  review_kind?: unknown;
  proof_type?: unknown;
  round?: unknown;
  requested_at?: unknown;
  proof_uploaded_at?: unknown;
  proof_file_name?: unknown;
}

export interface VerdictRowLike {
  id?: unknown;
  decision?: unknown;
  decided_by?: unknown;
  decided_at?: unknown;
  comment?: unknown;
  review_request?: {
    proof_type?: unknown;
    round?: unknown;
    review_kind?: unknown;
  } | null;
}

/**
 * Friendlier wording for the states worth narrating.
 *
 * Only states whose raw name reads badly in a sentence are mapped; everything
 * else falls through to the state name itself. Keeping the fallback means a
 * state added in Phoenix later still appears — as its own name — instead of
 * vanishing from the audit trail because nobody updated this table.
 */
const STATE_PHRASING: Record<string, string> = {
  'order received': 'Order received',
  'order in progress': 'Order intake completed',
  'in design': 'Specification drafting started',
  'in review': 'Specification sent for review',
  rework: 'Specification sent back for rework',
  approved: 'Specifications validated',
  'quote requested': 'Quote requests opened',
  'quotes received': 'All supplier quotes in',
  'deal review': 'Deal review started',
  'deal review completed': 'Deal review completed',
  allocation: 'Allocation started',
  'allocation completed': 'Allocation completed',
  proposal: 'Proposal drafted',
  'proposal completed': 'Proposal issued to client',
  'quote approved': 'Quote approved',
  'award pending': 'Awaiting award',
  awarded: 'Suppliers awarded',
  'in production': 'Production started',
  produced: 'Production completed',
  proofing: 'Proof sent for approval',
  'proof approved': 'Proof approved',
  'ready to ship': 'Ready to ship',
  shipped: 'Shipped',
  billing: 'Billing started',
  billed: 'Invoice raised',
  closing: 'Order closing',
  closed: 'Order closed',
  expired: 'Order expired',
};

function phraseState(state: string, stage: string): string {
  const mapped = STATE_PHRASING[state.toLowerCase()];
  if (mapped) return mapped;
  return stage ? `${stage} — ${state}` : state;
}

/**
 * Pull the signatory's name out of a signed note.
 *
 * Both portals write the same shape — `"Signed by Dana Whitfield [certificate:
 * <id>:<file>.pdf]"` for a proposal, `"Approved by …"` for a proof — where the
 * bracketed part is a machine pointer to the stored certificate, not prose.
 * Stripping it leaves the human sentence, and the leading verb is dropped so
 * the caller can phrase the line however it needs.
 *
 * Returns null rather than a placeholder: a line that invents a signatory is
 * worse in an audit trail than one that simply does not claim one.
 */
export function signatoryFrom(note: unknown): string | null {
  const text = asText(note).replace(/\[certificate:[^\]]*\]/gi, '').trim();
  if (!text) return null;
  const named = /^(?:signed|approved|rejected|declined)\s+by\s+(.+)$/i.exec(text);
  const name = (named ? named[1] : text).trim().replace(/[.,;]+$/, '');
  return name || null;
}

/** "Art proof v2" / "Proof v1" — the document a review or verdict is about. */
function proofLabel(proofType: unknown, round: unknown): string {
  const type = asText(proofType).trim() || 'Proof';
  const n = Number(asText(round));
  return Number.isFinite(n) && n > 0 ? `${type} v${n}` : type;
}

/** A timestamp we can place on a timeline, or null. */
function isoOrNull(value: unknown): string | null {
  const text = asText(value).trim();
  if (!text) return null;
  return Number.isNaN(Date.parse(text)) ? null : text;
}

export interface ActivitySources {
  order?: OrderLike | null;
  history?: HistoryRowLike[];
  rfes?: RfeRowLike[];
  quotes?: QuoteEventRowLike[];
  proposals?: ProposalRowLike[];
  reviews?: ReviewRowLike[];
  verdicts?: VerdictRowLike[];
}

/**
 * Merge every source into one newest-first timeline.
 *
 * Entries with no parseable timestamp are dropped: an audit line that cannot
 * say when is worse than no line, because it still implies a position in the
 * sequence.
 */
export function buildActivity(sources: ActivitySources): ActivityEntry[] {
  const out: ActivityEntry[] = [];

  const createdAt = isoOrNull(sources.order?.created_at);
  if (createdAt) {
    out.push({ id: 'order-created', at: createdAt, kind: 'created', title: 'Order created' });
  }

  for (const row of sources.history ?? []) {
    const at = isoOrNull(row.created_at);
    const state = asText(row.tq_state_definition?.state).trim();
    if (!at || !state) continue;
    const stage = asText(row.tq_sub_task_instance?.tq_sub_task_definition?.name).trim();
    out.push({
      id: `stage-${asText(row.id) || `${stage}-${state}-${at}`}`,
      at,
      kind: 'stage',
      title: phraseState(state, stage),
    });
  }

  for (const row of sources.rfes ?? []) {
    const at = isoOrNull(row.sent_at);
    if (!at) continue;
    const supplier = asText(row.supplier?.name).trim() || 'a supplier';
    out.push({
      id: `rfe-${asText(row.id) || at}`,
      at,
      kind: 'rfe_sent',
      title: `Quote request sent to ${supplier}`,
    });
  }

  for (const row of sources.quotes ?? []) {
    const at = isoOrNull(row.submitted_at);
    if (!at) continue;
    const supplier = asText(row.rfe?.supplier?.name).trim() || 'A supplier';
    const quoteNo = asText(row.supplier_quote_no).trim();
    // The round only earns a mention once there has been more than one, so a
    // first-time quote does not read as bureaucracy.
    const round = Number(asText(row.round));
    const roundNote = Number.isFinite(round) && round > 1 ? ` (round ${round})` : '';
    out.push({
      id: `quote-${asText(row.id) || at}`,
      at,
      kind: 'quote_received',
      title: `${supplier} quote received${quoteNo ? ` — ${quoteNo}` : ''}${roundNote}`,
    });
  }

  /**
   * The client half of the trail.
   *
   * A proposal produces up to TWO entries from one row — issued, then decided —
   * because they are separate moments with separate timestamps, and an audit
   * trail that collapses them loses how long the client took.
   */
  const client = asText(sources.order?.buyer_party_id?.name).trim() || 'the client';
  for (const row of sources.proposals ?? []) {
    const version = Number(asText(row.version));
    const label = Number.isFinite(version) && version > 0 ? `Proposal v${version}` : 'Proposal';
    const rowId = asText(row.id);

    const sentAt = isoOrNull(row.sent_at);
    if (sentAt) {
      out.push({
        id: `proposal-sent-${rowId || sentAt}`,
        at: sentAt,
        kind: 'proposal_sent',
        title: `${label} sent to ${client}`,
      });
    }

    const acceptedAt = isoOrNull(row.accepted_at);
    const status = asText(row.status).toLowerCase();
    if (acceptedAt) {
      const who = signatoryFrom(row.comments);
      out.push({
        id: `proposal-signed-${rowId || acceptedAt}`,
        at: acceptedAt,
        kind: 'proposal_signed',
        title: who
          ? `${client} accepted ${label} — signed by ${who}`
          : `${client} accepted ${label}`,
      });
    } else if (status === 'rejected') {
      // A decline stamps no acceptedAt by design, so it is dated from the note
      // it carries; without one it is dropped rather than shown undated.
      const reason = asText(row.loss_reason).trim();
      out.push({
        id: `proposal-declined-${rowId}`,
        at: '',
        kind: 'proposal_declined',
        title: `${client} declined ${label}${reason ? ` — ${reason.replace(/_/g, ' ')}` : ''}`,
      });
    }
  }

  /**
   * Proof rounds. Only CLIENT-facing proofs are narrated: a `deal_review`
   * review_request is an internal margin check that the stage transitions
   * already cover, and repeating it here would double every deal review.
   */
  for (const row of sources.reviews ?? []) {
    if (asText(row.review_kind).toLowerCase() !== 'proof') continue;
    const label = proofLabel(row.proof_type, row.round);
    const rowId = asText(row.id);

    const requestedAt = isoOrNull(row.requested_at);
    if (requestedAt) {
      out.push({
        id: `proof-req-${rowId || requestedAt}`,
        at: requestedAt,
        kind: 'proof_requested',
        title: `${label} requested from the supplier`,
      });
    }

    const uploadedAt = isoOrNull(row.proof_uploaded_at);
    if (uploadedAt) {
      const file = asText(row.proof_file_name).trim();
      out.push({
        id: `proof-up-${rowId || uploadedAt}`,
        at: uploadedAt,
        kind: 'proof_uploaded',
        title: `${label} uploaded${file ? ` — ${file}` : ''}`,
      });
    }
  }

  for (const row of sources.verdicts ?? []) {
    const at = isoOrNull(row.decided_at);
    if (!at) continue;
    // A deal_review verdict is the internal margin sign-off; the Quote stage
    // states already narrate it, so only proof verdicts appear here.
    if (asText(row.review_request?.review_kind).toLowerCase() !== 'proof') continue;
    const label = proofLabel(row.review_request?.proof_type, row.review_request?.round);
    const who = signatoryFrom(row.comment) ?? asText(row.decided_by).trim();
    const approved = asText(row.decision).toLowerCase().startsWith('approve');
    const verb = approved ? 'approved' : 'requested changes to';
    out.push({
      id: `verdict-${asText(row.id) || at}`,
      at,
      kind: 'proof_decided',
      title: who ? `${who} ${verb} ${label}` : `${label} ${approved ? 'approved' : 'sent back'}`,
    });
  }

  return out
    // An undated entry still implies a position in the sequence, so it is
    // dropped rather than floated to one end.
    .filter((e) => e.at && !Number.isNaN(Date.parse(e.at)))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/**
 * Narrow the `order_activity_feed` composite into the shape `buildActivity`
 * takes.
 *
 * A `multi_query` is emitted as `unknown` by codegen — composite shapes aren't
 * typed — so this is the one place that decides what the response means, and
 * it assumes nothing. Every key is checked for being an array before it is
 * used: a sub-query that errored server-side leaves its key missing or holding
 * an error object, and `buildActivity` would throw on `.filter` of a non-array
 * inside a render.
 *
 * A missing key degrades to an empty list rather than failing the whole rail:
 * losing the supplier rows should not also lose the stage trail.
 */
export function activitySourcesFromFeed(data: unknown): ActivitySources {
  if (!data || typeof data !== 'object') return {};
  const feed = data as Record<string, unknown>;
  const list = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
  const order = feed.order;
  return {
    order: order && typeof order === 'object' ? (order as OrderLike) : null,
    history: list<HistoryRowLike>(feed.history),
    rfes: list<RfeRowLike>(feed.rfes),
    quotes: list<QuoteEventRowLike>(feed.quotes),
    proposals: list<ProposalRowLike>(feed.proposals),
    reviews: list<ReviewRowLike>(feed.reviews),
    verdicts: list<VerdictRowLike>(feed.verdicts),
  };
}

/**
 * "3h ago" / "2d ago", matching the feed in the design.
 *
 * `now` is a parameter rather than a `Date.now()` call so the output is
 * testable without freezing time.
 */
export function relativeTime(iso: string, now: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

/** Nucleo glyph per entry kind — verified against the font CSS. */
export const ACTIVITY_ICON: Record<ActivityKind, string> = {
  created: 'icon_-Tb_user',
  stage: 'icon_-Tb_circle_check',
  rfe_sent: 'icon_-Tb_send',
  quote_received: 'icon_-Tb_mail',
  proposal_sent: 'icon_-Tb_file_text',
  proposal_signed: 'icon_-Tb_signature',
  proposal_declined: 'icon_-Tb_alert_triangle',
  proof_requested: 'icon_-Tb_eye',
  proof_uploaded: 'icon_-Tb_upload',
  proof_decided: 'icon_-Tb_signature',
};
