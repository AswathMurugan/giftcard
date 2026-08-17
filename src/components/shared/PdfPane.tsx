/* eslint-disable react-hooks/refs -- usePdfViewer intentionally returns refs
   (scrollRef, registerPage) that are attached in JSX ref props; the strict
   react-hooks/refs rule mis-flags that supported pattern (and even plain reads
   of the hook result) as "accessing a ref during render". */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Document, Page, Thumbnail } from 'react-pdf';
// Import the viewer hook DIRECTLY (not via @/hooks) so the PDF engine only loads
// in the lazily-imported chunks that render a viewer — see DOCUMENT-VIEWER.md.
import { usePdfViewer } from '@/hooks/usePdfViewer';
import { clampToolbarOffset } from '@/hooks/pdf-viewer-utils';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { downloadIfAllowed } from '@/lib/download-guard';

/**
 * The shared rich PDF pane: a toolbar (page nav + a "…" overflow menu with
 * zoom / download / full-screen) over a scrollable page stack. Use this for the
 * standard in-app PDF view instead of hand-composing `usePdfViewer` + react-pdf
 * (see DOCUMENT-VIEWER.md) — one implementation keeps every viewer consistent.
 * Drop to the hook directly only for bespoke chrome.
 *
 * **Lazy-load it** — react-pdf/pdfjs is heavy, so import via
 * `lazy(() => import('@/components/shared/PdfPane'))` on the screen that shows a
 * PDF; never import it from always-loaded code.
 *
 * Download is uniformly guarded via `downloadIfAllowed` (a sandboxed CSP blocks
 * the save with no JS error; the guard toasts instead of failing silently).
 *
 * `showPageRail` renders the optional left per-PAGE thumbnail rail. A multi-
 * DOCUMENT viewer keeps its own document-list rail OUTSIDE this pane (wrap
 * PdfPane) and leaves this off.
 */
export function PdfPane({
  url,
  name,
  showPageRail = false,
  rootClassName = 'flex h-full min-h-0 flex-col',
  pageStackClassName = 'bg-grayscale-100',
}: {
  url: string;
  name: string;
  showPageRail?: boolean;
  /** Root container classes — override the height model (e.g. `flex-1` inside a
   *  flex dialog vs `h-full` inside a fixed-height frame). */
  rootClassName?: string;
  /** Background for the scrollable page canvas. */
  pageStackClassName?: string;
}) {
  const v = usePdfViewer(url);
  const rootRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // The toolbar is a floating pill that the user can drag around the pane by its
  // grip handle. `drag` is the (x, y) offset from the bar's base position
  // (horizontally centered, pinned near the top); clamped so it can't leave the
  // pane. Pointer capture on the grip keeps the drag alive outside the button.
  const barRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const [menuOpen, setMenuOpen] = useState(false);
  const [pageInput, setPageInput] = useState('1');
  const dragOrigin = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);
  const onGripDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      dragOrigin.current = { px: e.clientX, py: e.clientY, ox: drag.x, oy: drag.y };
    },
    [drag.x, drag.y],
  );
  const onGripMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const o = dragOrigin.current;
    const root = rootRef.current;
    const bar = barRef.current;
    if (!o || !root || !bar) return;
    const rb = root.getBoundingClientRect();
    const bb = bar.getBoundingClientRect();
    setDrag(
      clampToolbarOffset(o.ox + (e.clientX - o.px), o.oy + (e.clientY - o.py), {
        rootWidth: rb.width,
        rootHeight: rb.height,
        barWidth: bb.width,
        barHeight: bb.height,
        baseLeft: rb.width / 2 - bb.width / 2,
        baseTop: 12, // top-[0.75rem]
      }),
    );
  }, []);
  const onGripUp = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    dragOrigin.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);
  const handleDownload = useCallback(
    () => downloadIfAllowed(() => v.download(url, name)),
    [v, url, name],
  );
  const commitPage = useCallback(() => {
    const page = Number.parseInt(pageInput, 10);
    if (Number.isInteger(page)) v.goToPage(page);
    else setPageInput(String(v.currentPage));
  }, [pageInput, v.currentPage, v.goToPage]);
  // Native Fullscreen API on the pane root (Esc exits). requestFullscreen must
  // run in the click gesture — the DropdownMenuItem select IS that gesture.
  const toggleFullscreen = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void el.requestFullscreen?.();
  }, []);
  useEffect(() => {
    const onChange = () => {
      const fullscreenElement = document.fullscreenElement;
      setIsFullscreen(
        fullscreenElement === rootRef.current ||
          !!fullscreenElement?.contains(rootRef.current),
      );
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  useEffect(() => {
    setPageInput(String(v.currentPage));
  }, [v.currentPage]);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!barRef.current?.contains(target)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const pageStack = (
    <div ref={v.scrollRef} className={cn('min-h-0 flex-1 overflow-auto', pageStackClassName)}>
      <Document
        file={url}
        onLoadSuccess={v.onDocumentLoadSuccess}
        loading={<div className="grid place-content-center py-10"><Spinner /></div>}
        error={<p className="py-10 text-center text-[0.875rem] text-destructive">Couldn’t render “{name}”.</p>}
      >
        {v.pageNumbers.map((n) => (
          <div key={n} ref={v.registerPage(n)} className="flex justify-center py-2.5">
            <Page pageNumber={n} width={v.pageWidth} className="shadow-sm" />
          </div>
        ))}
      </Document>
    </div>
  );

  return (
    <div ref={rootRef} className={cn(rootClassName, 'relative bg-background')}>
      {/* Floating, draggable toolbar pill (grip handle · page nav · "…" overflow
          menu with zoom / download / full-screen). Absolutely positioned so it
          hovers over the page stack, centered near the top; drag it by the grip. */}
      <div
        ref={barRef}
        className="absolute left-1/2 top-[0.75rem] z-20"
        style={{ transform: `translate(calc(-50% + ${drag.x}px), ${drag.y}px)` }}
      >
        <div className="flex items-center gap-0.5 rounded-full border border-grayscale-200 bg-grayscale-50 px-2 py-1.5 shadow-md dark:bg-grayscale-900">
          <button
            type="button"
            aria-label="Move toolbar"
            onPointerDown={onGripDown}
            onPointerMove={onGripMove}
            onPointerUp={onGripUp}
            className="flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-full text-grayscale-500 transition-colors hover:bg-grayscale-100 active:cursor-grabbing dark:hover:bg-grayscale-800"
          >
            <i className="icon icon_-Tb_grip_vertical text-[1rem]" aria-hidden="true" />
          </button>
          <Button variant="ghost" size="icon" disabled={!v.canPrev} onClick={v.prevPage} aria-label="Previous page" className="size-7 rounded-full text-grayscale-900 hover:bg-grayscale-100 hover:text-grayscale-900 disabled:text-grayscale-400 dark:text-grayscale-100 dark:hover:bg-grayscale-800 dark:hover:text-grayscale-100">
            <i className="icon icon_-Tb_chevron_left text-[1rem]" aria-hidden="true" />
          </Button>
          <span
            aria-label={`Page ${v.currentPage} of ${v.numPages || 1}`}
            className="flex h-[2rem] w-fit min-w-[3.75rem] items-center justify-center gap-1 rounded-md border border-grayscale-200 bg-background px-2 text-[0.9375rem] tabular-nums text-foreground"
          >
            <input
              aria-label="Current page"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              onBlur={commitPage}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitPage();
                  e.currentTarget.blur();
                }
              }}
              // Width tracks the digit count so 3-digit pages ("120 / 250") don't clip.
              style={{ width: `${Math.max(pageInput.length, 1)}ch` }}
              className="appearance-none bg-transparent text-center font-semibold outline-none"
            />
            <span className="text-grayscale-400">/</span>
            <span className="text-grayscale-600 dark:text-grayscale-300">{v.numPages || 1}</span>
          </span>
          <Button variant="ghost" size="icon" disabled={!v.canNext} onClick={v.nextPage} aria-label="Next page" className="size-7 rounded-full text-grayscale-900 hover:bg-grayscale-100 hover:text-grayscale-900 disabled:text-grayscale-400 dark:text-grayscale-100 dark:hover:bg-grayscale-800 dark:hover:text-grayscale-100">
            <i className="icon icon_-Tb_chevron_right text-[1rem]" aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="icon" aria-label="More options" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)} className="size-7 rounded-full text-grayscale-900 hover:bg-grayscale-100 hover:text-grayscale-900 dark:text-grayscale-100 dark:hover:bg-grayscale-800">
            <i className="icon icon_-Tb_dots text-[1rem]" aria-hidden="true" />
          </Button>
          {menuOpen && (
            <div role="menu" className="absolute right-[-4.5rem] top-full z-50 w-[11.5rem] rounded-lg border border-border bg-popover p-2 text-grayscale-900 shadow-lg dark:text-grayscale-100">
              {/* Keep this menu inside the PDF pane so it remains visible in fullscreen mode. */}
              <button type="button" role="menuitem" className="flex min-h-[2.5rem] w-full items-center gap-3 rounded-md p-2 text-left text-[0.9375rem] hover:bg-accent disabled:pointer-events-none disabled:opacity-50" disabled={!v.canZoomOut} onClick={() => v.zoomOut()}>
                <i className="icon icon_-Tb_zoom_out text-[1.125rem] text-grayscale-500! dark:text-grayscale-400!" aria-hidden="true" /> Zoom Out
              </button>
              <button type="button" role="menuitem" className="flex min-h-[2.5rem] w-full items-center gap-3 rounded-md p-2 text-left text-[0.9375rem] hover:bg-accent disabled:pointer-events-none disabled:opacity-50" disabled={!v.canZoomIn} onClick={() => v.zoomIn()}>
                <i className="icon icon_-Tb_zoom_in text-[1.125rem] text-grayscale-500! dark:text-grayscale-400!" aria-hidden="true" /> Zoom In
              </button>
              <button type="button" role="menuitem" className="flex min-h-[2.5rem] w-full items-center gap-3 rounded-md p-2 text-left text-[0.9375rem] hover:bg-accent" onClick={() => { setMenuOpen(false); handleDownload(); }}>
                <i className="icon icon_-Tb_download text-[1.125rem] text-grayscale-500! dark:text-grayscale-400!" aria-hidden="true" /> Download
              </button>
              <button type="button" role="menuitem" className="flex min-h-[2.5rem] w-full items-center gap-3 whitespace-nowrap rounded-md p-2 text-left text-[0.9375rem] hover:bg-accent" onClick={() => { setMenuOpen(false); toggleFullscreen(); }}>
                <i className={`icon ${isFullscreen ? 'icon_-Tb_arrows_diagonal_minimize_2' : 'icon_-Tb_arrows_diagonal'} text-[1.125rem] text-grayscale-500! dark:text-grayscale-400!`} aria-hidden="true" />
                {isFullscreen ? 'Exit Full Screen' : 'Full Screen'}
              </button>
            </div>
          )}
        </div>
      </div>

      {showPageRail ? (
        <div className="flex min-h-0 flex-1">
          {/* Left page-thumbnail rail (hidden on narrow widths). Its own
              <Document> renders the lightweight thumbnails; click one to jump. */}
          {v.numPages > 1 && (
            <aside className="hidden w-[9.75rem] shrink-0 overflow-auto border-r border-input bg-grayscale-100 p-2 sm:block">
              <Document file={url} loading={null} error={null}>
                <div className="flex flex-col gap-2">
                  {v.pageNumbers.map((n) => (
                    <PdfThumb key={n} pageNumber={n} active={n === v.currentPage} width={124} onSelect={v.goToPage} />
                  ))}
                </div>
              </Document>
            </aside>
          )}
          {pageStack}
        </div>
      ) : (
        pageStack
      )}
    </div>
  );
}

/** One clickable page thumbnail in the left rail (own component → stable handler). */
function PdfThumb({
  pageNumber,
  active,
  width,
  onSelect,
}: {
  pageNumber: number;
  active: boolean;
  width: number;
  onSelect: (n: number) => void;
}) {
  const handleClick = useCallback(() => onSelect(pageNumber), [onSelect, pageNumber]);
  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={`Go to page ${pageNumber}`}
      aria-current={active}
      className={cn(
        'flex w-full flex-col items-center gap-1 rounded-md border p-1.5 transition-colors',
        active ? 'border-primary-400 bg-primary-50' : 'border-transparent hover:border-input',
      )}
    >
      <Thumbnail pageNumber={pageNumber} width={width} />
      <span
        className={cn(
          'text-[0.75rem] tabular-nums',
          active ? 'font-semibold text-primary-700' : 'text-muted-foreground',
        )}
      >
        {pageNumber}
      </span>
    </button>
  );
}
