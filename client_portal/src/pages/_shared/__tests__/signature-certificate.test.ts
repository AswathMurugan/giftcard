/**
 * The signature certificate.
 *
 * Two things carry real weight here: the certificate must never be able to
 * misstate WHEN something was signed (a stamp without a zone is worth little
 * across a dispute), and the pointer that finds it again must survive round-
 * tripping through a free-text field a human also types into.
 */
import { describe, it, expect } from 'vitest';
import {
  buildSignatureCertificateHtml,
  certificateFilename,
  certificateNoteText,
  formatStamp,
  readCertificateRef,
  withCertificateRef,
  type SignatureCertificateInput,
} from '@/pages/_shared/signature-certificate';

const INPUT: SignatureCertificateInput = {
  kind: 'proposal',
  signedBy: 'Marcus Lindqvist',
  signedAt: '2026-08-17T06:36:26.184Z',
  orderCode: 'GC-1002',
  partyName: 'Williams-Sonoma',
  subject: '6,000 Winter Table gift cards',
  facts: [
    ['Document', 'Proposal version 1'],
    ['Total accepted', '$6,484.01 USD'],
  ],
  effect: 'This authorises production.',
};

describe('signature-certificate', { tags: ['signature', 'logic'] }, () => {
  describe('formatStamp', { tags: ['important'] }, () => {
    it('always states the zone', () => {
      // "17 August 2026, 07:36" without a zone is ambiguous across borders,
      // which is exactly when a certificate matters.
      const s = formatStamp('2026-08-17T06:36:26.184Z');
      expect(s).toContain('UTC');
      expect(s).toContain('2026');
      expect(s).toContain('06:36:26');
    });

    it('renders in UTC regardless of where it is read', () => {
      // Same instant, written two ways — one stamp.
      expect(formatStamp('2026-08-17T06:36:26Z')).toBe(
        formatStamp('2026-08-17T08:36:26+02:00'),
      );
    });

    it('returns the input unchanged when it is not a date', { tags: ['edge-case'] }, () => {
      expect(formatStamp('not-a-date')).toBe('not-a-date');
    });
  });

  describe('certificateFilename', { tags: ['important'] }, () => {
    it('is unique per signing instant, so a second round cannot overwrite the first', () => {
      const a = certificateFilename(INPUT);
      const b = certificateFilename({ ...INPUT, signedAt: '2026-08-17T06:36:27.000Z' });
      expect(a).not.toBe(b);
    });

    it('carries the order and the kind, and is filesystem-safe', () => {
      const name = certificateFilename(INPUT);
      expect(name).toContain('GC-1002');
      expect(name).toContain('proposal');
      expect(name.endsWith('.pdf')).toBe(true);
      // Colons and dots from the ISO instant would break object keys.
      expect(name.slice(0, -4)).not.toContain(':');
    });
  });

  describe('buildSignatureCertificateHtml', { tags: ['important'] }, () => {
    it('states the signature, the party and the stamped time', () => {
      const html = buildSignatureCertificateHtml(INPUT);
      expect(html).toContain('Marcus Lindqvist');
      expect(html).toContain('Williams-Sonoma');
      expect(html).toContain('GC-1002');
      expect(html).toContain('UTC');
      expect(html).toContain('Certificate of Acceptance');
    });

    it('titles a proof approval differently from a proposal acceptance', () => {
      const proof = buildSignatureCertificateHtml({ ...INPUT, kind: 'proof' });
      expect(proof).toContain('Certificate of Approval');
      expect(proof).not.toContain('Certificate of Acceptance');
    });

    it('escapes the signature rather than letting it inject markup', { tags: ['important'] }, () => {
      // The signature is user input rendered into a document that is then
      // rasterised server-side — it must not be able to carry markup.
      const html = buildSignatureCertificateHtml({
        ...INPUT,
        signedBy: '<script>alert(1)</script>',
      });
      expect(html).not.toContain('<script>alert(1)</script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('inlines everything — the renderer resolves no external assets', () => {
      const html = buildSignatureCertificateHtml(INPUT);
      expect(html).not.toContain('<img');
      expect(html).not.toContain('<link');
      expect(html).not.toMatch(/src\s*=\s*["']https?:/);
    });
  });

  describe('certificate reference', { tags: ['important'] }, () => {
    it('round-trips through the note field', () => {
      const note = withCertificateRef('Signed by Marcus Lindqvist', {
        fileId: '01M076Z45FYPJ9XHVY0YDYEN0X',
        fileName: 'GC-1002-proposal-signature.pdf',
      });
      const ref = readCertificateRef(note);
      expect(ref?.fileId).toBe('01M076Z45FYPJ9XHVY0YDYEN0X');
      expect(ref?.fileName).toBe('GC-1002-proposal-signature.pdf');
    });

    it('leaves the human note readable once the pointer is stripped', () => {
      const note = withCertificateRef('Colour is too warm', {
        fileId: 'F1',
        fileName: 'x.pdf',
      });
      expect(certificateNoteText(note)).toBe('Colour is too warm');
    });

    it('returns null when there is no certificate', { tags: ['edge-case'] }, () => {
      expect(readCertificateRef(null)).toBeNull();
      expect(readCertificateRef(undefined)).toBeNull();
      expect(readCertificateRef('')).toBeNull();
      // A signature recorded before certificates existed.
      expect(readCertificateRef('Signed by Dana Whitfield')).toBeNull();
    });

    it('does not fabricate a pointer from prose containing brackets', { tags: ['edge-case'] }, () => {
      expect(readCertificateRef('Please fix [the logo] on panel 2')).toBeNull();
    });

    it('keeps the note intact when there is nothing to append', { tags: ['edge-case'] }, () => {
      expect(withCertificateRef('  just a note  ', null)).toBe('just a note');
      expect(withCertificateRef('', null)).toBe('');
    });
  });
});
