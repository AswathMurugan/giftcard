import * as React from "react"

const MOBILE_BREAKPOINT = 768

const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

let mediaQueryList: MediaQueryList | null = null

// Created lazily rather than at module scope so this module stays importable
// in environments without `window`.
function getMediaQueryList() {
  if (mediaQueryList === null) mediaQueryList = window.matchMedia(QUERY)
  return mediaQueryList
}

function subscribe(onStoreChange: () => void) {
  const list = getMediaQueryList()
  list.addEventListener("change", onStoreChange)
  return () => list.removeEventListener("change", onStoreChange)
}

// The single source of truth: the same media query we subscribe to. Reading
// `window.innerWidth` here instead would let the snapshot disagree with the
// event that triggered it (scrollbar width, zoom, subpixel rounding).
function getSnapshot() {
  return getMediaQueryList().matches
}

function getServerSnapshot() {
  return false
}

export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
