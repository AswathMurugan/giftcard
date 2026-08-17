# Document / PDF viewer (read FIRST for any in-app document preview)

**For the standard rich PDF view, use the shared `<PdfPane>` component**
(`@/components/shared/PdfPane`) — a ready **floating, draggable toolbar pill**
(grip handle · page nav · a "…" overflow menu with zoom / download /
full-screen) hovering over a scrollable page stack. It's the ONE consistent
viewer across every app; don't hand-roll a new one. `PdfPane` already encodes
the correct behavior (controlled zoom/paging, a grip-draggable toolbar clamped
to the pane, a download guarded against the CSP sandbox, an optional per-page
thumbnail rail).

```tsx
import { lazy, Suspense } from 'react';
import { Spinner } from '@/components/ui/spinner';
// react-pdf/pdfjs is heavy — LAZY-load the pane so the PDF engine only loads on
// the screen that shows a PDF (never import PdfPane from always-loaded code).
const PdfPane = lazy(() =>
  import('@/components/shared/PdfPane').then((m) => ({ default: m.PdfPane })));

<Suspense fallback={<Spinner />}>
  <PdfPane url={url} name={name} />          {/* showPageRail, rootClassName optional */}
</Suspense>
```

**Only compose the hook yourself when `PdfPane` genuinely doesn't fit** (bespoke
toolbar, or an *embedded* multi-DOCUMENT rail — in which case wrap `PdfPane` and
keep your document-list chrome outside it). The hook path is documented below;
it mirrors the file-upload (`FILE-UPLOAD.md`) and address (`ADDRESS.md`)
patterns: the hook does the logic; you render the thin markup.

`react-pdf` + `pdfjs-dist` are already installed — don't add another PDF library.

> **An `<iframe>` is NOT acceptable for PDFs.** It only gives the browser's bare
> plugin (no controlled zoom/paging). Use `usePdfViewer` + `react-pdf`. Images
> (`.png`/`.jpg`) don't need this — render them with a plain `<img>`.

---

## 1. Get a URL to view

For a file in **Jiffy Drive**, HOW you resolve the URL depends on what renders it:

- **PDFs (react-pdf) — ALWAYS `useDriveFiles().download(fileId)`** → `Blob` →
  `URL.createObjectURL(blob)` (revoke it when the viewer closes).

  > ⚠️ **A presigned S3 URL does NOT work with react-pdf.** react-pdf loads the
  > bytes with `fetch()`, which is CORS-gated — and the Drive S3 bucket has no
  > CORS policy for app origins, so the viewer hangs forever at "Loading PDF…"
  > with a CORS error in the console. (The presigned URL also carries
  > `response-content-disposition: attachment` — download semantics, not
  > inline view.) The Drive `download` endpoint goes through the app's own
  > gateway (already auth/CORS-wired), so the blob route always renders.

- **Images (`<img src>`) / save-to-disk links** —
  `useDriveFiles().getPresignedUrl(fileId)` → a time-limited S3 URL is fine
  (`FILE-UPLOAD.md`); plain `<img>` loads aren't CORS-gated.
- **Signing documents** → `useSignatures().getDocumentUrl(documentId)`
  (`SIGNATURE.md`) — already returns a blob object URL.

When resolving in a `useEffect`, **depend on the destructured callback**
(`const { download } = useDriveFiles()` → dep `[download]`), never on the whole
hook result — the result object changes identity across renders, so using it as
an effect dep refires the effect after its own setState: an infinite fetch loop.

---

## 2. The hook — `usePdfViewer(resetKey)`

```ts
// IMPORTANT: import DIRECTLY — it is NOT in the `@/hooks` barrel, so react-pdf /
// pdfjs-dist only load on the route that actually views a PDF.
import { usePdfViewer, isPdfFile } from '@/hooks/usePdfViewer';
import { Document, Page } from 'react-pdf';
```

```ts
const v = usePdfViewer(url); // pass the URL as the reset key
// v: numPages, pageNumbers, currentPage, scale, pageWidth, scrollRef,
//    registerPage(n), onDocumentLoadSuccess, zoomIn/zoomOut (+canZoomIn/Out),
//    prevPage/nextPage (+canPrev/canNext), goToPage(n), download(url, name)
```

The pdf.js worker is configured by the hook on import — you don't wire it.

---

## 3. Render pattern — the hook (only for custom chrome; else use `<PdfPane>`)

```tsx
function PdfView({ url, name }: { url: string; name: string }) {
  const v = usePdfViewer(url);
  return (
    <div className="flex h-full flex-col">
      {/* toolbar — shadcn Buttons wired to the hook */}
      <div className="flex items-center gap-2 border-b border-border p-2">
        <Button variant="ghost" disabled={!v.canPrev} onClick={v.prevPage} aria-label="Previous page">
          <i className="icon icon_-Tb_chevron_left text-[1.25rem]" aria-hidden />
        </Button>
        <span>{v.currentPage} / {v.numPages || 1}</span>
        <Button variant="ghost" disabled={!v.canNext} onClick={v.nextPage} aria-label="Next page">
          <i className="icon icon_-Tb_chevron_right text-[1.25rem]" aria-hidden />
        </Button>
        <Button variant="ghost" disabled={!v.canZoomOut} onClick={v.zoomOut} aria-label="Zoom out">−</Button>
        <span>{Math.round(v.scale * 100)}%</span>
        <Button variant="ghost" disabled={!v.canZoomIn} onClick={v.zoomIn} aria-label="Zoom in">+</Button>
        <Button variant="ghost" onClick={() => v.download(url, name)} aria-label="Download">
          <i className="icon icon_-Tb_download text-[1.25rem]" aria-hidden />
        </Button>
      </div>
      {/* scrollable page stack — scrollRef enables current-page tracking */}
      <div ref={v.scrollRef} className="min-h-0 flex-1 overflow-auto bg-muted/30">
        <Document file={url} onLoadSuccess={v.onDocumentLoadSuccess}>
          {v.pageNumbers.map((n) => (
            <div key={n} ref={v.registerPage(n)} className="flex justify-center py-2">
              <Page pageNumber={n} width={v.pageWidth} />
            </div>
          ))}
        </Document>
      </div>
    </div>
  );
}
```

- **Route by type:** `isPdfFile({ url, mimeType })` → `<PdfView/>`; otherwise an
  image → `<img src={url} className="max-h-full" />`.
- **Pop-out:** render `<PdfView/>` inside a shadcn `Dialog` and revoke any
  object URL on close. **Width gotcha:** the base `DialogContent` carries
  `sm:max-w-sm` — an unprefixed `max-w-*` in your `className` does NOT replace
  it (tailwind-merge only merges same-prefix classes), so the dialog silently
  caps at 384px. For a wide viewer pass an `sm:`-prefixed override, e.g.
  `className="h-[92vh] w-[min(1200px,96vw)] sm:max-w-[96vw]"`.
- **Multiple documents:** wrap several `<PdfView/>` panes in a shadcn `Tabs`
  (one tab per document). The hook is per-instance, so give each pane its own
  `usePdfViewer(url)`.

---

## 4. Guardrails

- **No viewer component, no iframe for PDFs.** Compose `usePdfViewer` +
  `react-pdf`. Images use `<img>`.
- **Never feed react-pdf a presigned S3 URL** — CORS blocks the fetch and the
  viewer hangs at "Loading PDF…". Drive PDFs go `download(fileId)` → blob →
  object URL (see §1). Presigned URLs are for `<img>` and download links only.
- **Import `usePdfViewer` directly** from `@/hooks/usePdfViewer` (not the
  `@/hooks` barrel) so the PDF engine stays off other routes' bundles.
- **Don't add another PDF library** (`@react-pdf-viewer`, `pdf-lib`,
  `pdfjs-express`, …) — `react-pdf` + `pdfjs-dist` are already installed.
- **Revoke object URLs** created from `URL.createObjectURL` when the viewer
  closes, to avoid leaks.
- Ship a colocated test for any pure helper you add (the hook's helpers —
  `clampScale`, `isPdfFile`, `pageWidthFor`, `clampPage` — are covered in
  `pdf-viewer-utils.test.ts`).
