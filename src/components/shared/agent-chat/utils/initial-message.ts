export type InitialMessageAction = "wait" | "skip" | "send"

export interface InitialMessageState {
  hasInitialMessage: boolean
  sessionId: string
  handledThisMount: boolean
  restoring: boolean
  sessionReady: boolean
  initialMessageReady: boolean
  hasMessages: boolean
  resendInitialMessage: boolean
  sentForSession: boolean
}

/** Decide whether the current session should receive its automatic opening turn. */
export function decideInitialMessageAction({
  hasInitialMessage,
  sessionId,
  handledThisMount,
  restoring,
  sessionReady,
  initialMessageReady,
  hasMessages,
  resendInitialMessage,
  sentForSession,
}: InitialMessageState): InitialMessageAction {
  if (
    !hasInitialMessage ||
    !sessionId ||
    handledThisMount ||
    restoring ||
    !sessionReady ||
    !initialMessageReady
  ) {
    return "wait"
  }

  if (!resendInitialMessage && (hasMessages || sentForSession)) return "skip"
  return "send"
}
