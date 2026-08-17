/**
 * ReviewPage — full-screen surface for the latest AI code review (scaffolding
 * page, like /logs; the agent does NOT touch this).
 *
 * Data crosses the authenticated platform bridge. The generated app never
 * receives a Cognito token: it posts `review-request` to the parent, validates
 * the parent's `review-response`, and sends issue-status changes back through
 * the same narrow message contract.
 *
 * Issue-status model (honest, never optimistic) — one button, three states:
 *
 *   pending / still_present  → [Ask Jiffy to fix]
 *   fix_requested            → "fix requested" + [Verify]
 *   verified_fixed           → "verified fixed", no action
 *
 * `verified_fixed` is reachable ONLY through a review run: [Verify] triggers
 * one, and the reviewer's verdict on the previous issues is what advances the
 * status. Nothing here may claim a fix worked. Legacy `fix_requested` values
 * `fix_attempted` (written by an earlier build) renders identically.
 *
 * Historical model:
 *   pending        → button live
 *   fix_requested  → sent to chat (persisted through the platform bridge)
 *   "fix attempted" is DERIVED: fix_requested + workspace HEAD moved since
 *   the review. Only a re-review verifies a fix — hence the staleness banner.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import {
  REVIEW_BRIDGE_SOURCE,
  issueStatusMessage,
  resolveParentOrigin,
  reviewRequestMessage,
  reviewResponseFromMessage,
  verifyIssueMessage,
  verifyResponseFromMessage,
  type LatestResponse,
  type ReviewIssue,
  type Severity,
} from "./review-bridge"

const SEVERITY_STYLE: Record<Severity, string> = {
  high: "bg-danger-50 text-danger-600 border-danger-200",
  medium: "bg-warning-50 text-warning-700 border-warning-200",
  low: "bg-muted text-muted-foreground border-border",
}

/* Status wording in the history list. `fix_requested` is the pre-REV-4
   spelling written by an earlier build; both read "fix requested". Clicking
   Fix only REQUESTS a fix — nothing has been verified, and the agent may not
   even have run yet, so the label must not imply the code changed. */
const HISTORY_STATUS_LABEL: Record<ReviewIssue["status"], string> = {
  pending: "not addressed",
  fix_requested: "fix requested",
  fix_attempted: "fix requested",
  verified_fixed: "verified fixed",
  still_present: "still present",
}

const REVIEW_RESPONSE_TIMEOUT_MS = 15_000

/** Post only to the platform origin that embedded this iframe. */
function postToParent(
  message: Record<string, unknown>,
  parentOrigin: string | null
): boolean {
  if (
    typeof window === "undefined" ||
    window.parent === window ||
    !parentOrigin
  ) {
    return false
  }
  window.parent.postMessage(message, parentOrigin)
  return true
}

export function ReviewPage() {
  const parentOrigin =
    typeof window === "undefined"
      ? null
      : resolveParentOrigin(window, document.referrer)
  const bridgeAvailable =
    typeof window !== "undefined" && window.parent !== window && !!parentOrigin
  const [data, setData] = useState<LatestResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(bridgeAvailable)
  const [requestVersion, setRequestVersion] = useState(0)
  /* Issue id currently being verified — drives the button's pending state so a
     ~10s model call doesn't look like a dead click. */
  const [verifyingId, setVerifyingId] = useState<string | null>(null)
  const visibleError =
    error ??
    (!bridgeAvailable
      ? "The review bridge is available only inside the AI editor."
      : null)

  const load = useCallback(() => {
    if (!bridgeAvailable) return
    setLoading(true)
    setError(null)
    setRequestVersion((version) => version + 1)
  }, [bridgeAvailable])

  /*
   * Refetch whenever the platform points the iframe at /review — including
   * when we are ALREADY there.
   *
   * The page fetched only on mount, so a review finishing while it was open
   * left "No review yet" on screen, and the menu's "Open review page" could
   * not fix it either: HelperMenu answers `jiffy:navigate` with
   * `navigate(route)`, and routing to the current route is a no-op, so
   * nothing remounted. Only a full browser reload showed the result.
   *
   * Listening for the same message the router already receives keeps this
   * starter-side — no new platform message, no change to the review bridge.
   */
  /* Verification finished: clear the pending button and refetch, so the badge
     shows what the verifier actually wrote rather than an optimistic guess. */
  useEffect(() => {
    if (!parentOrigin) return undefined
    const parent = window.parent
    const onMessage = (event: MessageEvent) => {
      const reply = verifyResponseFromMessage(event, parent, parentOrigin)
      if (!reply) return
      setVerifyingId(null)
      if (reply.ok) {
        load()
      } else {
        setError(
          reply.status > 0
            ? `Verification failed (HTTP ${reply.status}).`
            : "Could not reach the AI editor review service."
        )
      }
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [load, parentOrigin])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent) return
      if (parentOrigin && event.origin !== parentOrigin) return
      const data = event.data as { type?: string; route?: string } | null
      if (!data || typeof data !== "object") return
      if (data.type !== "jiffy:navigate" || typeof data.route !== "string") {
        return
      }
      if (!data.route.startsWith("/review")) return
      load()
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [load, parentOrigin])

  useEffect(() => {
    if (!bridgeAvailable || !parentOrigin) return undefined

    const parent = window.parent
    const timeout = window.setTimeout(() => {
      setError("Timed out waiting for the AI editor review service.")
      setLoading(false)
    }, REVIEW_RESPONSE_TIMEOUT_MS)

    const onMessage = (event: MessageEvent) => {
      const response = reviewResponseFromMessage(event, parent, parentOrigin)
      if (!response) return
      window.clearTimeout(timeout)
      window.removeEventListener("message", onMessage)
      if (!response.ok || !response.payload) {
        setError(
          response.status > 0
            ? `Review request failed (HTTP ${response.status}).`
            : "Could not reach the AI editor review service."
        )
      } else {
        setData(response.payload)
      }
      setLoading(false)
    }

    window.addEventListener("message", onMessage)
    parent.postMessage(reviewRequestMessage(), parentOrigin)
    return () => {
      window.clearTimeout(timeout)
      window.removeEventListener("message", onMessage)
    }
  }, [bridgeAvailable, parentOrigin, requestVersion])

  const issueState = useCallback(
    (
      status: ReviewIssue["status"]
    ): "open" | "unverified" | "verified" | "still_present" => {
      if (status === "verified_fixed") return "verified"
      if (status === "still_present") return "still_present"
      // fix_requested is the pre-REV-4 spelling of the same state.
      if (status === "fix_attempted" || status === "fix_requested")
        return "unverified"
      return "open"
    },
    []
  )

  const markRequested = useCallback(
    (issue: ReviewIssue) => {
      if (!data?.review) return
      // Optimistic local flip; persistence is best-effort (page refetch wins).
      setData((prev) =>
        prev?.review
          ? {
              ...prev,
              review: {
                ...prev.review,
                issues: prev.review.issues.map((i) =>
                  i.id === issue.id ? { ...i, status: "fix_requested" } : i
                ),
              },
            }
          : prev
      )
      postToParent(
        issueStatusMessage(
          data.review.conversationId,
          issue.id,
          "fix_requested"
        ),
        parentOrigin
      )
    },
    [data, parentOrigin]
  )

  const askFix = useCallback(
    (issue: ReviewIssue) => {
      postToParent(
        {
          source: REVIEW_BRIDGE_SOURCE,
          type: "ask-fix",
          message: issue.fixPrompt,
        },
        parentOrigin
      )
      markRequested(issue)
    },
    [markRequested, parentOrigin]
  )

  /*
   * Everything still worth acting on: never addressed, or a fix the last
   * review judged unsuccessful. A requested-but-unverified fix is excluded (it
   * is waiting on Verify, not on another fix) and so is `verified_fixed`.
   */
  const actionableIssues = useMemo(
    () =>
      (data?.review?.issues ?? []).filter(
        (i) => i.status === "pending" || i.status === "still_present"
      ),
    [data]
  )

  /*
   * "Fix all" = every open issue, composed from their own `fixPrompt`s (the
   * rubric requires each to be self-contained). Deliberately NOT the
   * reviewer's `suggestedFixPrompt`: that one only covers high/medium
   * findings, so a review of nothing but LOW issues produced either no button
   * at all or a button that marked nothing. Composing guarantees the message
   * covers exactly the issues we then mark. Below two issues the per-issue
   * button already does the job.
   */
  const fixAll = useMemo(() => {
    if (actionableIssues.length < 2) return null
    return {
      message: [
        "Fix these review findings:",
        "",
        ...actionableIssues.map((i, n) => `${n + 1}. ${i.fixPrompt}`),
      ].join("\n"),
      issues: actionableIssues,
    }
  }, [actionableIssues])

  /*
   * Ask for a fix from a HISTORY card. Deliberately posts the prompt without
   * writing a status: that issue belongs to an older review, and the status
   * API targets the latest one, so a write here would stamp the wrong entry.
   * The next review decides the outcome, which is the same contract as
   * everywhere else.
   */
  const askFixFromHistory = useCallback(
    (issue: ReviewIssue) => {
      postToParent(
        {
          source: REVIEW_BRIDGE_SOURCE,
          type: "ask-fix",
          message: issue.fixPrompt,
        },
        parentOrigin
      )
    },
    [parentOrigin]
  )

  /* Earlier runs, newest first. Without this the page showed only the latest
     review, so a fix verified by a re-review disappeared from view the moment
     that review was appended — the one outcome the user is waiting for. */
  const history = useMemo(() => data?.history ?? [], [data])

  /*
   * Issues (matched on file+problem) that ANY review has verified as fixed.
   * A history card records what was true at the time, so an issue marked
   * "still present" in an older review may well have been fixed by a later
   * one — showing it unqualified reads as "still broken now" and invites
   * re-fixing finished work. Observed live: two "still present" issues in the
   * 22:49 review were re-reported and verified fixed at 23:03.
   *
   * Declared with the other hooks, ABOVE the loading/error/empty early
   * returns: putting it after them changed the hook count between renders
   * ("Rendered more hooks than during the previous render").
   */
  const resolvedKeys = useMemo(() => {
    const keys = new Set<string>()
    const runs = [...history, ...(data?.review ? [data.review] : [])]
    for (const run of runs) {
      for (const issue of run.issues) {
        if (issue.status === "verified_fixed") {
          keys.add(`${issue.file}::${issue.problem}`)
        }
      }
    }
    return keys
  }, [history, data])

  /*
   * Problems that are STILL LIVE in the current review. The backend carries an
   * unresolved issue forward, so the same problem legitimately appears both in
   * the current list and in the run that first reported it. Offering an action
   * on both is a trap: two "Ask again" buttons for one problem, and the
   * history copy reads as a second, separate issue.
   */
  const liveKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const issue of data?.review?.issues ?? []) {
      keys.add(`${issue.file}::${issue.problem}`)
    }
    return keys
  }, [data])

  const askFixAll = useCallback(() => {
    if (!fixAll || fixAll.issues.length === 0) return
    postToParent(
      {
        source: REVIEW_BRIDGE_SOURCE,
        type: "ask-fix",
        message: fixAll.message,
      },
      parentOrigin
    )
    for (const issue of fixAll.issues) markRequested(issue)
  }, [fixAll, markRequested, parentOrigin])

  /*
   * Verify ONE issue: a scoped check of that problem, updating it in place.
   *
   * It used to call reReview(), which ran a full review — so verifying a fix
   * appended a new entry, pushed the review being read into history and hid
   * the verdict the user was waiting for. The chain grew on every click.
   *
   * The platform performs the authenticated call and replies; we then refetch
   * so the badge reflects what the verifier actually wrote.
   */
  const verifyIssue = useCallback(
    (issue: ReviewIssue) => {
      const conversationId = data?.review?.conversationId
      if (!conversationId || verifyingId) return
      setVerifyingId(issue.id)
      postToParent(verifyIssueMessage(conversationId, issue.id), parentOrigin)
    },
    [data, parentOrigin, verifyingId]
  )

  const reReview = useCallback(() => {
    postToParent(
      {
        source: REVIEW_BRIDGE_SOURCE,
        type: "ask-review",
        scope: data?.review?.scope ?? "last5",
      },
      parentOrigin
    )
  }, [data, parentOrigin])

  if (loading) {
    return (
      <div
        className="p-8 text-sm text-muted-foreground"
        role="status"
        aria-busy="true"
      >
        Loading review…
      </div>
    )
  }
  if (visibleError) {
    return (
      <div className="p-8">
        <Card
          className="flex items-center justify-between gap-4 border-danger-200 bg-danger-50 p-4 text-sm text-danger-600"
          role="alert"
        >
          <p>Could not load the review ({visibleError})</p>
          {bridgeAvailable && (
            <Button size="sm" variant="outline" onClick={load}>
              Try again
            </Button>
          )}
        </Card>
      </div>
    )
  }
  if (!data?.exists || !data.review) {
    return (
      <div className="p-8">
        <Card className="p-6 text-center">
          <p className="text-lg font-semibold">No review yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Run one from the chat&apos;s tools menu (Review section) and it will
            appear here.
          </p>
        </Card>
      </div>
    )
  }

  const { review, stale } = data
  const workspaceMoved = !!stale?.is_stale

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6" data-testid="review-page">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Review — {review.scopeLabel}</h1>
          <p className="text-sm text-muted-foreground">
            {new Date(review.createdAt).toLocaleString()} ·{" "}
            {review.issues.length} issue
            {review.issues.length === 1 ? "" : "s"}
          </p>
        </div>
        <Button variant="outline" onClick={reReview} data-testid="re-review">
          <i
            className="icon icon_-Tb_refresh text-[0.875rem]"
            aria-hidden="true"
          />
          Re-review
        </Button>
      </div>

      {workspaceMoved && (
        <Card
          className="border-warning-200 bg-warning-50 p-3 text-sm text-warning-700"
          data-testid="stale-banner"
        >
          The workspace has changed since this review
          {typeof stale?.commits_since === "number" && stale.commits_since > 0
            ? ` (${stale.commits_since} turn${stale.commits_since === 1 ? "" : "s"})`
            : ""}
          {" — "}re-review to verify fixes.
        </Card>
      )}

      {review.verdict && (
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Verdict
          </h2>
          <p className="mt-1 text-sm" data-testid="review-verdict">
            {review.verdict}
          </p>
        </Card>
      )}

      {review.matches.length > 0 && (
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Matches the request
          </h2>
          <ul className="mt-2 space-y-1">
            {review.matches.map((m) => (
              <li key={m} className="flex gap-2 text-sm">
                <i
                  className="icon icon_-Tb_circle_check mt-0.5 text-[0.875rem] text-success-600"
                  aria-hidden="true"
                />
                {m}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Issues</h2>
        {review.issues.length === 0 && (
          <Card className="p-4 text-sm text-muted-foreground">
            No issues found in the reviewed scope.
          </Card>
        )}
        {review.issues.map((issue) => {
          const state = issueState(issue.status)
          return (
            <Card
              key={issue.id}
              className="p-4"
              data-testid={`review-issue-${issue.id}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      className={cn("border", SEVERITY_STYLE[issue.severity])}
                    >
                      {issue.severity}
                    </Badge>
                    <code className="truncate text-xs text-muted-foreground">
                      {issue.file}
                      {issue.line ? `:${issue.line}` : ""}
                    </code>
                    {state === "unverified" && (
                      <Badge variant="secondary">fix requested</Badge>
                    )}
                    {state === "verified" && (
                      <Badge className="border border-emerald-200 bg-emerald-50 text-emerald-700">
                        verified fixed
                      </Badge>
                    )}
                    {state === "still_present" && (
                      <Badge variant="secondary">
                        still present after the fix attempt
                      </Badge>
                    )}
                  </div>
                  {issue.quote && (
                    <pre className="mt-2 overflow-x-auto rounded bg-muted px-2 py-1 text-xs">
                      {issue.quote}
                    </pre>
                  )}
                  <p className="mt-2 text-sm">{issue.problem}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {issue.fix}
                  </p>
                </div>
                {state === "verified" ? null : state === "unverified" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={verifyingId === issue.id}
                    onClick={() => verifyIssue(issue)}
                    data-testid={`verify-${issue.id}`}
                    aria-label={`Verify the fix for ${issue.file}`}
                  >
                    {verifyingId === issue.id ? "Verifying…" : "Verify"}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant={state === "still_present" ? "outline" : "default"}
                    onClick={() => askFix(issue)}
                    data-testid={`ask-fix-${issue.id}`}
                    aria-label={`Ask Jiffy to fix ${issue.file}`}
                  >
                    {state === "still_present"
                      ? "Ask again"
                      : "Ask Jiffy to fix"}
                  </Button>
                )}
              </div>
            </Card>
          )
        })}
      </div>

      {review.outsideScope.length > 0 && (
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Outside scope
          </h2>
          <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-muted-foreground">
            {review.outsideScope.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        </Card>
      )}

      {fixAll && fixAll.issues.length > 0 && (
        <Card className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground">
                Fix everything still open
              </h2>
              <p className="mt-1 text-sm">
                Sends all {fixAll.issues.length} open issues to Jiffy in one
                message.
              </p>
              {review.suggestedFixPrompt && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Reviewer&rsquo;s suggestion: {review.suggestedFixPrompt}
                </p>
              )}
            </div>
            <Button size="sm" onClick={askFixAll} data-testid="fix-all">
              Fix all
            </Button>
          </div>
        </Card>
      )}

      {history.length > 0 && (
        <div className="space-y-3" data-testid="review-history">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Previous reviews
          </h2>
          {history.map((entry) => (
            <Card
              key={entry.createdAt}
              className="p-4"
              data-testid={`review-history-${entry.createdAt}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{entry.scopeLabel}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(entry.createdAt).toLocaleString()}
                </span>
                <span className="text-xs text-muted-foreground">
                  {entry.issues.length === 1
                    ? "1 issue"
                    : `${entry.issues.length} issues`}
                </span>
              </div>
              {entry.verdict && (
                <p className="mt-2 text-sm text-muted-foreground">
                  {entry.verdict}
                </p>
              )}
              {entry.issues.length > 0 && (
                <ul className="mt-3 space-y-3">
                  {entry.issues.map((issue) => {
                    const key = `${issue.file}::${issue.problem}`
                    const fixedLater =
                      issue.status === "still_present" && resolvedKeys.has(key)
                    const carriedForward = !fixedLater && liveKeys.has(key)
                    const stillOpen =
                      issue.status === "still_present" &&
                      !fixedLater &&
                      !carriedForward
                    return (
                      <li
                        key={issue.id}
                        className="border-t border-border pt-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            className={cn(
                              "border",
                              SEVERITY_STYLE[issue.severity]
                            )}
                          >
                            {issue.severity}
                          </Badge>
                          <code className="truncate text-xs text-muted-foreground">
                            {issue.file}
                            {issue.line ? `:${issue.line}` : ""}
                          </code>
                          <Badge
                            variant="secondary"
                            className={cn(
                              (issue.status === "verified_fixed" ||
                                fixedLater) &&
                                "border border-emerald-200 bg-emerald-50 text-emerald-700"
                            )}
                          >
                            {fixedLater
                              ? "fixed in a later review"
                              : carriedForward
                                ? "still open — shown above"
                                : HISTORY_STATUS_LABEL[issue.status]}
                          </Badge>
                          {stillOpen && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => askFixFromHistory(issue)}
                              data-testid={`history-ask-fix-${entry.createdAt}-${issue.id}`}
                              aria-label={`Ask Jiffy to fix ${issue.file}`}
                            >
                              Ask again
                            </Button>
                          )}
                        </div>
                        {issue.quote && (
                          <pre className="mt-2 overflow-x-auto rounded bg-muted px-2 py-1 text-xs">
                            {issue.quote}
                          </pre>
                        )}
                        <p className="mt-2 text-sm">{issue.problem}</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {issue.fix}
                        </p>
                      </li>
                    )
                  })}
                </ul>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
