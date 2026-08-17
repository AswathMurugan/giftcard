import { describe, expect, it } from "vitest"
import {
  PLATFORM_REVIEW_SOURCE,
  REVIEW_BRIDGE_SOURCE,
  resolveParentOrigin,
  issueStatusMessage,
  parentOriginFromReferrer,
  reviewRequestMessage,
  reviewResponseFromMessage,
  type LatestResponse,
} from "./review-bridge"

const REVIEW_PAYLOAD: LatestResponse = {
  exists: true,
  review: {
    conversationId: "conversation-1",
    scope: "last5",
    scopeLabel: "Last 5 turns",
    createdAt: 1_700_000_000_000,
    reportMarkdown: "# Review",
    verdict: "Needs changes",
    matches: ["Matches the request"],
    issues: [
      {
        id: "issue-1",
        severity: "high",
        file: "src/pages/Home.tsx",
        problem: "Missing empty state",
        fix: "Add the empty state",
        fixPrompt: "Add an empty state to Home.",
        status: "pending",
      },
    ],
    outsideScope: [],
    suggestedFixPrompt: "Fix all high-priority issues.",
  },
  stale: { commits_since: 0, is_stale: false },
}

function responseEvent(
  parent: unknown,
  overrides: Partial<{ source: unknown; origin: string; data: unknown }> = {}
) {
  return {
    source: parent,
    origin: "https://platform.example.com",
    data: {
      source: PLATFORM_REVIEW_SOURCE,
      type: "review-response",
      ok: true,
      status: 200,
      payload: REVIEW_PAYLOAD,
    },
    ...overrides,
  }
}

describe("review bridge", { tags: ["review", "security", "logic"] }, () => {
  describe("resolveParentOrigin", () => {
    const PARENT = "http://aiwithdata.localhost:5175"
    const SELF = "http://aiwithdata.localhost:3001"

    const winWith = (ancestors: string[] | undefined) =>
      ({
        location: ancestors
          ? ({
              ancestorOrigins: Object.assign([...ancestors], {
                length: ancestors.length,
              }),
            } as unknown as Location)
          : ({} as Location),
      }) as Pick<Window, "location">

    it("prefers ancestorOrigins over a stale same-origin referrer", () => {
      // The live failure: the platform navigated the iframe to /review from
      // another app page, so document.referrer is the APP's own previous URL.
      // Trusting it made us post to our own origin and the browser refused,
      // so the request never arrived and the page timed out.
      expect(resolveParentOrigin(winWith([PARENT]), `${SELF}/clients`)).toBe(
        PARENT
      )
    })

    it("falls back to the referrer where ancestorOrigins is unavailable", () => {
      // Firefox exposes no ancestorOrigins; first load still has a parent
      // referrer, which is enough.
      expect(resolveParentOrigin(winWith(undefined), `${PARENT}/editor`)).toBe(
        PARENT
      )
      expect(resolveParentOrigin(winWith([]), `${PARENT}/editor`)).toBe(PARENT)
    })

    it("applies the same transport rule to ancestorOrigins", () => {
      expect(
        resolveParentOrigin(winWith(["http://evil.example"]), `${PARENT}/x`)
      ).toBe(PARENT)
      expect(
        resolveParentOrigin(winWith(["http://evil.example"]), "")
      ).toBeNull()
      expect(resolveParentOrigin(winWith(["null"]), "")).toBeNull()
    })

    it("fails closed when neither source is usable", () => {
      expect(resolveParentOrigin(winWith(undefined), "")).toBeNull()
      expect(resolveParentOrigin(winWith([]), "not a URL")).toBeNull()
    })
  })

  describe("parentOriginFromReferrer", () => {
    const CLOUD_ORIGIN = "https://aiwithdata.us.sandbox.phoenix.jiffy.ai"

    it("keeps the embedding origin for any HTTPS parent", () => {
      expect(
        parentOriginFromReferrer(
          `${CLOUD_ORIGIN}/app/demo/editor/ai?session=c1`
        )
      ).toBe(CLOUD_ORIGIN)
      expect(
        parentOriginFromReferrer("https://platform.example.com/editor")
      ).toBe("https://platform.example.com")
    })

    it("allows plaintext only for explicit local-development hosts", () => {
      expect(parentOriginFromReferrer("http://localhost:5175/editor")).toBe(
        "http://localhost:5175"
      )
      expect(parentOriginFromReferrer("http://127.0.0.1:5175/editor")).toBe(
        "http://127.0.0.1:5175"
      )
      expect(
        parentOriginFromReferrer("http://aiwithdata.localhost:5175/editor")
      ).toBe("http://aiwithdata.localhost:5175")
      expect(
        parentOriginFromReferrer("http://platform.example.com/editor")
      ).toBeNull()
      expect(
        parentOriginFromReferrer("http://192.168.1.10:5175/editor")
      ).toBeNull()
    })

    it("fails closed when no trustworthy referrer origin exists", () => {
      expect(parentOriginFromReferrer("")).toBeNull()
      expect(parentOriginFromReferrer("not a URL")).toBeNull()
      expect(parentOriginFromReferrer("data:text/plain,hello")).toBeNull()
      expect(
        parentOriginFromReferrer("ftp://platform.example.com/app")
      ).toBeNull()
    })
  })

  const PARENT_WIN = {} as Window

  it("accepts a response carrying previous reviews, and rejects a malformed one", () => {
    const entry = {
      conversationId: "c1",
      createdAt: 1785500000000,
      scope: "full",
      scopeLabel: "full app",
      verdict: "one issue, since verified",
      issues: [
        {
          id: "issue-1",
          severity: "high" as const,
          file: "src/pages/Home.tsx",
          problem: "Missing empty state",
          fix: "Add the empty state",
          fixPrompt: "Add an empty state to Home.",
          status: "verified_fixed" as const,
        },
      ],
    }
    const withHistory = reviewResponseFromMessage(
      responseEvent(PARENT_WIN, {
        data: {
          source: PLATFORM_REVIEW_SOURCE,
          type: "review-response",
          ok: true,
          status: 200,
          payload: { ...REVIEW_PAYLOAD, history: [entry] },
        },
      }),
      PARENT_WIN,
      "https://platform.example.com"
    )
    expect(withHistory?.payload?.history?.[0].issues[0].status).toBe(
      "verified_fixed"
    )

    // Absent history is fine (older backend); a malformed entry is not.
    expect(
      reviewResponseFromMessage(
        responseEvent(PARENT_WIN),
        PARENT_WIN,
        "https://platform.example.com"
      )?.payload?.history
    ).toBeUndefined()
    expect(
      reviewResponseFromMessage(
        responseEvent(PARENT_WIN, {
          data: {
            source: PLATFORM_REVIEW_SOURCE,
            type: "review-response",
            ok: true,
            status: 200,
            payload: { ...REVIEW_PAYLOAD, history: [{ createdAt: "nope" }] },
          },
        }),
        PARENT_WIN,
        "https://platform.example.com"
      )
    ).toBeNull()
  })

  it("builds the fixed review-request envelope", () => {
    expect(reviewRequestMessage()).toEqual({
      source: REVIEW_BRIDGE_SOURCE,
      type: "review-request",
    })
  })

  it("builds the fixed issue-status envelope and body allow-list", () => {
    expect(
      issueStatusMessage("conversation-1", "issue-1", "fix_requested")
    ).toEqual({
      source: REVIEW_BRIDGE_SOURCE,
      type: "review-issue-status",
      body: {
        conversation_id: "conversation-1",
        issue_id: "issue-1",
        status: "fix_requested",
      },
    })
  })

  describe("reviewResponseFromMessage", () => {
    it("accepts a valid response from the exact parent and origin", () => {
      const parent = {}
      expect(
        reviewResponseFromMessage(
          responseEvent(parent),
          parent,
          "https://platform.example.com"
        )
      ).toEqual({ ok: true, status: 200, payload: REVIEW_PAYLOAD })
    })

    it("accepts the no-review response", () => {
      const parent = {}
      expect(
        reviewResponseFromMessage(
          responseEvent(parent, {
            data: {
              source: PLATFORM_REVIEW_SOURCE,
              type: "review-response",
              ok: true,
              status: 200,
              payload: { exists: false },
            },
          }),
          parent,
          "https://platform.example.com"
        )
      ).toEqual({ ok: true, status: 200, payload: { exists: false } })
    })

    it.each([
      ["wrong parent", { source: {} }],
      ["wrong origin", { origin: "https://evil.example.com" }],
      [
        "wrong envelope source",
        {
          data: {
            source: "attacker",
            type: "review-response",
            ok: true,
            status: 200,
            payload: REVIEW_PAYLOAD,
          },
        },
      ],
      [
        "wrong message type",
        {
          data: {
            source: PLATFORM_REVIEW_SOURCE,
            type: "other",
            ok: true,
            status: 200,
            payload: REVIEW_PAYLOAD,
          },
        },
      ],
    ])("drops a response from the %s", (_case, overrides) => {
      const parent = {}
      expect(
        reviewResponseFromMessage(
          responseEvent(parent, overrides),
          parent,
          "https://platform.example.com"
        )
      ).toBeNull()
    })

    it("drops malformed successful payloads instead of trusting the wire", () => {
      const parent = {}
      expect(
        reviewResponseFromMessage(
          responseEvent(parent, {
            data: {
              source: PLATFORM_REVIEW_SOURCE,
              type: "review-response",
              ok: true,
              status: 200,
              payload: { exists: true, review: { conversationId: "c1" } },
            },
          }),
          parent,
          "https://platform.example.com"
        )
      ).toBeNull()
    })

    it("rejects malformed optional issue fields before React renders them", () => {
      const parent = {}
      const review = REVIEW_PAYLOAD.review!
      const issue = review.issues[0]
      expect(
        reviewResponseFromMessage(
          responseEvent(parent, {
            data: {
              source: PLATFORM_REVIEW_SOURCE,
              type: "review-response",
              ok: true,
              status: 200,
              payload: {
                ...REVIEW_PAYLOAD,
                review: {
                  ...review,
                  issues: [{ ...issue, quote: { unsafe: true } }],
                },
              },
            },
          }),
          parent,
          "https://platform.example.com"
        )
      ).toBeNull()
    })

    it("maps a platform failure without exposing an arbitrary payload", () => {
      const parent = {}
      expect(
        reviewResponseFromMessage(
          responseEvent(parent, {
            data: {
              source: PLATFORM_REVIEW_SOURCE,
              type: "review-response",
              ok: false,
              status: 401,
              payload: { ignored: true },
            },
          }),
          parent,
          "https://platform.example.com"
        )
      ).toEqual({ ok: false, status: 401, payload: null })
    })
  })
})
