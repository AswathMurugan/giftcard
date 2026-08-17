/**
 * Opening a stored signature certificate.
 *
 * The bytes come back as a blob and are opened from an object URL rather than
 * linked directly: Drive's presigned S3 URL is fine for an `<img>` but a PDF
 * fetched from it is CORS-blocked, and the id alone is not a URL a browser can
 * follow. Download → blob → object URL is the path that actually works, and
 * it is the same one the in-app PDF viewer uses.
 *
 * The object URL is revoked on unmount. They are not garbage-collected, and a
 * client who opens a dozen certificates in a session would otherwise pin every
 * one of them in memory until the tab closed.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useDriveFiles } from '@/hooks';
import type { CertificateRef } from './signature-certificate';

export function CertificateLink({
  certificate,
  label = 'View certificate',
  testId,
}: {
  certificate: CertificateRef | null;
  label?: string;
  testId?: string;
}) {
  const drive = useDriveFiles();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const urls = useRef<string[]>([]);

  useEffect(
    () => () => {
      for (const url of urls.current) URL.revokeObjectURL(url);
      urls.current = [];
    },
    [],
  );

  const open = useCallback(async () => {
    if (!certificate) return;
    setBusy(true);
    setProblem(null);
    try {
      const blob = await drive.download(certificate.fileId);
      const url = URL.createObjectURL(blob);
      urls.current.push(url);
      window.open(url, '_blank', 'noopener');
    } catch (error) {
      setProblem(
        error instanceof Error
          ? `Could not open the certificate: ${error.message}`
          : 'Could not open the certificate.',
      );
    } finally {
      setBusy(false);
    }
  }, [certificate, drive]);

  if (!certificate) return null;

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="outline"
        onClick={open}
        aria-busy={busy}
        disabled={busy}
        data-testid={testId ?? 'view-certificate'}
        title={certificate.fileName}
      >
        <i className="icon icon_-Tb_file_certificate text-[1.125rem]" aria-hidden="true" />
        {label}
      </Button>
      {problem ? (
        <span role="alert" className="text-[11.5px] text-destructive">
          {problem}
        </span>
      ) : null}
    </span>
  );
}

export default CertificateLink;
