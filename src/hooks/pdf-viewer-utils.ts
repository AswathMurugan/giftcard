/**
 * Pure helpers + constants for the PDF viewer hook (usePdfViewer).
 *
 * Kept in a separate module with NO `react-pdf` / `pdfjs-dist` import so they
 * are unit-testable in the node test env (and so importing them never pulls the
 * heavy PDF engine into a bundle). usePdfViewer re-exports them.
 */

/** Zoom bounds for the PDF viewer toolbar. */
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 3.0;
export const ZOOM_STEP = 0.25;

/** Clamp a zoom scale into [ZOOM_MIN, ZOOM_MAX], rounded to 2 decimals. */
export function clampScale(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(n * 100) / 100));
}

/** A file descriptor the viewer can route (PDF vs. image/iframe). */
export interface ViewableFile {
  url?: string;
  mimeType?: string;
}

/**
 * True when a file should render with react-pdf rather than an <img>/<iframe>.
 * Detection: mimeType === "application/pdf" (case-insensitive), OR the URL path
 * (ignoring query/fragment) ends in ".pdf".
 */
export function isPdfFile(file: ViewableFile | null | undefined): boolean {
  if (!file) return false;
  if (file.mimeType && file.mimeType.toLowerCase() === 'application/pdf') {
    return true;
  }
  if (!file.url || typeof file.url !== 'string') return false;
  const path = file.url.split('?')[0].split('#')[0];
  return path.toLowerCase().endsWith('.pdf');
}

/**
 * Rendered width of a PDF page: the container width scaled by the zoom level.
 * Returns undefined when the container hasn't been measured yet (react-pdf then
 * renders at the PDF's intrinsic width).
 */
export function pageWidthFor(
  containerWidth: number | undefined,
  scale: number,
): number | undefined {
  if (!containerWidth || containerWidth <= 0) return undefined;
  return containerWidth * scale;
}

/** Clamp a 1-based page number into [1, numPages]. */
export function clampPage(page: number, numPages: number): number {
  if (numPages <= 0) return 1;
  return Math.max(1, Math.min(numPages, Math.round(page)));
}

/** Inputs for clamping the draggable toolbar's offset within its pane. */
export interface ToolbarClampArgs {
  rootWidth: number;
  rootHeight: number;
  barWidth: number;
  barHeight: number;
  /** The toolbar's un-offset LEFT edge (at x=0). For a horizontally-centered
   *  bar this is `(rootWidth - barWidth) / 2`. */
  baseLeft: number;
  /** The toolbar's un-offset TOP edge (at y=0). */
  baseTop: number;
  /** Minimum gap to keep between the toolbar and the pane edges (default 8px). */
  margin?: number;
}

function clampRange(v: number, min: number, max: number): number {
  if (max < min) return min; // pane smaller than the bar — pin to the min edge
  return Math.max(min, Math.min(max, v));
}

/**
 * Clamp a draggable toolbar's `(x, y)` drag offset so the toolbar stays fully
 * inside its pane (minus `margin`). `x`/`y` are offsets ADDED to the toolbar's
 * base position (`baseLeft`/`baseTop`). When the pane is too small to move the
 * bar on an axis, that axis pins to the min (top/left) edge.
 */
export function clampToolbarOffset(
  x: number,
  y: number,
  a: ToolbarClampArgs,
): { x: number; y: number } {
  const margin = a.margin ?? 8;
  return {
    x: clampRange(x, margin - a.baseLeft, a.rootWidth - a.barWidth - margin - a.baseLeft),
    y: clampRange(y, margin - a.baseTop, a.rootHeight - a.barHeight - margin - a.baseTop),
  };
}

/** Viewport-relative measurements of one page wrapper (from getBoundingClientRect). */
export interface PageRect {
  top: number;
  bottom: number;
  height: number;
}

/**
 * Pick the current page from live measurements: the page whose top is nearest
 * the container's top-third probe line. Returns 0 when no page qualifies
 * (caller keeps the previous page).
 *
 * Two guards make this correct BEFORE the document has fully laid out (the
 * "opens showing 7 / 9" bug):
 * - `scrollTop <= 1` → page 1 by definition. On open the container is at the
 *   top, but the page wrappers are placeholder-sized (pdf.js renders pages
 *   asynchronously), so probing their rects picks an arbitrary page.
 * - Pages with a ~zero-height rect (height <= 1: not laid out / display:none)
 *   are never candidates.
 */
export function pickCurrentPage(
  scrollTop: number,
  rootTop: number,
  rootBottom: number,
  pages: Iterable<[number, PageRect]>,
): number {
  if (scrollTop <= 1) return 1;
  const probe = rootTop + (rootBottom - rootTop) / 3;
  let bestPage = 0;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const [n, r] of pages) {
    if (r.height <= 1) continue; // not laid out yet
    if (r.bottom <= rootTop || r.top >= rootBottom) continue; // offscreen
    const delta = Math.abs(r.top - probe);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestPage = n;
    }
  }
  return bestPage;
}
