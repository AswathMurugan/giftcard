/**
 * useDriveFiles — upload, view, and download files via Jiffy Drive.
 *
 * There is NO file-upload UI component in this starter (by design — the design
 * system says compose, don't fork). Render the dropzone yourself from shadcn
 * primitives (a hidden `Input type="file"` + a dashed drop area + a ghost
 * Browse button) and drive the I/O with this hook. See src/queries/FILE-UPLOAD.md
 * for the full pattern, the enum values, and how to gate the trigger by
 * permission.
 *
 * Transport is already wired: the `drive` service is configured in
 * src/config/api-config.ts (`origin/drive`, tenant/env headers, auth provider,
 * 403-refresh). This hook just shapes the requests:
 *   - upload         → POST   /api/v1/files                 (multipart)
 *   - view (img/link)→ GET    /api/v1/files/{id}/presigned-url  → time-limited S3 URL
 *                      (⚠️ NOT for react-pdf — its fetch() is CORS-blocked by S3;
 *                       PDFs use download → blob → object URL, see DOCUMENT-VIEWER.md)
 *   - download (blob)→ GET    /api/v1/files/{id}/download    (raw bytes; also the
 *                      source for in-app PDF viewing)
 *   - metadata       → GET    /api/v1/files/{id}
 *   - delete         → DELETE /api/v1/files/{id}
 *
 * ⚠️ `scope` is REQUIRED and intentionally has NO default — it must be one of
 * `PLATFORM | APPS | PUBLIC_ASSETS` (anything else 400s "invalid scope"). ASK
 * THE USER which scope to use rather than assuming. For `APPS` pass `appName`.
 */
import { useCallback, useMemo, useState } from 'react';
import type { AxiosProgressEvent } from 'axios';

import { apiManager } from '@/services/api-manager';
import { getAppConfig } from '@/config/api-config';
import { logger } from '@/utils/logger';

const DRIVE_SERVICE = 'drive';
const DRIVE_BASE = '/api/v1/files';

// ── Enums (from the Drive swagger; `scope` kept permissive on purpose) ────────

/**
 * File scope. The Drive API accepts exactly `PLATFORM | APPS | PUBLIC_ASSETS`.
 * The union stays permissive (`string & {}`) only to survive a future server
 * rename — but the agent must pick one of the three documented values; anything
 * else 400s with "invalid scope".
 */
export type DriveScope = 'PLATFORM' | 'APPS' | 'PUBLIC_ASSETS' | (string & {});

export type DriveRetentionPolicy =
  | 'TEMP_7_DAYS'
  | 'TEMP_30_DAYS'
  | 'TEMP_90_DAYS'
  | 'STANDARD_1_YEAR'
  | 'BUSINESS_3_YEAR'
  | 'COMPLIANCE_7_YEAR';

export type DriveClassification =
  | 'PUBLIC'
  | 'INTERNAL'
  | 'CONFIDENTIAL'
  | 'RESTRICTED';

// ── Options + result shapes ───────────────────────────────────────────────────

export interface DriveUploadOptions {
  /**
   * REQUIRED. One of `PLATFORM | APPS | PUBLIC_ASSETS` — ASK the user. No
   * default is assumed (the wrong value 400s).
   */
  scope: DriveScope;
  /** Required when `scope === 'APPS'`. Defaults to the current app's name. */
  appName?: string;
  /**
   * Optional service identifier (e.g. 'UI', 'ETL'). Sent as `service_name`
   * whenever provided; supply it only if the chosen scope requires it.
   */
  serviceName?: string;
  /** Organize the file into a folder (auto-created if absent). */
  folderPath?: string;
  /** Data classification. Defaults to `INTERNAL`. */
  classification?: DriveClassification;
  /** Retention policy. Defaults to `TEMP_7_DAYS`. */
  retentionPolicy?: DriveRetentionPolicy;
  /** Keep the original filename rather than a generated one. */
  preserveFilename?: boolean;
  /** Owner id to stamp on the file. */
  ownerId?: string;
}

/** Shape of `POST /api/v1/files` → internal_api.FileUploadResponse. */
export interface DriveUploadResult {
  file_id: string;
  storage_key: string;
  folder_path?: string;
  cdn_url?: string;
}

/** Subset of `GET /api/v1/files/{id}` → internal_api.FileResponse. */
export interface DriveFileMetadata {
  file_id: string;
  original_filename?: string;
  detected_mime_type?: string;
  extension?: string;
  size_bytes?: number;
  storage_key?: string;
  folder_path?: string;
  classification?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
}

// ── Pure helpers (exported for unit tests — no DOM, no network) ───────────────

/**
 * Build the multipart body for an upload. Pure: takes the file + options and
 * the resolved default app name, returns a `FormData`. Only sends fields that
 * are present (Drive rejects empty enum strings). Booleans are stringified
 * (`'true'`/`'false'`) as the API expects.
 */
export function buildDriveFormData(
  file: File,
  options: DriveUploadOptions,
  defaultAppName: string | undefined,
): FormData {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('scope', options.scope);
  fd.append('retention_policy', options.retentionPolicy ?? 'TEMP_7_DAYS');
  fd.append('classification', options.classification ?? 'INTERNAL');

  const appName = options.appName ?? defaultAppName;
  if (options.scope === 'APPS' && appName) fd.append('app_name', appName);
  // `service_name` is decoupled from a specific scope (its old `COMMON`
  // companion was removed) — send it whenever the caller provides one.
  if (options.serviceName) {
    fd.append('service_name', options.serviceName);
  }
  if (options.folderPath) fd.append('folder_path', options.folderPath);
  if (options.ownerId) fd.append('owner_id', options.ownerId);
  if (options.preserveFilename !== undefined) {
    fd.append('preserve_filename', String(options.preserveFilename));
  }
  return fd;
}

/** Lowercase extension without the dot, or '' when none. */
export function fileExtension(filename: string | null | undefined): string {
  if (!filename || typeof filename !== 'string') return '';
  const base = filename.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  return base.slice(dot + 1).toLowerCase();
}

/** Human-readable byte size. Guards against non-finite / negative input. */
export function formatBytes(bytes: number | null | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) {
    return '—';
  }
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / Math.pow(1024, i);
  const rounded = i === 0 ? value : Math.round(value * 100) / 100;
  return `${rounded} ${units[i]}`;
}

/**
 * Whether a MIME type can be previewed inline in the browser (image / pdf /
 * plain text). Other types should be offered as a download instead.
 */
export function isPreviewableMime(mime: string | null | undefined): boolean {
  if (!mime || typeof mime !== 'string') return false;
  const m = mime.toLowerCase();
  return (
    m.startsWith('image/') ||
    m === 'application/pdf' ||
    m.startsWith('text/')
  );
}

/** Clamp an upload progress event to an integer 0–100. */
export function uploadProgressPercent(
  loaded: number,
  total: number | undefined,
): number {
  if (!total || total <= 0 || loaded < 0) return 0;
  return Math.min(100, Math.max(0, Math.round((loaded / total) * 100)));
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface UseDriveFilesResult {
  /** Upload one file. `scope` is required — ask the user (see doc). */
  upload: (file: File, options: DriveUploadOptions) => Promise<DriveUploadResult>;
  /** Time-limited S3 URL for `<img>` / link / open-tab ONLY. ⚠️ NOT for
   *  react-pdf: its fetch() is CORS-blocked by S3 — PDFs use `download` →
   *  blob → object URL (DOCUMENT-VIEWER.md §1). */
  getPresignedUrl: (fileId: string, expiresIn?: number) => Promise<string>;
  /** Raw bytes — save-to-disk AND the source for in-app PDF viewing. */
  download: (fileId: string) => Promise<Blob>;
  /** Full file metadata. */
  getMetadata: (fileId: string) => Promise<DriveFileMetadata>;
  /** Soft-delete a file (WORM-protected files refuse until retention expires). */
  remove: (fileId: string) => Promise<void>;
  /** True while an upload is in flight. */
  isUploading: boolean;
  /** Current upload progress (0–100). */
  progress: number;
  /** Last error, or null. */
  error: unknown;
}

export function useDriveFiles(): UseDriveFilesResult {
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<unknown>(null);

  const upload = useCallback(
    async (file: File, options: DriveUploadOptions): Promise<DriveUploadResult> => {
      setIsUploading(true);
      setProgress(0);
      setError(null);
      const body = buildDriveFormData(file, options, getAppConfig().appName);
      logger.log('drive:upload:request', {
        name: file.name,
        size: file.size,
        scope: options.scope,
      });
      try {
        const response = await apiManager.post(
          DRIVE_SERVICE,
          DRIVE_BASE,
          body,
          {},
          {
            onUploadProgress: (e: AxiosProgressEvent) =>
              setProgress(uploadProgressPercent(e.loaded, e.total)),
          },
        );
        setProgress(100);
        logger.log('drive:upload:success', { name: file.name });
        return response.data as DriveUploadResult;
      } catch (err) {
        setError(err);
        logger.error('drive:upload:error', {
          name: file.name,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      } finally {
        setIsUploading(false);
      }
    },
    [],
  );

  const getPresignedUrl = useCallback(
    async (fileId: string, expiresIn?: number): Promise<string> => {
      const response = await apiManager.get(
        DRIVE_SERVICE,
        `${DRIVE_BASE}/${encodeURIComponent(fileId)}/presigned-url`,
        {},
        expiresIn ? { params: { expires_in: expiresIn } } : {},
      );
      return (response.data as { url: string }).url;
    },
    [],
  );

  const download = useCallback(async (fileId: string): Promise<Blob> => {
    const response = await apiManager.get(
      DRIVE_SERVICE,
      `${DRIVE_BASE}/${encodeURIComponent(fileId)}/download`,
      {},
      { responseType: 'blob' },
    );
    return response.data as Blob;
  }, []);

  const getMetadata = useCallback(
    async (fileId: string): Promise<DriveFileMetadata> => {
      const response = await apiManager.get(
        DRIVE_SERVICE,
        `${DRIVE_BASE}/${encodeURIComponent(fileId)}`,
      );
      return response.data as DriveFileMetadata;
    },
    [],
  );

  const remove = useCallback(async (fileId: string): Promise<void> => {
    await apiManager.get(
      DRIVE_SERVICE,
      `${DRIVE_BASE}/${encodeURIComponent(fileId)}`,
      {},
      { method: 'DELETE' },
    );
  }, []);

  // Memoized so the result object is referentially stable across renders.
  // Without this, `const drive = useDriveFiles()` used as a useEffect dep
  // refires the effect after every render — and since the effect usually
  // setStates, that's an INFINITE fetch loop (seen in generated apps as
  // presigned-url/download requests looping forever). Even so, prefer
  // depending on the individual callback you use (`download`,
  // `getPresignedUrl`, …) — they are stable `useCallback`s, while this object
  // still changes identity whenever `isUploading`/`progress`/`error` change.
  return useMemo(
    () => ({
      upload,
      getPresignedUrl,
      download,
      getMetadata,
      remove,
      isUploading,
      progress,
      error,
    }),
    [upload, getPresignedUrl, download, getMetadata, remove, isUploading, progress, error],
  );
}
