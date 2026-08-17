import { describe, it, expect } from 'vitest';
import {
  renderSnapshotTs,
  renderSnapshotCatalog,
  type SnapshotSpec,
} from './snapshot-codegen';

const SPEC: SnapshotSpec = {
  pascal: 'Roles',
  constName: 'ROLES',
  title: 'Roles',
  source: 'Phoenix /api/internal/roles',
  script: 'scripts/fetch-tenant-refs.ts',
  catalogColumns: ['id', 'name', 'description'],
};

describe('snapshot-codegen', { tags: ['tenant-refs', 'logic'] }, () => {
  describe('renderSnapshotTs', { tags: ['important'] }, () => {
    it('emits an empty const + count for no records', { tags: ['edge-case'] }, () => {
      const ts = renderSnapshotTs(SPEC, []);
      expect(ts).toContain('export const ROLES: ReadonlyArray<RolesRecord> = [];');
      expect(ts).toContain('export const ROLES_COUNT = 0;');
      expect(ts).toContain('export interface RolesRecord');
    });

    it('emits records as a const with count', () => {
      const ts = renderSnapshotTs(SPEC, [
        { id: 'r1', name: 'Admin' },
        { id: 'r2', name: 'User' },
      ]);
      expect(ts).toContain('export const ROLES: ReadonlyArray<RolesRecord> =');
      expect(ts).toContain('"id": "r1"');
      expect(ts).toContain('as const;');
      expect(ts).toContain('export const ROLES_COUNT = 2;');
    });

    it('sorts object keys deterministically', () => {
      const a = renderSnapshotTs(SPEC, [{ name: 'X', id: '1', active: true }]);
      const b = renderSnapshotTs(SPEC, [{ active: true, id: '1', name: 'X' }]);
      expect(a).toBe(b); // key order in input must not change output
    });
  });

  describe('renderSnapshotCatalog', { tags: ['important'] }, () => {
    it('renders a table limited to catalogColumns', () => {
      const md = renderSnapshotCatalog(SPEC, [
        { id: 'r1', name: 'Admin', description: 'Full', secret: 'hidden' },
      ]);
      expect(md).toContain('| id | name | description |');
      expect(md).toContain('| r1 | Admin | Full |');
      expect(md).not.toContain('hidden'); // column not in catalogColumns
    });

    it('shows an empty-state note for no records', { tags: ['edge-case'] }, () => {
      const md = renderSnapshotCatalog(SPEC, []);
      expect(md).toContain('# Roles Catalog');
      expect(md).toContain('No Roles available');
    });

    it('escapes pipes and newlines in cells', { tags: ['edge-case'] }, () => {
      const md = renderSnapshotCatalog(SPEC, [
        { id: 'r1', name: 'A|B', description: 'line1\nline2' },
      ]);
      expect(md).toContain('A\\|B');
      expect(md).toContain('line1 line2');
    });

    it('renders nested objects as a placeholder cell', { tags: ['edge-case'] }, () => {
      const md = renderSnapshotCatalog(
        { ...SPEC, catalogColumns: ['id', 'parent'] },
        [{ id: 'r1', parent: { id: 'p1' } }],
      );
      expect(md).toContain('`{…}`');
    });
  });
});
