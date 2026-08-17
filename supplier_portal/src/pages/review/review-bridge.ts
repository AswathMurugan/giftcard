export const REVIEW_BRIDGE_SOURCE = "codegen-starter/review"
export const PLATFORM_REVIEW_SOURCE = "jiffy-platform/review"

export type Severity = "high" | "medium" | "low"
export type IssueStatus =
  | "pending"
  | "fix_requested"
  | "fix_attempted"
  | "verified_fixed"
  | "still_present"

export interface ReviewIssue {
  id: string
  severity: Severity
  file: string
  line?: number
  quote?: string
  problem: string
  fix: string
  fixPrompt: string
  status: IssueStatus
}

export interface StoredReview {
  conversationId: string
  scope: "last5" | "last10" | "full"
  scopeLabel: string
  createdAt: number
  reportMarkdown: string
  verdict: string
  matches: string[]
  issues: ReviewIssue[]
  outsideScope: string[]
  suggestedFixPrompt: string | null
}

/**
 * An earlier review, newest first. Deliberately lighter than StoredReview:
 * history is rendered as issues + statuses, not full markdown reports.
 */
export interface ReviewHistoryEntry {
  conversationId: string
  createdAt: number
  scope: StoredReview["scope"]
  scopeLabel: string
  verdict: string
  issues: ReviewIssue[]
}

export interface LatestResponse {
  exists: boolean
  review?: StoredReview
  /** Absent on older backends — the page simply shows no history. */
  history?: ReviewHistoryEntry[]
  stale?: { commits_since: number | null; is_stale: boolean }
}

export interface ReviewResponse {
  ok: boolean
  status: number
  payload: LatestResponse | null
}

interface MessageEventLike {
  source: unknown
  origin: string
  data: unknown
}

const SEVERITIES: readonly Severity[] = ["high", "medium", "low"]
const ISSUE_STATUSES: readonly IssueStatus[] = [
  "pending",
  "fix_requested",
  "fix_attempted",
  "verified_fixed",
  "still_present",
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function isReviewScope(value: unknown): value is StoredReview["scope"] {
  return value === "last5" || value === "last10" || value === "full"
}

function isSeverity(value: unknown): value is Severity {
  return (
    typeof value === "string" &&
    (SEVERITIES as readonly string[]).includes(value)
  )
}

function isIssueStatus(value: unknown): value is IssueStatus {
  return (
    typeof value === "string" &&
    (ISSUE_STATUSES as readonly string[]).includes(value)
  )
}

function isReviewIssue(value: unknown): value is ReviewIssue {
  if (!isRecord(value)) return false
  return (
    typeof value.id === "string" &&
    isSeverity(value.severity) &&
    typeof value.file === "string" &&
    (value.line === undefined || typeof value.line === "number") &&
    (value.quote === undefined || typeof value.quote === "string") &&
    typeof value.problem === "string" &&
    typeof value.fix === "string" &&
    typeof value.fixPrompt === "string" &&
    isIssueStatus(value.status)
  )
}

function isHistoryEntry(value: unknown): value is ReviewHistoryEntry {
  if (!isRecord(value)) return false
  return (
    typeof value.conversationId === "string" &&
    typeof value.createdAt === "number" &&
    isReviewScope(value.scope) &&
    typeof value.scopeLabel === "string" &&
    typeof value.verdict === "string" &&
    Array.isArray(value.issues) &&
    value.issues.every(isReviewIssue)
  )
}

function isStoredReview(value: unknown): value is StoredReview {
  if (!isRecord(value)) return false
  return (
    typeof value.conversationId === "string" &&
    isReviewScope(value.scope) &&
    typeof value.scopeLabel === "string" &&
    typeof value.createdAt === "number" &&
    typeof value.reportMarkdown === "string" &&
    typeof value.verdict === "string" &&
    Array.isArray(value.matches) &&
    value.matches.every((item) => typeof item === "string") &&
    Array.isArray(value.issues) &&
    value.issues.every(isReviewIssue) &&
    Array.isArray(value.outsideScope) &&
    value.outsideScope.every((item) => typeof item === "string") &&
    (value.suggestedFixPrompt === null ||
      typeof value.suggestedFixPrompt === "string")
  )
}

function isLatestResponse(value: unknown): value is LatestResponse {
  if (!isRecord(value) || typeof value.exists !== "boolean") return false
  if (!value.exists) return true
  if (!isStoredReview(value.review)) return false
  // Optional: absent on a backend that predates review history.
  if (
    value.history !== undefined &&
    !(Array.isArray(value.history) && value.history.every(isHistoryEntry))
  ) {
    return false
  }
  if (value.stale === undefined) return true
  return (
    isRecord(value.stale) &&
    (value.stale.commits_since === null ||
      typeof value.stale.commits_since === "number") &&
    typeof value.stale.is_stale === "boolean"
  )
}

function isLocalDevOrigin(url: URL): boolean {
  return (
    url.protocol === "http:" &&
    (url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname.endsWith(".localhost"))
  )
}

/** Shared transport rule: HTTPS anywhere, plaintext only for local dev. */
function acceptableOrigin(value: string): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol === "https:" || isLocalDevOrigin(url)) return url.origin
    return null
  } catch {
    return null
  }
}

/**
 * Resolve the embedding parent from the iframe referrer; null = fail closed.
 *
 * Transport is restricted to HTTPS, with plaintext allowed only for local
 * development hosts. The origin itself is deliberately NOT allow-listed here:
 * the platform validates the origin before it ever answers a bridge request,
 * so a foreign embedder can never obtain review data. Pinning a domain in the
 * generated app would only hardcode an environment assumption.
 */
export function parentOriginFromReferrer(referrer: string): string | null {
  return acceptableOrigin(referrer)
}

/**
 * The embedding parent's origin — `ancestorOrigins` first, referrer second.
 *
 * The referrer alone is WRONG in the flow that matters. `document.referrer` is
 * the document that navigated us here, so once the platform sends the iframe
 * to /review from another app page, the referrer is the APP's own previous URL,
 * not the parent's. We then post to our own origin, the browser refuses
 * ("target origin does not match the recipient window's origin"), no request
 * is ever delivered, and the page sits until its timeout. Observed live:
 * target `http://…:3001` vs recipient `http://…:5175`.
 *
 * `location.ancestorOrigins[0]` is the immediate parent's origin and is
 * unaffected by navigation inside the iframe, so it is the correct source.
 * It is unavailable on Firefox, where the referrer fallback still covers the
 * first load; both paths go through the same HTTPS/localhost rule, and both
 * fail closed.
 */
export function resolveParentOrigin(
  win: Pick<Window, "location"> & { document?: Document },
  referrer: string
): string | null {
  const ancestors = (win.location as Location | undefined)?.ancestorOrigins
  const parent = ancestors && ancestors.length > 0 ? ancestors[0] : null
  return (
    (parent ? acceptableOrigin(parent) : null) ?? acceptableOrigin(referrer)
  )
}

export function reviewRequestMessage() {
  return { source: REVIEW_BRIDGE_SOURCE, type: "review-request" as const }
}

/**
 * Ask the platform to VERIFY one issue (PHX-5870).
 *
 * Distinct from `ask-review`: that runs a full review and appends a new entry,
 * which is what made "Verify" bury the very verdict the user was waiting for.
 * This checks one already-reported issue and updates it in place. It is a
 * separate message rather than an extra `scope` value, because scope decides
 * how much is examined for NEW findings and has nothing to do with verifying
 * a known one.
 */
export function verifyIssueMessage(conversationId: string, issueId: string) {
  return {
    source: REVIEW_BRIDGE_SOURCE,
    type: "review-verify" as const,
    body: {
      conversation_id: conversationId,
      issue_id: issueId,
    },
  }
}

export function issueStatusMessage(
  conversationId: string,
  issueId: string,
  status: IssueStatus
) {
  return {
    source: REVIEW_BRIDGE_SOURCE,
    type: "review-issue-status" as const,
    body: {
      conversation_id: conversationId,
      issue_id: issueId,
      status,
    },
  }
}

/**
 * The platform's answer to `review-verify` (PHX-5870). Carries no payload:
 * the page refetches, so the verifier's own write is the single source of
 * truth rather than something the courier could reshape in transit.
 */
export function verifyResponseFromMessage(
  event: MessageEventLike,
  expectedParent: unknown,
  expectedOrigin: string
): { ok: boolean; status: number } | null {
  if (event.source !== expectedParent || event.origin !== expectedOrigin) {
    return null
  }
  if (!isRecord(event.data)) return null
  const data = event.data
  if (
    data.source !== PLATFORM_REVIEW_SOURCE ||
    data.type !== "review-verify-response" ||
    typeof data.ok !== "boolean" ||
    typeof data.status !== "number"
  ) {
    return null
  }
  return { ok: data.ok, status: data.status }
}

/** Accept only a reply from the exact parent window at its referrer origin. */
export function reviewResponseFromMessage(
  event: MessageEventLike,
  expectedParent: unknown,
  expectedOrigin: string
): ReviewResponse | null {
  if (event.source !== expectedParent || event.origin !== expectedOrigin) {
    return null
  }
  if (!isRecord(event.data)) return null
  const data = event.data
  if (
    data.source !== PLATFORM_REVIEW_SOURCE ||
    data.type !== "review-response" ||
    typeof data.ok !== "boolean" ||
    typeof data.status !== "number"
  ) {
    return null
  }
  if (!data.ok) {
    return { ok: false, status: data.status, payload: null }
  }
  if (!isLatestResponse(data.payload)) return null
  return { ok: true, status: data.status, payload: data.payload }
}
