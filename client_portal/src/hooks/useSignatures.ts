/**
 * useSignatures — load and drive a document-signing envelope (e-sign / wet-sign).
 *
 * There is NO signatures UI component in this starter (by design — same as
 * file-upload and address). Compose the screen yourself from shadcn primitives
 * and drive the data + actions with this hook. See src/queries/SIGNATURE.md for
 * the full pattern (layout, document viewing, guardrails).
 *
 * What it does:
 *   - Loads an envelope from the `docproc` signing API and maps it into ready-to
 *     -render shapes (`accounts`, `signatories`, `documentGroups`, `method`).
 *   - Wet-sign actions: upload a signed copy, revoke a signature, download a
 *     document or the whole bundle, and resolve a document to a viewable URL.
 *   - `markSigned` flips a recipient to signed with an optimistic local label
 *     AND persists it via the docproc mark-signed endpoint.
 *
 * Transport is already wired:
 *   - `docproc` service (src/config/api-config.ts) for the signing endpoints:
 *       GET  /api/v1/signing/envelopes/{id}
 *       POST /api/v1/signing/envelopes/{id}/documents/{docId}/upload-signed
 *       POST /api/v1/signing/envelopes/{id}/documents/{docId}/revoke
 *   - `drive` service (via useDriveFiles) for the document bytes (download/view)
 *     and for uploading the signed copy.
 *
 * The `envelopeId` comes from your own record — e.g. an entity's
 * `e_signature_envelope_id` field read through a saved query.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { apiManager } from '@/services/api-manager';
import { logger } from '@/utils/logger';
import { useDriveFiles } from './useDriveFiles';

const DOCPROC_SERVICE = 'docproc';
const SIGNING_BASE = '/api/v1/signing/envelopes';
const ENVELOPE_SIGNED = 'SIGNED';
const API_DOC_SIGNED = 'SIGNED';

// ── UI types (the shapes your composed screen renders) ────────────────────────

/** How the bundle is signed. */
export type SignMethod = 'e-sign' | 'wet-sign';
/** How the downloadable bundle is grouped. */
export type DocBundleType = 'individual' | 'merged';
/** Status pill for a document row. */
export type SignStatus = 'signed' | 'pending' | 'view' | 'not-started';
/** Per-document-row action affordances. */
export type DocumentRowAction = 'view' | 'upload' | 'reload' | 'revoke';
/** Sign progress shown on an account card. */
export type AccountStatusKind = 'signed' | 'partial' | 'pending';
/** Role-tag colour on a signatory card. */
export type RoleVariant = 'primary' | 'secondary' | 'muted';

/** An account shown in the sidebar. */
export interface SignAccount {
  id: string;
  name: string;
  statusLabel: string;
  statusKind: AccountStatusKind;
  selected?: boolean;
}

/** A single document row inside a document group. */
export interface SignDocumentRow {
  id: string;
  name: string;
  status?: SignStatus;
  actions?: DocumentRowAction[];
  /** Bare Drive file id for this row (signed copy preferred). View/download with it. */
  fileId?: string;
  /** Optional resolved object URL (if you pre-resolved it via getDocumentUrl). */
  fileUrl?: string;
}

/** A collapsible group of documents in the bundle. */
export interface SignDocumentGroup {
  id: string;
  title: string;
  count: number;
  documents: SignDocumentRow[];
  defaultOpen?: boolean;
}

/** A signatory / account holder. */
export interface Signatory {
  id: string;
  name: string;
  email: string;
  role: string;
  roleVariant?: RoleVariant;
  esignStatusLabel?: string;
  esignSigned?: boolean;
  canMarkSigned?: boolean;
}

/** Chip presentation for a document-row status. */
export interface StatusChipSpec {
  variant: 'default' | 'success';
  label: string;
  iconName?: string;
}

// ── API types (what the `docproc` signing endpoints return) ───────────────────

export interface EnvelopeRecipient {
  /** Stable server id for the recipient — the id the mark-signed endpoint expects. */
  recipient_id?: string | null;
  name: string;
  email: string;
  role: string | null;
  status: string;
  signed_at: string | null;
}

export interface EnvelopeDocument {
  id: string;
  envelope_id: string;
  file_id: string;
  signed_file_id: string | null;
  item_name: string;
  status: string;
}

export interface SigningEnvelope {
  id: string;
  app_name: string;
  bundle_key: string;
  bundle_label: string | null;
  provider: string;
  source_record_id: string | null;
  status: string;
  recipients: EnvelopeRecipient[];
  documents: EnvelopeDocument[];
}

// ── Pure helpers (exported for unit tests — no DOM, no network) ────────────────

/** Human-readable bundle name; falls back to the key when no label is set. */
export function bundleDisplayName(envelope: SigningEnvelope): string {
  return envelope.bundle_label ?? envelope.bundle_key;
}

/** Map the envelope provider to a signing method. "wetsign" → wet-sign, else e-sign. */
export function providerToMethod(provider: string | null | undefined): SignMethod {
  return (provider ?? '').toLowerCase().replace(/[-_]/g, '') === 'wetsign'
    ? 'wet-sign'
    : 'e-sign';
}

/** Role label → tag colour. */
export function roleVariantForRole(role: string | null | undefined): RoleVariant {
  switch ((role ?? '').toLowerCase()) {
    case 'client':
    case 'primary':
      return 'primary';
    case 'joint':
    case 'secondary':
      return 'secondary';
    default:
      return 'muted';
  }
}

/** A signed copy's Drive id may carry a "signed::" prefix the Drive API rejects. */
export function stripSignedPrefix(fileId: string | null | undefined): string {
  if (!fileId || typeof fileId !== 'string') return '';
  return fileId.replace(/^signed::/, '');
}

/** Resolve the best Drive file id for a document — the signed copy if present. */
export function resolveDriveFileId(doc: EnvelopeDocument): string {
  return stripSignedPrefix(doc.signed_file_id ?? doc.file_id);
}

/**
 * The signing API can return documents from OTHER envelopes in the same array,
 * so always keep only the documents whose envelope_id matches.
 */
export function envelopeOwnDocuments(envelope: SigningEnvelope): EnvelopeDocument[] {
  return envelope.documents.filter((doc) => doc.envelope_id === envelope.id);
}

export function mapSignatories(recipients: EnvelopeRecipient[]): Signatory[] {
  return recipients.map((recipient, index) => {
    const signed = recipient.status === API_DOC_SIGNED;
    return {
      // Use the server's real `recipient_id` — it's the id the mark-signed
      // endpoint expects in the URL (`…/recipients/{recipient_id}/mark-signed`).
      // Recipients often have no email, so the previous `${email||'recipient'}-N`
      // fallback produced "recipient-0" and the POST hit a non-existent id.
      // Fall back to the synthetic id only when no recipient_id is present.
      id: recipient.recipient_id || `${recipient.email || 'recipient'}-${index}`,
      name: recipient.name,
      email: recipient.email,
      role: recipient.role ?? 'Signer',
      roleVariant: roleVariantForRole(recipient.role),
      esignStatusLabel: signed
        ? `Signed (${recipient.signed_at ?? ''})`
        : 'Yet to Sign',
      esignSigned: signed,
      canMarkSigned: true,
    };
  });
}

/** API document status → row UI status + available actions. */
export function rowStatusForApiStatus(apiStatus: string): {
  status?: SignStatus;
  actions: DocumentRowAction[];
} {
  const signed = apiStatus === API_DOC_SIGNED;
  return {
    status: signed ? 'signed' : undefined,
    actions: signed ? ['view', 'revoke'] : ['upload'],
  };
}

/** docId → API status map for the envelope's own documents. */
export function envelopeStatusMap(envelope: SigningEnvelope): Record<string, string> {
  const updates: Record<string, string> = {};
  for (const doc of envelopeOwnDocuments(envelope)) {
    updates[doc.id] = doc.status;
  }
  return updates;
}

export function mapDocumentGroups(envelope: SigningEnvelope): SignDocumentGroup[] {
  const own = envelopeOwnDocuments(envelope);
  return [
    {
      id: envelope.bundle_key,
      title: bundleDisplayName(envelope),
      count: own.length,
      defaultOpen: true,
      documents: own.map((doc) => ({
        id: doc.id,
        name: doc.item_name,
        fileId: resolveDriveFileId(doc),
        ...rowStatusForApiStatus(doc.status),
      })),
    },
  ];
}

/**
 * Account-level status from the live document statuses: "Signed" when every
 * document is signed, a running count while partial, else "Yet to Sign".
 */
export function mapAccounts(envelope: SigningEnvelope): SignAccount[] {
  const own = envelopeOwnDocuments(envelope);
  const total = own.length;
  const signedCount = own.filter((d) => d.status === API_DOC_SIGNED).length;
  const allSigned = total > 0 && signedCount === total;
  return [
    {
      id: envelope.source_record_id ?? envelope.id,
      name: `${bundleDisplayName(envelope)} (${envelope.id.slice(0, 8)})`,
      statusLabel: allSigned
        ? 'Signed'
        : signedCount > 0
          ? `${signedCount}/${total} Signed`
          : 'Yet to Sign',
      statusKind: allSigned ? 'signed' : signedCount > 0 ? 'partial' : 'pending',
      selected: true,
    },
  ];
}

/** The bundle is "signed" once the envelope is SIGNED or every row is signed. */
export function isBundleSigned(
  documentGroups: SignDocumentGroup[],
  envelopeStatus?: string,
): boolean {
  if (envelopeStatus === ENVELOPE_SIGNED) return true;
  const docs = documentGroups.flatMap((group) => group.documents);
  return docs.length > 0 && docs.every((doc) => doc.status === 'signed');
}

const STATUS_SPECS: Record<SignStatus, StatusChipSpec> = {
  signed: { variant: 'success', label: 'Signed', iconName: 'circle-check' },
  pending: { variant: 'default', label: 'Pending' },
  view: { variant: 'default', label: 'View' },
  'not-started': { variant: 'default', label: 'Not Started' },
};

/** Chip presentation for a document-row status. */
export function statusChipSpec(status: SignStatus): StatusChipSpec {
  return STATUS_SPECS[status];
}

/** "Signed On (MM/DD/YYYY hh:mm AM/PM)" label, matching the e-sign style. */
export function formatSignedOn(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const hours12 = date.getHours() % 12 || 12;
  const meridiem = date.getHours() >= 12 ? 'PM' : 'AM';
  const datePart = `${pad(date.getMonth() + 1)}/${pad(date.getDate())}/${date.getFullYear()}`;
  const timePart = `${pad(hours12)}:${pad(date.getMinutes())} ${meridiem}`;
  return `Signed On (${datePart} ${timePart})`;
}

/** Apply client-only "mark as signed" overrides onto mapped signatories. */
export function applySignedOverrides(
  signatories: Signatory[],
  overrides: Record<string, string>,
): Signatory[] {
  if (!signatories.some((s) => overrides[s.id])) return signatories;
  return signatories.map((s) =>
    overrides[s.id]
      ? { ...s, esignSigned: true, esignStatusLabel: overrides[s.id], canMarkSigned: false }
      : s,
  );
}

// ── DOM helper (not exported — view/download convenience) ──────────────────────

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener noreferrer';
  document.body.appendChild(anchor);
  anchor.click();
  // Defer cleanup: `anchor.click()` only QUEUES the download — the browser may
  // not have started reading the blob URL yet. Revoking it (or removing the
  // anchor) synchronously can abort the download on some browsers, which is why
  // it "works for some users and not others" (a timing race, not a network/VPN
  // problem). Give the browser a tick to begin before we clean up.
  setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(url);
  }, 1000);
}

/**
 * Parse the download filename out of a `Content-Disposition` header, handling
 * both `filename="..."` and RFC 5987 `filename*=UTF-8''...` (percent-encoded).
 * Returns null when no filename is present. Exported for unit tests.
 */
export function filenameFromContentDisposition(
  header: unknown,
): string | null {
  if (typeof header !== 'string' || header.trim() === '') return null;
  // RFC 5987 extended form wins when present (it carries the real charset).
  const ext = /filename\*\s*=\s*(?:UTF-8'')?["']?([^"';]+)["']?/i.exec(header);
  if (ext?.[1]) {
    try {
      return decodeURIComponent(ext[1]).trim() || null;
    } catch {
      return ext[1].trim() || null;
    }
  }
  const plain = /filename\s*=\s*["']?([^"';]+)["']?/i.exec(header);
  return plain?.[1]?.trim() || null;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface UseSignaturesResult {
  /** Raw envelope (null until loaded / when no id). */
  envelope: SigningEnvelope | null;
  loading: boolean;
  error: unknown;
  /** Re-fetch the envelope. */
  refresh: () => Promise<void>;

  // Derived, ready-to-render props:
  method: SignMethod;
  availableMethods: SignMethod[];
  accounts: SignAccount[];
  signatories: Signatory[];
  documentGroups: SignDocumentGroup[];
  bundleSigned: boolean;

  // Actions (wet-sign):
  /** Upload a signed copy to Drive and link it to the document. */
  uploadSigned: (documentId: string, file: File) => Promise<void>;
  /** Revoke a document's signature. */
  revoke: (documentId: string, reason?: string) => Promise<void>;
  /** Resolve a document to a viewable object URL (caller must revoke it). */
  getDocumentUrl: (documentId: string) => Promise<string>;
  /** Save one document to disk. */
  downloadDocument: (documentId: string, filename?: string) => Promise<void>;
  /** Save every document in the bundle (sequential — no zip library). */
  downloadBundle: () => Promise<void>;
  /** Mark a recipient as signed: optimistic local label + a persist call to
   *  `POST /signing/envelopes/{id}/recipients/{recipient_id}/mark-signed`,
   *  then reflects the returned envelope. */
  markSigned: (recipientId: string, label?: string) => Promise<void>;
  /** True while a bundle download is running. */
  busy: boolean;
}

export function useSignatures(envelopeId?: string): UseSignaturesResult {
  const drive = useDriveFiles();
  const [envelope, setEnvelope] = useState<SigningEnvelope | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(envelopeId));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [signedOverrides, setSignedOverrides] = useState<Record<string, string>>({});

  const fetchEnvelope = useCallback(
    async (id: string): Promise<SigningEnvelope> => {
      const response = await apiManager.get(
        DOCPROC_SERVICE,
        `${SIGNING_BASE}/${encodeURIComponent(id)}`,
      );
      return response.data as SigningEnvelope;
    },
    [],
  );

  const load = useCallback(async () => {
    if (!envelopeId) {
      setEnvelope(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchEnvelope(envelopeId);
      setEnvelope(data);
    } catch (err) {
      setError(err);
      logger.error('signatures:envelope:error', {
        envelopeId,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  }, [envelopeId, fetchEnvelope]);

  useEffect(() => {
    let cancelled = false;
    setSignedOverrides({});
    if (!envelopeId) {
      setEnvelope(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    fetchEnvelope(envelopeId)
      .then((data) => {
        if (!cancelled) setEnvelope(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err);
        logger.error('signatures:envelope:error', {
          envelopeId,
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [envelopeId, fetchEnvelope]);

  // ── Derived ──
  const method = useMemo<SignMethod>(
    () => (envelope ? providerToMethod(envelope.provider) : 'wet-sign'),
    [envelope],
  );
  const availableMethods = useMemo<SignMethod[]>(() => [method], [method]);
  const accounts = useMemo<SignAccount[]>(
    () => (envelope ? mapAccounts(envelope) : []),
    [envelope],
  );
  const documentGroups = useMemo<SignDocumentGroup[]>(
    () => (envelope ? mapDocumentGroups(envelope) : []),
    [envelope],
  );
  const signatories = useMemo<Signatory[]>(
    () =>
      envelope
        ? applySignedOverrides(mapSignatories(envelope.recipients), signedOverrides)
        : [],
    [envelope, signedOverrides],
  );
  const bundleSigned = useMemo(
    () => isBundleSigned(documentGroups, envelope?.status),
    [documentGroups, envelope],
  );

  // ── Document lookup ──
  const findDriveFileId = useCallback(
    (documentId: string): { driveId: string; name: string } | null => {
      if (!envelope) return null;
      const doc = envelopeOwnDocuments(envelope).find((d) => d.id === documentId);
      if (!doc) return null;
      const driveId = resolveDriveFileId(doc);
      if (!driveId) return null;
      return { driveId, name: doc.item_name };
    },
    [envelope],
  );

  // ── Actions ──
  const uploadSigned = useCallback(
    async (documentId: string, file: File): Promise<void> => {
      if (!envelope) throw new Error('No envelope loaded');
      const uploaded = await drive.upload(file, {
        scope: 'APPS',
        retentionPolicy: 'TEMP_30_DAYS',
        appName: envelope.app_name,
      });
      const response = await apiManager.post(
        DOCPROC_SERVICE,
        `${SIGNING_BASE}/${encodeURIComponent(envelope.id)}/documents/${encodeURIComponent(documentId)}/upload-signed`,
        { signed_file_id: uploaded.file_id },
      );
      setEnvelope(response.data as SigningEnvelope);
    },
    [drive, envelope],
  );

  const revoke = useCallback(
    async (documentId: string, reason = 'User revoke'): Promise<void> => {
      if (!envelope) throw new Error('No envelope loaded');
      const response = await apiManager.post(
        DOCPROC_SERVICE,
        `${SIGNING_BASE}/${encodeURIComponent(envelope.id)}/documents/${encodeURIComponent(documentId)}/revoke`,
        { reason },
      );
      setEnvelope(response.data as SigningEnvelope);
    },
    [envelope],
  );

  const getDocumentUrl = useCallback(
    async (documentId: string): Promise<string> => {
      const found = findDriveFileId(documentId);
      if (!found) throw new Error(`No file for document ${documentId}`);
      const blob = await drive.download(found.driveId);
      return URL.createObjectURL(blob);
    },
    [drive, findDriveFileId],
  );

  const downloadDocument = useCallback(
    async (documentId: string, filename?: string): Promise<void> => {
      const found = findDriveFileId(documentId);
      if (!found) throw new Error(`No file for document ${documentId}`);
      const blob = await drive.download(found.driveId);
      saveBlob(blob, filename ?? `${found.name}.pdf`);
    },
    [drive, findDriveFileId],
  );

  const downloadBundle = useCallback(async (): Promise<void> => {
    if (!envelope) return;
    setBusy(true);
    try {
      // Single zip of the whole bundle from the docproc signing API
      // (GET /api/v1/signing/envelopes/{id}/download → application/zip with a
      // Content-Disposition filename), instead of downloading each Drive file
      // one-by-one.
      const response = await apiManager.get(
        DOCPROC_SERVICE,
        `${SIGNING_BASE}/${encodeURIComponent(envelope.id)}/download`,
        {},
        { responseType: 'blob' },
      );
      const blob = response.data as Blob;
      const fallback = `${bundleDisplayName(envelope)}.zip`;
      const filename =
        filenameFromContentDisposition(
          (response.headers as Record<string, unknown> | undefined)?.[
            'content-disposition'
          ],
        ) ?? fallback;
      saveBlob(blob, filename);
    } catch (err) {
      logger.error('signatures:download:error', {
        envelopeId: envelope.id,
        error: err instanceof Error ? err.message : String(err),
      });
      // Rethrow so the calling screen can surface the failure to the user
      // (e.g. a toast). Swallowing it here makes the download look like it
      // always succeeds, which hides blocked/failed downloads.
      throw err;
    } finally {
      setBusy(false);
    }
  }, [envelope]);

  const markSigned = useCallback(
    async (recipientId: string, label?: string): Promise<void> => {
      // Optimistic local label so the signatory card flips immediately.
      setSignedOverrides((prev) => ({
        ...prev,
        [recipientId]: label ?? formatSignedOn(new Date()),
      }));
      if (!envelope) return;
      // Persist via the docproc signing API
      // (POST /api/v1/signing/envelopes/{id}/recipients/{recipient_id}/mark-signed).
      try {
        const response = await apiManager.post(
          DOCPROC_SERVICE,
          `${SIGNING_BASE}/${encodeURIComponent(envelope.id)}/recipients/${encodeURIComponent(recipientId)}/mark-signed`,
          {},
        );
        // The endpoint returns the updated envelope — reflect the persisted state.
        if (response.data && typeof response.data === 'object') {
          setEnvelope(response.data as SigningEnvelope);
        }
      } catch (err) {
        // Roll back the optimistic label so the card doesn't falsely show signed.
        setSignedOverrides((prev) => {
          const next = { ...prev };
          delete next[recipientId];
          return next;
        });
        logger.error('signatures:mark-signed:error', {
          envelopeId: envelope.id,
          recipientId,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    },
    [envelope],
  );

  return {
    envelope,
    loading,
    error,
    refresh: load,
    method,
    availableMethods,
    accounts,
    signatories,
    documentGroups,
    bundleSigned,
    uploadSigned,
    revoke,
    getDocumentUrl,
    downloadDocument,
    downloadBundle,
    markSigned,
    busy,
  };
}
