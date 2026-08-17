import { toast } from '@/components/ui/toast';

// Platform-wide download guard. The generated app runs inside a CSP-sandboxed
// preview iframe; a `sandbox` policy WITHOUT `allow-downloads` blocks a save
// with no JS error, so a naive download silently no-ops. Detect that and toast
// an honest failure instead. Shared by every in-app document viewer (PdfPane,
// signing viewers, drive-file downloads) so the behavior is identical.

/**
 * Whether a CSP `sandbox` directive omits `allow-downloads` (→ downloads are
 * blocked). Pure — pass the `content-security-policy` header value. A CSP may
 * carry several comma-separated policies; a single blocking one is enough.
 */
export function sandboxBlocksDownloads(csp: string | null | undefined): boolean {
  if (!csp || typeof csp !== 'string') return false;
  for (const policy of csp.split(',')) {
    const match = /(?:^|;)\s*sandbox\b([^;]*)/i.exec(policy);
    if (match && !/\ballow-downloads\b/i.test(match[1])) return true;
  }
  return false;
}

/**
 * Session-cached check of whether the CURRENT document's CSP `sandbox` blocks
 * downloads. The page CSP is static for the session, so the header is fetched
 * at most once and the boolean cached. Resolves `false` when the CSP can't be
 * read (never block on an unreadable CSP); a transient fetch failure is NOT
 * cached so a later click can retry.
 */
let cspCheckPromise: Promise<boolean> | null = null;
export function pageDownloadsBlocked(): Promise<boolean> {
  if (!cspCheckPromise) {
    cspCheckPromise = (async () => {
      try {
        const res = await fetch(window.location.href, { method: 'GET', cache: 'no-store' });
        return sandboxBlocksDownloads(res.headers.get('content-security-policy'));
      } catch {
        cspCheckPromise = null; // don't cache a transient failure — allow a retry
        return false;
      }
    })();
  }
  return cspCheckPromise;
}

/**
 * User-facing message when a document download doesn't complete. A web page
 * can't identify which extension interfered (extensions run in an isolated
 * world with no enumeration API), so we name the likely *category* of cause and
 * the actions to try. A single exported constant keeps the wording testable.
 */
export const DOWNLOAD_FAILED_MESSAGE =
  'Couldn’t download the document. A browser extension or pop-up blocker may be ' +
  'interfering. Try again, disable extensions, or use a different browser.';

/**
 * Run a download action ONLY when the page's CSP sandbox permits saving; toast
 * the honest failure otherwise. `run` may be sync or async.
 */
export async function downloadIfAllowed(run: () => void | Promise<void>): Promise<void> {
  if (await pageDownloadsBlocked()) {
    toast.error(DOWNLOAD_FAILED_MESSAGE);
    return;
  }
  await run();
}
