import { describe, it, expect } from 'vitest';
import {
  buildDriveFormData,
  fileExtension,
  formatBytes,
  isPreviewableMime,
  uploadProgressPercent,
  type DriveUploadOptions,
} from './useDriveFiles';

function makeFile(name = 'doc.pdf', type = 'application/pdf'): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

describe('useDriveFiles helpers', { tags: ['drive', 'logic'] }, () => {
  describe('buildDriveFormData', { tags: ['important'] }, () => {
    it('always includes file, scope, retention, classification', () => {
      const fd = buildDriveFormData(makeFile(), { scope: 'APPS' }, 'myapp');
      expect(fd.get('file')).toBeInstanceOf(File);
      expect(fd.get('scope')).toBe('APPS');
      expect(fd.get('retention_policy')).toBe('TEMP_7_DAYS');
      expect(fd.get('classification')).toBe('INTERNAL');
    });

    it('applies the default app name for APPS scope', () => {
      const fd = buildDriveFormData(makeFile(), { scope: 'APPS' }, 'myapp');
      expect(fd.get('app_name')).toBe('myapp');
    });

    it('prefers an explicit appName over the default', () => {
      const fd = buildDriveFormData(
        makeFile(),
        { scope: 'APPS', appName: 'other' },
        'myapp',
      );
      expect(fd.get('app_name')).toBe('other');
    });

    it('omits app_name for non-APPS scope and sends service_name when given', () => {
      const opts: DriveUploadOptions = { scope: 'PLATFORM', serviceName: 'UI' };
      const fd = buildDriveFormData(makeFile(), opts, 'myapp');
      expect(fd.get('app_name')).toBeNull();
      expect(fd.get('service_name')).toBe('UI');
    });

    it('sends service_name regardless of scope when provided', () => {
      const fd = buildDriveFormData(
        makeFile(),
        { scope: 'APPS', serviceName: 'ETL' },
        'myapp',
      );
      expect(fd.get('service_name')).toBe('ETL');
    });

    it('passes each valid scope through unchanged', () => {
      for (const scope of ['PLATFORM', 'APPS', 'PUBLIC_ASSETS'] as const) {
        const fd = buildDriveFormData(makeFile(), { scope }, 'myapp');
        expect(fd.get('scope')).toBe(scope);
      }
    });

    it('honours overrides and optional fields', () => {
      const fd = buildDriveFormData(
        makeFile(),
        {
          scope: 'APPS',
          classification: 'CONFIDENTIAL',
          retentionPolicy: 'STANDARD_1_YEAR',
          folderPath: 'a/b',
          ownerId: 'u1',
          preserveFilename: true,
        },
        'myapp',
      );
      expect(fd.get('classification')).toBe('CONFIDENTIAL');
      expect(fd.get('retention_policy')).toBe('STANDARD_1_YEAR');
      expect(fd.get('folder_path')).toBe('a/b');
      expect(fd.get('owner_id')).toBe('u1');
      expect(fd.get('preserve_filename')).toBe('true');
    });

    it('omits optional fields when not provided', { tags: ['edge-case'] }, () => {
      const fd = buildDriveFormData(makeFile(), { scope: 'APPS' }, undefined);
      expect(fd.get('folder_path')).toBeNull();
      expect(fd.get('owner_id')).toBeNull();
      expect(fd.get('preserve_filename')).toBeNull();
      expect(fd.get('app_name')).toBeNull(); // no default available
    });

    it('stringifies preserveFilename=false', { tags: ['edge-case'] }, () => {
      const fd = buildDriveFormData(
        makeFile(),
        { scope: 'APPS', preserveFilename: false },
        'myapp',
      );
      expect(fd.get('preserve_filename')).toBe('false');
    });
  });

  describe('fileExtension', { tags: ['logic'] }, () => {
    it('extracts a lowercase extension', () => {
      expect(fileExtension('Report.PDF')).toBe('pdf');
      expect(fileExtension('a/b/c.Tar.GZ')).toBe('gz');
    });

    it('returns empty for no extension / edge cases', { tags: ['edge-case'] }, () => {
      expect(fileExtension('README')).toBe('');
      expect(fileExtension('.gitignore')).toBe('');
      expect(fileExtension('trailing.')).toBe('');
      expect(fileExtension('')).toBe('');
      expect(fileExtension(null)).toBe('');
      expect(fileExtension(undefined)).toBe('');
    });
  });

  describe('formatBytes', { tags: ['logic'] }, () => {
    it('formats common sizes', () => {
      expect(formatBytes(0)).toBe('0 B');
      expect(formatBytes(512)).toBe('512 B');
      expect(formatBytes(1024)).toBe('1 KB');
      expect(formatBytes(1536)).toBe('1.5 KB');
      expect(formatBytes(1048576)).toBe('1 MB');
    });

    it('guards non-finite / negative / non-number', { tags: ['edge-case'] }, () => {
      expect(formatBytes(-1)).toBe('—');
      expect(formatBytes(Number.NaN)).toBe('—');
      expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('—');
      expect(formatBytes(null)).toBe('—');
      expect(formatBytes(undefined)).toBe('—');
    });
  });

  describe('isPreviewableMime', { tags: ['logic'] }, () => {
    it('previews images, pdf, text', () => {
      expect(isPreviewableMime('image/png')).toBe(true);
      expect(isPreviewableMime('application/pdf')).toBe(true);
      expect(isPreviewableMime('text/plain')).toBe(true);
      expect(isPreviewableMime('IMAGE/JPEG')).toBe(true);
    });

    it('rejects others / bad input', { tags: ['edge-case'] }, () => {
      expect(isPreviewableMime('application/zip')).toBe(false);
      expect(isPreviewableMime('video/mp4')).toBe(false);
      expect(isPreviewableMime('')).toBe(false);
      expect(isPreviewableMime(null)).toBe(false);
      expect(isPreviewableMime(undefined)).toBe(false);
    });
  });

  describe('uploadProgressPercent', { tags: ['smoke'] }, () => {
    it('computes a clamped integer percent', () => {
      expect(uploadProgressPercent(0, 100)).toBe(0);
      expect(uploadProgressPercent(50, 100)).toBe(50);
      expect(uploadProgressPercent(100, 100)).toBe(100);
      expect(uploadProgressPercent(1, 3)).toBe(33);
    });

    it('returns 0 for missing/zero total', { tags: ['edge-case'] }, () => {
      expect(uploadProgressPercent(10, undefined)).toBe(0);
      expect(uploadProgressPercent(10, 0)).toBe(0);
      expect(uploadProgressPercent(-5, 100)).toBe(0);
    });

    it('never exceeds 100', { tags: ['edge-case'] }, () => {
      expect(uploadProgressPercent(150, 100)).toBe(100);
    });
  });
});
