/**
 * Embedded-mode detection.
 *
 * A generated app renders its own chrome (TopBar + SideBar via DefaultLayout)
 * when run standalone. But when the platform shell FRAMES the app for cross-app
 * navigation (the shell owns the chrome), the app must render content-only —
 * otherwise the user sees two sidebars + two topbars stacked
 * (see docs/CROSS-APP-NAVIGATION-PLAN.md §4.3a).
 *
 * IMPORTANT: do NOT use an iframe check (`window.parent !== window`) as the
 * signal. The codegen PREVIEW always runs the app inside an iframe (the Jiffy
 * preview shell), so an iframe heuristic would hide the chrome in normal
 * preview. Embedded mode is therefore an EXPLICIT opt-in only: the cross-app
 * shell appends `?embedded=1` to the URL. Nothing else triggers it.
 *
 * `isEmbeddedFrom` is pure (testable); `isEmbedded` reads the live URL.
 */

/** Pure: decide embedded mode from the URL search string. */
export function isEmbeddedFrom(search: string): boolean {
  try {
    return new URLSearchParams(search).get('embedded') === '1';
  } catch {
    return false;
  }
}

/** Runtime: true only when the shell explicitly frames us via `?embedded=1`. */
export function isEmbedded(): boolean {
  if (typeof window === 'undefined') return false;
  return isEmbeddedFrom(window.location.search);
}
