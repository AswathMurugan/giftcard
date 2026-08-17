import { describe, it, expect } from 'vitest';
import {
  providerToMethod,
  roleVariantForRole,
  stripSignedPrefix,
  resolveDriveFileId,
  envelopeOwnDocuments,
  mapSignatories,
  rowStatusForApiStatus,
  envelopeStatusMap,
  mapDocumentGroups,
  mapAccounts,
  isBundleSigned,
  statusChipSpec,
  formatSignedOn,
  applySignedOverrides,
  filenameFromContentDisposition,
  type SigningEnvelope,
  type EnvelopeDocument,
  type Signatory,
} from './useSignatures';

const ENV_ID = 'env-1-abcdef99';

const doc = (over: Partial<EnvelopeDocument>): EnvelopeDocument => ({
  id: 'd1',
  envelope_id: ENV_ID,
  file_id: 'file-1',
  signed_file_id: null,
  item_name: 'Doc 1',
  status: 'SENT',
  ...over,
});

const envelope = (over: Partial<SigningEnvelope> = {}): SigningEnvelope => ({
  id: ENV_ID,
  app_name: 'wealthapp',
  bundle_key: 'wire-out',
  bundle_label: 'Wire Out Packet',
  provider: 'wetsign',
  source_record_id: 'rec-7',
  status: 'SENT',
  recipients: [],
  documents: [],
  ...over,
});

describe('useSignatures mappers', { tags: ['signatures', 'logic'] }, () => {
  describe('providerToMethod', { tags: ['important'] }, () => {
    it('maps wetsign variants to wet-sign', () => {
      expect(providerToMethod('wetsign')).toBe('wet-sign');
      expect(providerToMethod('wet-sign')).toBe('wet-sign');
      expect(providerToMethod('WET_SIGN')).toBe('wet-sign');
    });
    it('maps everything else to e-sign', { tags: ['edge-case'] }, () => {
      expect(providerToMethod('esign')).toBe('e-sign');
      expect(providerToMethod('e-sign')).toBe('e-sign');
      expect(providerToMethod('')).toBe('e-sign');
      expect(providerToMethod(null)).toBe('e-sign');
      expect(providerToMethod(undefined)).toBe('e-sign');
    });
  });

  describe('roleVariantForRole', { tags: ['logic'] }, () => {
    it('maps known roles, defaults to muted', { tags: ['edge-case'] }, () => {
      expect(roleVariantForRole('Primary')).toBe('primary');
      expect(roleVariantForRole('client')).toBe('primary');
      expect(roleVariantForRole('Joint')).toBe('secondary');
      expect(roleVariantForRole('secondary')).toBe('secondary');
      expect(roleVariantForRole('Advisor')).toBe('muted');
      expect(roleVariantForRole(null)).toBe('muted');
      expect(roleVariantForRole(undefined)).toBe('muted');
    });
  });

  describe('stripSignedPrefix', { tags: ['important', 'edge-case'] }, () => {
    it('strips the signed:: prefix and guards non-strings', () => {
      expect(stripSignedPrefix('signed::abc')).toBe('abc');
      expect(stripSignedPrefix('abc')).toBe('abc');
      expect(stripSignedPrefix('')).toBe('');
      expect(stripSignedPrefix(null)).toBe('');
      expect(stripSignedPrefix(undefined)).toBe('');
    });
  });

  describe('resolveDriveFileId', { tags: ['important'] }, () => {
    it('prefers the signed copy and strips its prefix', () => {
      expect(resolveDriveFileId(doc({ signed_file_id: 'signed::s1' }))).toBe('s1');
      expect(resolveDriveFileId(doc({ signed_file_id: 's2' }))).toBe('s2');
    });
    it('falls back to file_id when no signed copy', { tags: ['edge-case'] }, () => {
      expect(resolveDriveFileId(doc({ signed_file_id: null, file_id: 'f1' }))).toBe('f1');
    });
  });

  describe('envelopeOwnDocuments', { tags: ['important'] }, () => {
    it('keeps only documents whose envelope_id matches', () => {
      const env = envelope({
        documents: [
          doc({ id: 'a', envelope_id: 'env-1-abcdef99' }),
          doc({ id: 'b', envelope_id: 'other' }),
          doc({ id: 'c', envelope_id: 'env-1-abcdef99' }),
        ],
      });
      expect(envelopeOwnDocuments(env).map((d) => d.id)).toEqual(['a', 'c']);
    });
  });

  describe('mapSignatories', { tags: ['logic'] }, () => {
    it('marks SIGNED recipients and labels the rest', { tags: ['edge-case'] }, () => {
      const out = mapSignatories([
        { name: 'A', email: 'a@x.com', role: 'Primary', status: 'SIGNED', signed_at: '05/14' },
        { name: 'B', email: 'b@x.com', role: null, status: 'SENT', signed_at: null },
      ]);
      expect(out[0]).toMatchObject({
        esignSigned: true,
        esignStatusLabel: 'Signed (05/14)',
        roleVariant: 'primary',
        canMarkSigned: true,
      });
      expect(out[1]).toMatchObject({
        esignSigned: false,
        esignStatusLabel: 'Yet to Sign',
        role: 'Signer',
        roleVariant: 'muted',
      });
      expect(out[0].id).toBe('a@x.com-0');
    });

    it('uses the real recipient_id as the id when present', { tags: ['important'] }, () => {
      // Recipients usually have no email; the id MUST be the server recipient_id
      // so mark-signed posts to `…/recipients/{recipient_id}/…`, not "recipient-0".
      const out = mapSignatories([
        { recipient_id: 'beaad7b801fd4a4784ef1611356db9d7', name: 'John', email: '', role: 'Account Holder', status: 'PENDING', signed_at: null },
        { recipient_id: 'c323d0c8603947e2be1bff5f1ae47b16', name: 'Tom', email: '', role: 'Additional Account Holder', status: 'PENDING', signed_at: null },
      ]);
      expect(out[0].id).toBe('beaad7b801fd4a4784ef1611356db9d7');
      expect(out[1].id).toBe('c323d0c8603947e2be1bff5f1ae47b16');
    });

    it('falls back to the synthetic id when recipient_id is absent', { tags: ['edge-case'] }, () => {
      const out = mapSignatories([
        { name: 'NoId', email: '', role: null, status: 'PENDING', signed_at: null },
      ]);
      expect(out[0].id).toBe('recipient-0');
    });
  });

  describe('rowStatusForApiStatus', { tags: ['important'] }, () => {
    it('signed → view+revoke, otherwise upload', () => {
      expect(rowStatusForApiStatus('SIGNED')).toEqual({
        status: 'signed',
        actions: ['view', 'revoke'],
      });
      expect(rowStatusForApiStatus('SENT')).toEqual({
        status: undefined,
        actions: ['upload'],
      });
    });
  });

  describe('envelopeStatusMap', { tags: ['logic'] }, () => {
    it('builds docId → status for own docs only', () => {
      const env = envelope({
        documents: [
          doc({ id: 'a', envelope_id: 'env-1-abcdef99', status: 'SIGNED' }),
          doc({ id: 'x', envelope_id: 'other', status: 'SIGNED' }),
        ],
      });
      expect(envelopeStatusMap(env)).toEqual({ a: 'SIGNED' });
    });
  });

  describe('mapDocumentGroups', { tags: ['important'] }, () => {
    it('builds one group with own docs, fileId and statuses', () => {
      const env = envelope({
        documents: [
          doc({ id: 'a', status: 'SIGNED', signed_file_id: 'signed::sa', item_name: 'AAF' }),
          doc({ id: 'b', status: 'SENT', file_id: 'fb', item_name: 'LOA' }),
          doc({ id: 'z', envelope_id: 'other' }),
        ],
      });
      const [group] = mapDocumentGroups(env);
      expect(group.id).toBe('wire-out');
      expect(group.title).toBe('Wire Out Packet');
      expect(group.count).toBe(2);
      expect(group.documents[0]).toMatchObject({
        id: 'a',
        name: 'AAF',
        fileId: 'sa',
        status: 'signed',
        actions: ['view', 'revoke'],
      });
      expect(group.documents[1]).toMatchObject({
        id: 'b',
        fileId: 'fb',
        status: undefined,
        actions: ['upload'],
      });
    });
  });

  describe('mapAccounts', { tags: ['logic', 'edge-case'] }, () => {
    it('reports signed / partial / pending from doc statuses', () => {
      const allSigned = mapAccounts(
        envelope({
          documents: [doc({ id: 'a', status: 'SIGNED' }), doc({ id: 'b', status: 'SIGNED' })],
        }),
      );
      expect(allSigned[0]).toMatchObject({ statusLabel: 'Signed', statusKind: 'signed', id: 'rec-7' });

      const partial = mapAccounts(
        envelope({
          documents: [doc({ id: 'a', status: 'SIGNED' }), doc({ id: 'b', status: 'SENT' })],
        }),
      );
      expect(partial[0]).toMatchObject({ statusLabel: '1/2 Signed', statusKind: 'partial' });

      const pending = mapAccounts(envelope({ documents: [doc({ id: 'a', status: 'SENT' })] }));
      expect(pending[0]).toMatchObject({ statusLabel: 'Yet to Sign', statusKind: 'pending' });
    });
    it('uses source_record_id, falling back to envelope id', () => {
      const out = mapAccounts(envelope({ source_record_id: null }));
      expect(out[0].id).toBe('env-1-abcdef99');
      expect(out[0].name).toContain('env-1-ab'); // first 8 chars
    });
  });

  describe('isBundleSigned', { tags: ['important', 'edge-case'] }, () => {
    it('true when envelope SIGNED or all rows signed; false otherwise', () => {
      expect(isBundleSigned([], 'SIGNED')).toBe(true);
      expect(
        isBundleSigned([
          { id: 'g', title: 't', count: 2, documents: [
            { id: 'a', name: 'A', status: 'signed' },
            { id: 'b', name: 'B', status: 'signed' },
          ] },
        ]),
      ).toBe(true);
      expect(
        isBundleSigned([
          { id: 'g', title: 't', count: 2, documents: [
            { id: 'a', name: 'A', status: 'signed' },
            { id: 'b', name: 'B' },
          ] },
        ]),
      ).toBe(false);
      // empty bundle is NOT signed
      expect(isBundleSigned([{ id: 'g', title: 't', count: 0, documents: [] }])).toBe(false);
    });
  });

  describe('statusChipSpec', { tags: ['logic'] }, () => {
    it('maps each status to a chip spec', () => {
      expect(statusChipSpec('signed')).toEqual({
        variant: 'success',
        label: 'Signed',
        iconName: 'circle-check',
      });
      expect(statusChipSpec('pending').variant).toBe('default');
      expect(statusChipSpec('not-started').label).toBe('Not Started');
    });
  });

  describe('formatSignedOn', { tags: ['logic', 'edge-case'] }, () => {
    it('formats 12-hour time with AM/PM and zero-padding', () => {
      expect(formatSignedOn(new Date(2026, 4, 14, 15, 35))).toBe(
        'Signed On (05/14/2026 03:35 PM)',
      );
      expect(formatSignedOn(new Date(2026, 0, 1, 0, 5))).toBe(
        'Signed On (01/01/2026 12:05 AM)',
      );
    });
  });

  describe('applySignedOverrides', { tags: ['important'] }, () => {
    const base: Signatory[] = [
      { id: 'a@x.com-0', name: 'A', email: 'a@x.com', role: 'Primary', esignSigned: false, canMarkSigned: true },
      { id: 'b@x.com-1', name: 'B', email: 'b@x.com', role: 'Joint', esignSigned: false, canMarkSigned: true },
    ];
    it('returns the same array reference when no override applies', { tags: ['edge-case'] }, () => {
      expect(applySignedOverrides(base, {})).toBe(base);
      expect(applySignedOverrides(base, { 'unknown-id': 'x' })).toBe(base);
    });
    it('stamps the signed label and disables mark-signed', () => {
      const out = applySignedOverrides(base, { 'a@x.com-0': 'Signed On (01/01/2026 12:00 AM)' });
      expect(out[0]).toMatchObject({
        esignSigned: true,
        esignStatusLabel: 'Signed On (01/01/2026 12:00 AM)',
        canMarkSigned: false,
      });
      expect(out[1]).toMatchObject({ esignSigned: false, canMarkSigned: true });
    });
  });

  describe('filenameFromContentDisposition', { tags: ['logic'] }, () => {
    it('reads a quoted filename', () => {
      expect(
        filenameFromContentDisposition('attachment; filename="bundle.zip"'),
      ).toBe('bundle.zip');
    });
    it('reads an unquoted filename', () => {
      expect(filenameFromContentDisposition('attachment; filename=bundle.zip')).toBe(
        'bundle.zip',
      );
    });
    it('prefers and decodes RFC 5987 filename*', () => {
      expect(
        filenameFromContentDisposition(
          "attachment; filename=\"fallback.zip\"; filename*=UTF-8''My%20Bundle%20%231.zip",
        ),
      ).toBe('My Bundle #1.zip');
    });
    it('returns null when no filename / not a string', { tags: ['edge-case'] }, () => {
      expect(filenameFromContentDisposition('attachment')).toBeNull();
      expect(filenameFromContentDisposition('')).toBeNull();
      expect(filenameFromContentDisposition(undefined)).toBeNull();
      expect(filenameFromContentDisposition(null)).toBeNull();
    });
  });
});
