/**
 * usePdfViewer — the LOGIC for a rich in-app PDF viewer, minus the JSX.
 *
 * There is NO PDF viewer component in this starter (by design — hooks + doc,
 * same as file-upload / address / signatures). This hook owns everything that
 * isn't markup: the pdf.js worker setup, page count, zoom level, the
 * current-page-on-scroll tracking, page navigation and download. YOUR page
 * renders the thin JSX — react-pdf's <Document>/<Page> plus a shadcn toolbar —
 * wired to the values this hook returns. See src/queries/DOCUMENT-VIEWER.md
 * for the exact composition.
 *
 * Import this hook DIRECTLY (`@/hooks/usePdfViewer`) — it is intentionally NOT
 * re-exported from `@/hooks` so react-pdf / pdfjs-dist (~MB + worker) only load
 * on the route that actually views a PDF, never in the shared hooks chunk.
 *
 * Non-PDF files (images) don't need this hook — render them with a plain <img>.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

import {
  ZOOM_STEP,
  clampPage,
  clampScale,
  pageWidthFor,
  pickCurrentPage,
  type PageRect,
} from './pdf-viewer-utils';

export {
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP,
  clampScale,
  clampPage,
  isPdfFile,
  pageWidthFor,
} from './pdf-viewer-utils';
export type { ViewableFile } from './pdf-viewer-utils';

// Configure the pdf.js worker ONCE, at module load — before any <Document>
// mounts. `new URL(..., import.meta.url)` lets the bundler (Vite) emit the
// worker as an asset; no `?url` import needed.
//
// ⚠️ `pdfjs-dist` MUST be pinned to the EXACT version react-pdf bundles
// (`react-pdf`'s package.json `dependencies.pdfjs-dist`). This worker resolves
// the top-level `pdfjs-dist`; if its version differs from react-pdf's pdf.js,
// you get "The API version X does not match the Worker version Y" →
// "Failed to load PDF file". Do NOT use a `^`/`~` range for `pdfjs-dist`.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

function scrollPageIntoView(container: HTMLElement, pageEl: HTMLElement): void {
  const top =
    container.scrollTop +
    (pageEl.getBoundingClientRect().top - container.getBoundingClientRect().top);
  container.scrollTo({ top, behavior: 'smooth' });
}

export interface UsePdfViewerResult {
  /** Total pages (0 until the document loads). */
  numPages: number;
  /** 1-based array of page numbers to map over with <Page>. */
  pageNumbers: number[];
  /** Page nearest the top of the viewport (1-based). */
  currentPage: number;
  /** Current zoom scale (1 = 100%). */
  scale: number;
  /** Pixel width to pass to each <Page width={...}> (container width × scale). */
  pageWidth: number | undefined;
  /** Attach to the scrollable container that wraps <Document>. */
  scrollRef: RefObject<HTMLDivElement | null>;
  /** Ref callback for a page wrapper — enables current-page tracking + nav. */
  registerPage: (pageNumber: number) => (el: HTMLDivElement | null) => void;
  /** Pass to <Document onLoadSuccess={...}>. */
  onDocumentLoadSuccess: (pdf: { numPages: number }) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  canZoomIn: boolean;
  canZoomOut: boolean;
  goToPage: (page: number) => void;
  prevPage: () => void;
  nextPage: () => void;
  canPrev: boolean;
  canNext: boolean;
  /** Save the PDF to disk. */
  download: (url: string, name: string) => void;
}

/**
 * @param resetKey change this (e.g. pass the document URL) to reset page/zoom
 *   state when the viewed document changes.
 */
export function usePdfViewer(resetKey?: string): UsePdfViewerResult {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLElement>>(new Map());

  const [containerWidth, setContainerWidth] = useState<number | undefined>(undefined);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);

  // Track the scroll container's width (drives the page render width).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Reset when the document changes.
  useEffect(() => {
    setNumPages(0);
    setCurrentPage(1);
    setScale(1);
    pageRefs.current.clear();
  }, [resetKey]);

  const onDocumentLoadSuccess = useCallback((pdf: { numPages: number }) => {
    setNumPages(pdf.numPages);
  }, []);

  const pageNumbers = useMemo(
    () => Array.from({ length: numPages }, (_, i) => i + 1),
    [numPages],
  );

  const registerPage = useCallback(
    (pageNumber: number) => (el: HTMLDivElement | null) => {
      if (el) pageRefs.current.set(pageNumber, el);
      else pageRefs.current.delete(pageNumber);
    },
    [],
  );

  // Track which page is nearest the top-third of the viewport while scrolling.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || numPages === 0) return;
    let lastBest = 0;
    let frame = 0;

    const compute = () => {
      frame = 0;
      const rootRect = root.getBoundingClientRect();
      const rects: Array<[number, PageRect]> = [];
      pageRefs.current.forEach((el, n) => {
        const r = el.getBoundingClientRect();
        rects.push([n, { top: r.top, bottom: r.bottom, height: r.height }]);
      });
      const bestPage = pickCurrentPage(root.scrollTop, rootRect.top, rootRect.bottom, rects);
      if (bestPage > 0 && bestPage !== lastBest) {
        lastBest = bestPage;
        setCurrentPage(bestPage);
      }
    };

    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(compute);
    };

    // ⚠️ Never compute synchronously here: this effect fires the moment
    // `numPages` changes, when the page wrappers are still placeholder-sized —
    // getBoundingClientRect() then returns tiny/stale rects and the probe picks
    // an arbitrary page (the "opens showing 7 / 9" bug). Defer the first probe
    // to a frame, and RE-probe whenever a page wrapper resizes: pdf.js renders
    // pages asynchronously, so heights keep settling for a while after load.
    // (pickCurrentPage also short-circuits scrollTop <= 1 → page 1 and ignores
    // zero-height rects, so the indicator is correct throughout.)
    schedule();
    const ro = new ResizeObserver(schedule);
    pageRefs.current.forEach((el) => ro.observe(el));

    root.addEventListener('scroll', schedule, { passive: true });
    return () => {
      root.removeEventListener('scroll', schedule);
      ro.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [numPages]);

  const goToPage = useCallback((page: number) => {
    const target = clampPage(page, pageRefs.current.size || page);
    const container = scrollRef.current;
    const pageEl = pageRefs.current.get(target);
    if (container && pageEl) scrollPageIntoView(container, pageEl);
  }, []);

  const prevPage = useCallback(() => {
    setCurrentPage((cur) => {
      const target = cur - 1;
      if (target < 1) return cur;
      const container = scrollRef.current;
      const pageEl = pageRefs.current.get(target);
      if (container && pageEl) scrollPageIntoView(container, pageEl);
      return cur;
    });
  }, []);

  const nextPage = useCallback(() => {
    setCurrentPage((cur) => {
      const target = cur + 1;
      if (target > numPages) return cur;
      const container = scrollRef.current;
      const pageEl = pageRefs.current.get(target);
      if (container && pageEl) scrollPageIntoView(container, pageEl);
      return cur;
    });
  }, [numPages]);

  const zoomIn = useCallback(() => setScale((s) => clampScale(s + ZOOM_STEP)), []);
  const zoomOut = useCallback(() => setScale((s) => clampScale(s - ZOOM_STEP)), []);

  const download = useCallback((url: string, name: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, []);

  return {
    numPages,
    pageNumbers,
    currentPage,
    scale,
    pageWidth: pageWidthFor(containerWidth, scale),
    scrollRef,
    registerPage,
    onDocumentLoadSuccess,
    zoomIn,
    zoomOut,
    canZoomIn: scale < 3.0,
    canZoomOut: scale > 0.5,
    goToPage,
    prevPage,
    nextPage,
    canPrev: currentPage > 1,
    canNext: currentPage < numPages,
    download,
  };
}
