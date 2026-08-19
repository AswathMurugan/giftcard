/**
 * Hand a generated file to the browser.
 *
 * Kept out of `csv.ts` deliberately: that module is pure so it can be unit
 * tested under vitest's `node` environment, and the moment it touches
 * `document` those tests need a DOM. This is the thin DOM half.
 *
 * The object URL is revoked on the next frame rather than immediately —
 * Safari has historically cancelled the download if the URL dies in the same
 * tick as the click.
 */
export function downloadTextFile(filename: string, text: string, mime = 'text/csv'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  requestAnimationFrame(() => URL.revokeObjectURL(url));
}
