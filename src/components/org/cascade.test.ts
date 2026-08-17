import { describe, it, expect } from 'vitest';
import {
  selectableLevels,
  isLevelEnabled,
  parentIdsFor,
  toggleOrg,
  removeOrg,
  selectedOrgIdsDeepest,
} from './cascade';
import { EMPTY_ORG_SELECTION, type OrgLevel, type Organization } from '@/config/org';

const LEVELS: OrgLevel[] = [
  { id: 'root', name: 'Root', description: '', level_order: 0 },
  { id: 'firm', name: 'Firm', description: '', level_order: 1 },
  { id: 'branch', name: 'Branch', description: '', level_order: 2 },
];

const firm = (id: string, parent = 'r'): Organization => ({
  id,
  name: `Firm ${id}`,
  code: id,
  level: 1,
  parentOrgId: parent,
});
const branch = (id: string, parent: string): Organization => ({
  id,
  name: `Branch ${id}`,
  code: id,
  level: 2,
  parentOrgId: parent,
});

describe('org cascade', { tags: ['org', 'logic'] }, () => {
  it('selectableLevels drops root and sorts', { tags: ['important'] }, () => {
    expect(selectableLevels(LEVELS).map((l) => l.id)).toEqual(['firm', 'branch']);
  });

  it('first level always enabled; child gated until parent selected', { tags: ['important'] }, () => {
    const levels = selectableLevels(LEVELS);
    expect(isLevelEnabled(EMPTY_ORG_SELECTION, LEVELS, levels[0])).toBe(true);
    expect(isLevelEnabled(EMPTY_ORG_SELECTION, LEVELS, levels[1])).toBe(false);

    const withFirm = toggleOrg(EMPTY_ORG_SELECTION, LEVELS, levels[0], firm('f1'), true);
    expect(isLevelEnabled(withFirm, LEVELS, levels[1])).toBe(true);
  });

  it('parentIdsFor returns the prior level selection', () => {
    const levels = selectableLevels(LEVELS);
    const withFirm = toggleOrg(EMPTY_ORG_SELECTION, LEVELS, levels[0], firm('f1'), true);
    expect(parentIdsFor(withFirm, LEVELS, levels[1])).toEqual(['f1']);
    expect(parentIdsFor(withFirm, LEVELS, levels[0])).toBeNull();
  });

  it('multi-select accumulates at a level', () => {
    const levels = selectableLevels(LEVELS);
    let s = toggleOrg(EMPTY_ORG_SELECTION, LEVELS, levels[0], firm('f1'), true);
    s = toggleOrg(s, LEVELS, levels[0], firm('f2'), true);
    expect(s.levels.firm.items.map((o) => o.id)).toEqual(['f1', 'f2']);
  });

  it('single-select replaces', () => {
    const levels = selectableLevels(LEVELS);
    let s = toggleOrg(EMPTY_ORG_SELECTION, LEVELS, levels[0], firm('f1'), false);
    s = toggleOrg(s, LEVELS, levels[0], firm('f2'), false);
    expect(s.levels.firm.items.map((o) => o.id)).toEqual(['f2']);
  });

  it('changing a parent level clears deeper levels + advisors', { tags: ['important'] }, () => {
    const levels = selectableLevels(LEVELS);
    let s = toggleOrg(EMPTY_ORG_SELECTION, LEVELS, levels[0], firm('f1'), true);
    s = toggleOrg(s, LEVELS, levels[1], branch('b1', 'f1'), true);
    s = { ...s, advisors: [{ userId: 'a1', firstName: 'A', lastName: 'B', roles: [] }] };
    // Now add another firm → branch + advisors must reset.
    s = toggleOrg(s, LEVELS, levels[0], firm('f2'), true);
    expect(s.levels.branch).toBeUndefined();
    expect(s.advisors).toEqual([]);
  });

  it('clearing the last org at a level removes it', { tags: ['edge-case'] }, () => {
    const levels = selectableLevels(LEVELS);
    let s = toggleOrg(EMPTY_ORG_SELECTION, LEVELS, levels[0], firm('f1'), true);
    s = removeOrg(s, LEVELS, levels[0], firm('f1'));
    expect(s.levels.firm).toBeUndefined();
  });

  it('selectedOrgIdsDeepest returns the deepest selected level ids', () => {
    const levels = selectableLevels(LEVELS);
    let s = toggleOrg(EMPTY_ORG_SELECTION, LEVELS, levels[0], firm('f1'), true);
    expect(selectedOrgIdsDeepest(s, LEVELS)).toEqual(['f1']);
    s = toggleOrg(s, LEVELS, levels[1], branch('b1', 'f1'), true);
    expect(selectedOrgIdsDeepest(s, LEVELS)).toEqual(['b1']);
  });
});
