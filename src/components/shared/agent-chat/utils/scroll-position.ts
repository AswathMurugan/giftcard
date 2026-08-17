export interface ScrollPosition {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}

/** Whether a scroll viewport is close enough to its end to stay pinned there. */
export function isNearScrollEnd(position: ScrollPosition, threshold = 32): boolean {
  return position.scrollHeight - position.scrollTop - position.clientHeight <= threshold;
}

export interface ScrollPinState {
  pinned: boolean;
  programmatic: boolean;
}

/**
 * A smooth scroll emits intermediate events while it is still far from the end.
 * Those events must not look like a user scrolling upward; keep the pin until
 * the destination is reached. User input clears `programmatic` before calling.
 */
export function scrollPinAfterScroll(
  position: ScrollPosition,
  programmatic: boolean,
): ScrollPinState {
  const atEnd = isNearScrollEnd(position);
  if (programmatic && !atEnd) return { pinned: true, programmatic: true };
  return { pinned: atEnd, programmatic: false };
}
