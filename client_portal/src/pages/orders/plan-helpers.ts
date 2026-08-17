/**
 * The schedule — what was promised, and what actually happened.
 *
 * The plan is deliberately NOT the stage rail. The rail says where the order
 * is; the plan says when each commitment was due and whether it landed. An
 * order can sit happily at Produce while being three days late on a proof
 * approval the CLIENT owed us, and only the plan can say so.
 *
 * Three rules carried over from the domain model (B6 Plan), each of which
 * changes what the screen is worth:
 *
 *  1. **Targets are back-calculated from the in-hands date.** Every template
 *     row is an offset in days BEFORE delivery — D-50, D-38, D-0 — so moving
 *     the delivery date moves the whole plan rather than orphaning it.
 *  2. **Padding is visible.** A buffer folded into the offset is a lie you
 *     can't remove later; held as its own column, an operator can see that a
 *     date is two days earlier than strictly necessary and decide to spend it.
 *  3. **Actuals are stamped from events, never typed.** A milestone's actual
 *     date comes from the row that proves it — the verdict on a proof, the
 *     supply order, the despatch. Nobody can mark a milestone met that did
 *     not happen, and a closed order's history is the record itself.
 */
import { asNumber, asText } from '@/lib/runtime';

export type MilestoneStatus = 'pending' | 'met' | 'late' | 'missed' | 'na';

/** A row of the client's plan template. */
export interface PlanTemplateRow {
  id?: string;
  milestone_type?: string;
  sequence?: number;
  /** Days BEFORE the in-hands date. */
  offset_days?: number;
  pad_days?: number;
  owner_role?: string;
  client_obligation?: boolean;
  template?: { id?: string; name?: string; client?: { id?: string; name?: string } | null } | null;
}

export interface PlanRow {
  id?: string;
  status?: string;
  published_to_client?: boolean;
  anchor_date?: string | null;
  created_at?: string | null;
  template?: { id?: string; name?: string } | null;
  subject_order?: { id?: string; order_code?: string } | null;
}

export interface PlanItemRow {
  id?: string;
  milestone_type?: string;
  sequence?: number;
  target_date?: string | null;
  actual_date?: string | null;
  status?: string;
  owner_role?: string;
  owner_name?: string | null;
  /** template = the client-facing set; added = raised by hand on this order. */
  origin?: string | null;
  client_obligation?: boolean;
  pad_days?: number;
  note?: string | null;
  plan?: { id?: string } | null;
}

export interface OrderPlanGrid {
  plan?: PlanRow[];
  items?: PlanItemRow[];
  template_rows?: PlanTemplateRow[];
}

/* ── Dates ────────────────────────────────────────────────────────────── */

/**
 * Date-only arithmetic in UTC.
 *
 * `new Date('2026-08-31')` parses as UTC midnight but `getDate()` reads it in
 * local time, so a naive implementation shifts every target by a day for
 * anyone west of Greenwich. Everything here stays in UTC and returns the same
 * `YYYY-MM-DD` shape the column stores.
 */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  const t = Date.UTC(y, (m ?? 1) - 1, d ?? 1) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b`; negative when `b` is earlier. */
export function daysBetween(a: string, b: string): number {
  const parse = (s: string) => {
    const [y, m, d] = s.slice(0, 10).split('-').map(Number);
    return Date.UTC(y, (m ?? 1) - 1, d ?? 1);
  };
  return Math.round((parse(b) - parse(a)) / 86_400_000);
}

/** The date part of a timestamp, or null. Events arrive as ISO datetimes. */
export function dateOf(value: unknown): string | null {
  const raw = asText(value);
  return raw ? raw.slice(0, 10) : null;
}

/* ── Applying a template ──────────────────────────────────────────────── */

export interface PlannedMilestone {
  milestoneType: string;
  sequence: number;
  targetDate: string;
  ownerRole: string;
  clientObligation: boolean;
  padDays: number;
}

/**
 * Back-calculate a template into dated milestones.
 *
 * Padding pulls the target EARLIER (`anchor − offset − pad`): a buffer exists
 * so the thing is asked for before it is strictly needed. It stays on the item
 * so the screen can show "D-34 · +2d pad" rather than an unexplained date.
 */
export function planFromTemplate(rows: PlanTemplateRow[], anchorDate: string): PlannedMilestone[] {
  return rows
    .filter((r) => asText(r.milestone_type))
    .map((r) => {
      const offset = asNumber(r.offset_days) ?? 0;
      const pad = asNumber(r.pad_days) ?? 0;
      return {
        milestoneType: asText(r.milestone_type),
        sequence: asNumber(r.sequence) ?? 0,
        targetDate: addDays(anchorDate, -(offset + pad)),
        ownerRole: asText(r.owner_role) || 'cs',
        clientObligation: r.client_obligation === true,
        padDays: pad,
      };
    })
    .sort((a, b) => a.sequence - b.sequence);
}

/** Rows of the template that applies — the client's own, else the fallback. */
export function templateFor(
  rows: PlanTemplateRow[],
  clientId: string | null,
): PlanTemplateRow[] {
  const mine = rows.filter((r) => r.template?.client?.id && r.template.client.id === clientId);
  if (mine.length > 0) return mine;
  // No client-specific template: the tenant-wide one (no client set).
  const fallback = rows.filter((r) => !r.template?.client?.id);
  if (fallback.length > 0) return fallback;
  return rows;
}

/* ── Status ───────────────────────────────────────────────────────────── */

/**
 * What a milestone's status IS, from its dates.
 *
 * Stored as well as derived: a closed order must keep the verdict it earned
 * rather than have every past milestone silently re-read as late. But the
 * screen derives it live so a target passing today is visible without a write.
 */
export function milestoneStatus(
  targetDate: string | null,
  actualDate: string | null,
  today: string,
): MilestoneStatus {
  if (!targetDate) return 'na';
  if (actualDate) return daysBetween(targetDate, actualDate) > 0 ? 'late' : 'met';
  return daysBetween(today, targetDate) < 0 ? 'missed' : 'pending';
}

export const MILESTONE_UI: Record<MilestoneStatus, { label: string; className: string }> = {
  met: { label: 'Met', className: 'bg-success-50 text-success-500' },
  late: { label: 'Late', className: 'bg-warning-50 text-warning-700' },
  missed: { label: 'Overdue', className: 'bg-destructive/10 text-destructive' },
  pending: { label: 'Pending', className: 'bg-muted text-muted-foreground' },
  na: { label: '—', className: 'bg-muted text-muted-foreground' },
};

export const OWNER_LABEL: Record<string, string> = {
  cs: 'CS',
  client: 'Client',
  supplier: 'Supplier',
};

/** One milestone as the card renders it. */
export interface MilestoneView {
  id: string;
  milestoneType: string;
  sequence: number;
  targetDate: string | null;
  actualDate: string | null;
  status: MilestoneStatus;
  ownerRole: string;
  clientObligation: boolean;
  padDays: number;
  note: string | null;
  ownerName: string | null;
  /** template | added — only template rows form the published schedule. */
  origin: string;
  /** Days before delivery, for the D-nn label. Null without an anchor. */
  offsetLabel: string | null;
  /** Days until target, for a pending milestone. Negative when overdue. */
  daysToTarget: number | null;
}

/**
 * Sorted by DATE, not by stored sequence.
 *
 * Both tables are read as timelines, and a milestone added by hand for the
 * 20th has to appear between the 14th and the 22nd — not at the bottom because
 * it was created last. Sequence only breaks ties between two milestones on the
 * same day, where the template's own order is the better answer.
 */
export function milestoneViews(
  items: PlanItemRow[],
  anchorDate: string | null,
  today: string,
): MilestoneView[] {
  return [...items]
    .sort((a, b) => {
      const at = a.target_date?.slice(0, 10) ?? '';
      const bt = b.target_date?.slice(0, 10) ?? '';
      // A milestone with no date has nowhere to sit on a timeline; it goes last.
      if (at !== bt) return at && bt ? at.localeCompare(bt) : at ? -1 : 1;
      return (asNumber(a.sequence) ?? 0) - (asNumber(b.sequence) ?? 0);
    })
    .map((i) => {
      const target = i.target_date ? i.target_date.slice(0, 10) : null;
      const actual = i.actual_date ? i.actual_date.slice(0, 10) : null;
      return {
        id: asText(i.id),
        milestoneType: asText(i.milestone_type),
        sequence: asNumber(i.sequence) ?? 0,
        targetDate: target,
        actualDate: actual,
        status: milestoneStatus(target, actual, today),
        ownerRole: asText(i.owner_role) || 'cs',
        clientObligation: i.client_obligation === true,
        padDays: asNumber(i.pad_days) ?? 0,
        note: i.note ?? null,
        ownerName: i.owner_name ?? null,
        // Rows written before `origin` existed are template rows: that is all
        // there was until ad-hoc milestones could be added.
        origin: asText(i.origin) || 'template',
        offsetLabel: anchorDate && target ? `D-${Math.max(0, daysBetween(target, anchorDate))}` : null,
        daysToTarget: target ? daysBetween(today, target) : null,
      };
    });
}

/** The one line worth putting in a collapsed card header. */
export function planSummary(views: MilestoneView[], today: string): string {
  if (views.length === 0) return 'No schedule yet';
  const met = views.filter((v) => v.status === 'met' || v.status === 'late').length;
  const overdue = views.filter((v) => v.status === 'missed');
  if (overdue.length > 0) {
    const worst = overdue[0];
    return `${met}/${views.length} done · ${overdue.length} overdue — ${worst.milestoneType}`;
  }
  const next = views.find((v) => v.status === 'pending');
  if (!next) return `${met}/${views.length} done · complete`;
  const days = next.targetDate ? daysBetween(today, next.targetDate) : null;
  const when = days === null ? '' : days === 0 ? ' today' : ` in ${days}d`;
  return `${met}/${views.length} done · next ${next.milestoneType}${when}`;
}

/**
 * The milestone types an operator can raise by hand.
 *
 * The template covers what every order of this kind commits to; these are the
 * ones a particular order needs — a press check before a long run, a
 * production start the client wants to witness. `Other` takes free text.
 */
export const ADHOC_MILESTONE_TYPES = [
  'Art Approval',
  'Data Approval',
  'Production Start',
  'Press Check',
  'Ship',
  'Delivery',
  'Other',
] as const;

/** Who a milestone can belong to. */
export const OWNER_ROLES = ['cs', 'client', 'supplier'] as const;

/**
 * The stored position for a milestone added by hand.
 *
 * Ordering on screen is by DATE (see `milestoneViews`), so this only settles
 * ties between two milestones falling on the same day: it takes the sequence
 * of the last milestone at or before that date, so a press check booked for
 * the 20th sits after — not before — a proof approval already due the 20th.
 */
export function sequenceForDate(items: PlanItemRow[], targetDate: string): number {
  const earlier = items
    .filter((i) => i.target_date && i.target_date.slice(0, 10) <= targetDate)
    .map((i) => asNumber(i.sequence) ?? 0);
  return earlier.length ? Math.max(...earlier) : 0;
}

/* ── The chip a milestone wears ───────────────────────────────────────── */

export interface StatusChip {
  label: string;
  className: string;
  /** Nucleo glyph class. */
  icon: string;
}

/**
 * The status as an operator reads it, not as the column stores it.
 *
 * "Pending" for everything unfinished is useless on a nine-row schedule: what
 * matters is which one bites next. A target inside three days becomes
 * "Due 2d" and an overdue one says how far gone it is, so the row that needs
 * chasing is the one that stands out.
 */
export function statusChip(view: MilestoneView, today: string): StatusChip {
  if (view.actualDate) {
    return view.status === 'late'
      ? { label: 'Late', className: 'border-warning-200 bg-warning-50 text-warning-700', icon: 'icon_-Tb_alert_circle' }
      : { label: 'Met', className: 'border-success-200 bg-success-50 text-success-500', icon: 'icon_-Tb_circle_check' };
  }
  if (!view.targetDate) {
    return { label: '—', className: 'border-border bg-muted text-muted-foreground', icon: 'icon_-Tb_circle' };
  }
  const days = daysBetween(today, view.targetDate);
  if (days < 0) {
    return {
      label: `Overdue ${Math.abs(days)}d`,
      className: 'border-destructive/30 bg-destructive/10 text-destructive',
      icon: 'icon_-Tb_alert_circle',
    };
  }
  if (days <= 3) {
    return {
      label: days === 0 ? 'Due today' : `Due ${days}d`,
      className: 'border-warning-200 bg-warning-50 text-warning-700',
      icon: 'icon_-Tb_clock',
    };
  }
  return { label: 'Pending', className: 'border-border bg-muted text-muted-foreground', icon: 'icon_-Tb_circle' };
}

/* ── Firming against the awarded supplier ─────────────────────────────── */

export interface QuotedLeadTime {
  supplierId: string;
  supplierName: string;
  weeks: number;
}

/**
 * Whether the awarded suppliers can actually hit the committed date.
 *
 * The provisional plan is drawn before anyone knows who is making the cards;
 * firming reads the lead time the winning supplier QUOTED and says whether it
 * lands inside the client's date. The targets are not rewritten — the
 * committed date is what the client agreed to, and quietly moving it would
 * hide the very slip this is for.
 */
export function leadTimeSlip(
  leadTimes: QuotedLeadTime[],
  committedDate: string,
  fromDate: string,
): { supplierName: string; weeks: number; earliest: string; daysLate: number } | null {
  let worst: { supplierName: string; weeks: number; earliest: string; daysLate: number } | null = null;
  for (const lt of leadTimes) {
    if (!lt.weeks) continue;
    const earliest = addDays(fromDate, lt.weeks * 7);
    const daysLate = daysBetween(committedDate, earliest);
    if (daysLate > 0 && (!worst || daysLate > worst.daysLate)) {
      worst = { supplierName: lt.supplierName, weeks: lt.weeks, earliest, daysLate };
    }
  }
  return worst;
}

/* ── Stamping actuals from real events ────────────────────────────────── */

/** The rows the schedule reads its actual dates out of. */
export interface EventSources {
  /** `order_relation` rows — supply orders raised. */
  relations?: Array<{ kind?: string; created_at?: string; child_order?: { id?: string } | null }>;
  reviews?: Array<{
    review_kind?: string;
    proof_type?: string;
    round?: number;
    status?: string;
    requested_at?: string;
    proof_uploaded_at?: string | null;
  }>;
  verdicts?: Array<{
    decision?: string;
    decided_at?: string;
    review_request?: { review_kind?: string; proof_type?: string; round?: number } | null;
  }>;
  shipments?: Array<{ ship_date?: string | null; shipment_record?: { id?: string } | null }>;
  /** True only when every planned destination has fully shipped. */
  shippingComplete?: boolean;
  /** `proposal` rows — accepted beats sent. */
  proposals?: Array<{ sent_at?: string | null; accepted_at?: string | null }>;
}

function earliest(dates: Array<string | null>): string | null {
  const clean = dates.filter(Boolean) as string[];
  return clean.length ? clean.sort()[0] : null;
}

function latest(dates: Array<string | null>): string | null {
  const clean = dates.filter(Boolean) as string[];
  return clean.length ? clean.sort()[clean.length - 1] : null;
}

/**
 * Which real event satisfies each milestone.
 *
 * Every entry reads a stored row. `First Box Approval` is absent on purpose —
 * nothing in this app records it, and inventing a date for it would be exactly
 * the drift this table exists to prevent. It stays pending, honestly.
 */
export function deriveActuals(src: EventSources): Record<string, { date: string; note: string }> {
  const out: Record<string, { date: string; note: string }> = {};
  const put = (type: string, date: string | null, note: string) => {
    if (date) out[type] = { date, note };
  };

  const proposalDate = earliest(
    (src.proposals ?? []).map((p) => dateOf(p.accepted_at) ?? dateOf(p.sent_at)),
  );
  put('Proposal Approval', proposalDate, 'proposal issued to the client');

  const supply = (src.relations ?? []).filter((r) => r.kind === 'supply');
  put(
    'Art to Supplier',
    earliest(supply.map((r) => dateOf(r.created_at))),
    `supply order raised (${supply.length})`,
  );

  const proofRounds = (src.reviews ?? []).filter((r) => r.review_kind === 'proof');
  const artRounds = proofRounds.filter((r) => asText(r.proof_type) === 'Art proof');
  const dataRounds = proofRounds.filter((r) => asText(r.proof_type) === 'Data proof');

  put(
    'Prod Art Proof Out',
    earliest(artRounds.map((r) => dateOf(r.proof_uploaded_at))),
    'art proof uploaded',
  );
  // The datafile goes to the supplier when its proof is asked for.
  put(
    'Datafile to Supplier',
    earliest(dataRounds.map((r) => dateOf(r.requested_at))),
    'data proof requested',
  );

  const approvals = (src.verdicts ?? []).filter(
    (v) => v.decision === 'approve' && v.review_request?.review_kind === 'proof',
  );
  const approvalDate = (proofType: string) =>
    latest(
      approvals
        .filter((v) => asText(v.review_request?.proof_type) === proofType)
        .map((v) => dateOf(v.decided_at)),
    );
  put('Prod Art Proof Approval', approvalDate('Art proof'), 'art proof signed off');
  put('Data Proof Approval', approvalDate('Data proof'), 'data proof approved');

  const shipDates = (src.shipments ?? []).map((s) => dateOf(s.ship_date));
  put('Partial Ship', earliest(shipDates), 'first despatch recorded');
  if (src.shippingComplete) {
    put('Final Ship', latest(shipDates), 'all planned destinations despatched');
  }

  return out;
}

/** A milestone that has happened but is not yet stamped. */
export interface PendingStamp {
  itemId: string;
  milestoneType: string;
  date: string;
  status: MilestoneStatus;
  note: string;
}

/**
 * What the next sync would write.
 *
 * Only ever fills an EMPTY actual — a stamped milestone is history and is
 * never rewritten, so running this twice does nothing the second time.
 */
export function pendingStamps(
  items: PlanItemRow[],
  actuals: Record<string, { date: string; note: string }>,
): PendingStamp[] {
  const out: PendingStamp[] = [];
  for (const item of items) {
    if (item.actual_date) continue;
    const hit = actuals[asText(item.milestone_type)];
    if (!hit) continue;
    const target = item.target_date ? item.target_date.slice(0, 10) : null;
    out.push({
      itemId: asText(item.id),
      milestoneType: asText(item.milestone_type),
      date: hit.date,
      status: milestoneStatus(target, hit.date, hit.date),
      note: hit.note,
    });
  }
  return out;
}
