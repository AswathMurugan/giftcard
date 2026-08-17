import { describe, expect, it } from "vitest"
import {
  decideInitialMessageAction,
  type InitialMessageState,
} from "./initial-message"

const readyState: InitialMessageState = {
  hasInitialMessage: true,
  sessionId: "session-a",
  handledThisMount: false,
  restoring: false,
  sessionReady: true,
  initialMessageReady: true,
  hasMessages: false,
  resendInitialMessage: false,
  sentForSession: false,
}

describe(
  "initial message decision",
  { tags: ["agent-chat", "session-continuity", "logic"] },
  () => {
    it(
      "skips a prior send when restored history is still empty",
      {
        tags: ["important", "edge-case"],
      },
      () => {
        expect(
          decideInitialMessageAction({ ...readyState, sentForSession: true })
        ).toBe("skip")
      }
    )

    it("sends for a fresh session", { tags: ["smoke"] }, () => {
      expect(decideInitialMessageAction(readyState)).toBe("send")
    })

    it(
      "does not carry a prior session marker into a genuinely new session",
      {
        tags: ["important"],
      },
      () => {
        expect(
          decideInitialMessageAction({
            ...readyState,
            sessionId: "session-b",
            sentForSession: false,
          })
        ).toBe("send")
      }
    )

    it(
      "allows explicit resend to bypass history and the durable marker",
      {
        tags: ["important"],
      },
      () => {
        expect(
          decideInitialMessageAction({
            ...readyState,
            hasMessages: true,
            sentForSession: true,
            resendInitialMessage: true,
          })
        ).toBe("send")
      }
    )

    it(
      "waits until restore, transport, and page context are ready",
      {
        tags: ["edge-case"],
      },
      () => {
        expect(
          decideInitialMessageAction({ ...readyState, restoring: true })
        ).toBe("wait")
        expect(
          decideInitialMessageAction({ ...readyState, sessionReady: false })
        ).toBe("wait")
        expect(
          decideInitialMessageAction({
            ...readyState,
            initialMessageReady: false,
          })
        ).toBe("wait")
      }
    )
  }
)
