import { describe, it, expect } from 'vitest';
import {
  mapOrgContext,
  mapAdvisors,
  mapOrganization,
  mapOrgLevel,
  filterOrgs,
} from './org-data-mappers';
import type { Organization } from '@/config/org';

describe('org-data-mappers', { tags: ['org', 'logic'] }, () => {
  describe('mapOrgContext', { tags: ['important'] }, () => {
    const raw = [
      {
        result: {
          primaryOrg: { id: 'root', name: 'Triad', code: '00000', level: 0, parentOrgId: null },
          orgLevels: [
            { id: 'l1', name: 'Firm', description: 'Firm', levelOrder: 1 },
            { id: 'l2', name: 'Branch', description: 'Branch', levelOrder: 2 },
          ],
          accessibleOrgs: [
            { id: 'f1', name: 'Demo Firm1', code: '00003', level: 1, parentOrgId: 'root', uniquePath: '00000.0003' },
          ],
          rootAccessLevel: 1,
        },
      },
    ];

    it('unwraps [{result}] and maps fields', () => {
      const h = mapOrgContext(raw);
      expect(h.primaryOrg?.name).toBe('Triad');
      expect(h.orgLevels.map((l) => l.level_order)).toEqual([1, 2]); // levelOrder→snake
      expect(h.accessibleOrgs[0].id).toBe('f1');
      expect(h.rootAccessLevel).toBe(1);
    });

    it('tolerates bare object and {result} forms', { tags: ['edge-case'] }, () => {
      expect(mapOrgContext(raw[0]).primaryOrg?.name).toBe('Triad'); // {result}
      expect(mapOrgContext({ orgLevels: [] }).orgLevels).toEqual([]); // bare
      expect(mapOrgContext(null).primaryOrg).toBeNull();
    });
  });

  describe('mapAdvisors', { tags: ['important'] }, () => {
    it('maps advisor_user_list rows + nested roles', () => {
      const advisors = mapAdvisors([
        {
          id: 'a1',
          first_name: 'Ben',
          last_name: 'Powell',
          full_name: 'Ben Powell',
          roles: [{ role: { id: 'r1', name: 'Advisor' } }],
        },
      ]);
      expect(advisors[0]).toMatchObject({
        userId: 'a1',
        firstName: 'Ben',
        lastName: 'Powell',
        fullName: 'Ben Powell',
        roles: [{ id: 'r1', name: 'Advisor' }],
      });
    });

    it('returns [] for non-array', { tags: ['edge-case'] }, () => {
      expect(mapAdvisors(null)).toEqual([]);
      expect(mapAdvisors({})).toEqual([]);
    });
  });

  describe('mapOrganization / mapOrgLevel', { tags: ['logic'] }, () => {
    it('coerces null parentOrgId and missing fields', () => {
      const o = mapOrganization({ id: 'x', name: 'N', code: 'C', level: 1, parentOrgId: null });
      expect(o.parentOrgId).toBeNull();
      expect(mapOrgLevel({ id: 'l', name: 'L', description: 'D', levelOrder: 2 }).level_order).toBe(2);
    });
  });

  describe('filterOrgs', { tags: ['logic'] }, () => {
    const orgs: Organization[] = [
      { id: 'f1', name: 'Demo Firm1', code: '00003', level: 1, parentOrgId: 'root' },
      { id: 'f2', name: 'Mobile Bay', code: 'MBF', level: 1, parentOrgId: 'root' },
      { id: 'b1', name: 'Branch A', code: 'BA', level: 2, parentOrgId: 'f1' },
    ];

    it('filters by level', () => {
      expect(filterOrgs(orgs, 1, null, '').map((o) => o.id)).toEqual(['f1', 'f2']);
      expect(filterOrgs(orgs, 2, null, '').map((o) => o.id)).toEqual(['b1']);
    });

    it('filters by parent ids', () => {
      expect(filterOrgs(orgs, 2, ['f1'], '').map((o) => o.id)).toEqual(['b1']);
      expect(filterOrgs(orgs, 2, ['f2'], '')).toEqual([]);
    });

    it('filters by query on name/code (case-insensitive)', () => {
      expect(filterOrgs(orgs, 1, null, 'mbf').map((o) => o.id)).toEqual(['f2']);
      expect(filterOrgs(orgs, 1, null, 'demo').map((o) => o.id)).toEqual(['f1']);
    });
  });
});
