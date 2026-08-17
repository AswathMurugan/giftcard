import { describe, it, expect } from 'vitest';
import {
  normalizeSkill,
  buildSkillApps,
  flattenSkills,
  renderSkillsCatalog,
  renderSkillsGenerated,
  type RawSkill,
} from './skills-codegen';

function skill(over: Partial<RawSkill> = {}): RawSkill {
  return {
    app_definition_key: 'app_a',
    app_definition: 'AppA__V0_0_1',
    name: 'summarize_account',
    label: 'Summarize Account',
    description: 'Summarizes an account',
    component_type: 'skill-definition',
    sub_type: 'assistant',
    tags: ['finance'],
    ...over,
  };
}

describe('normalizeSkill', () => {
  it('normalizes a full row', () => {
    expect(normalizeSkill(skill())).toEqual({
      appKey: 'app_a',
      appDefinition: 'AppA__V0_0_1',
      name: 'summarize_account',
      label: 'Summarize Account',
      description: 'Summarizes an account',
      subType: 'assistant',
      tags: ['finance'],
    });
  });

  it('prefers target_app_definition_key over app_definition_key', () => {
    const s = normalizeSkill(
      skill({ target_app_definition_key: 'dto_app', app_definition_key: 'internal_app' }),
    );
    expect(s?.appKey).toBe('dto_app');
  });

  it('falls back label → name when label missing', () => {
    const s = normalizeSkill(skill({ label: undefined }));
    expect(s?.label).toBe('summarize_account');
  });

  it('returns null when name is missing or empty', () => {
    expect(normalizeSkill(skill({ name: undefined }))).toBeNull();
    expect(normalizeSkill(skill({ name: '   ' }))).toBeNull();
  });

  it('returns null when app key is missing', () => {
    expect(
      normalizeSkill(skill({ app_definition_key: undefined, target_app_definition_key: undefined })),
    ).toBeNull();
  });

  it('returns null for null/undefined input', () => {
    expect(normalizeSkill(null)).toBeNull();
    expect(normalizeSkill(undefined)).toBeNull();
  });

  it('coerces a non-array / dirty tags field to a clean string[]', () => {
    expect(normalizeSkill(skill({ tags: undefined }))?.tags).toEqual([]);
    expect(
      normalizeSkill(skill({ tags: ['a', 2 as unknown as string, null as unknown as string] }))
        ?.tags,
    ).toEqual(['a']);
  });
});

describe('buildSkillApps', () => {
  it('groups by app, sorts apps by key and skills by name, dedupes', () => {
    const apps = buildSkillApps([
      skill({ app_definition_key: 'app_b', name: 'z_skill' }),
      skill({ app_definition_key: 'app_a', name: 'b_skill' }),
      skill({ app_definition_key: 'app_a', name: 'a_skill' }),
      skill({ app_definition_key: 'app_a', name: 'a_skill' }), // dup within app
      skill({ name: undefined }), // dropped
    ]);
    expect(apps.map((a) => a.appKey)).toEqual(['app_a', 'app_b']);
    expect(apps[0].skills.map((s) => s.name)).toEqual(['a_skill', 'b_skill']);
    expect(apps[1].skills.map((s) => s.name)).toEqual(['z_skill']);
  });

  it('keeps the same skill name in two different apps (foldered by app)', () => {
    const apps = buildSkillApps([
      skill({ app_definition_key: 'app_a', name: 'shared' }),
      skill({ app_definition_key: 'app_b', name: 'shared' }),
    ]);
    expect(apps).toHaveLength(2);
    expect(apps[0].skills[0].name).toBe('shared');
    expect(apps[1].skills[0].name).toBe('shared');
  });

  it('filters to the requested app keys when provided', () => {
    const apps = buildSkillApps(
      [
        skill({ app_definition_key: 'app_a', name: 'a' }),
        skill({ app_definition_key: 'app_b', name: 'b' }),
      ],
      ['app_b'],
    );
    expect(apps.map((a) => a.appKey)).toEqual(['app_b']);
  });

  it('returns [] for no rows', () => {
    expect(buildSkillApps([])).toEqual([]);
  });
});

describe('flattenSkills', () => {
  it('flattens and sorts across apps by name then appKey', () => {
    const flat = flattenSkills(
      buildSkillApps([
        skill({ app_definition_key: 'app_b', name: 'm' }),
        skill({ app_definition_key: 'app_a', name: 'm' }),
        skill({ app_definition_key: 'app_a', name: 'a' }),
      ]),
    );
    expect(flat.map((s) => `${s.name}:${s.appKey}`)).toEqual([
      'a:app_a',
      'm:app_a',
      'm:app_b',
    ]);
  });
});

describe('renderSkillsCatalog', () => {
  it('renders the empty-state marker for no skills', () => {
    const md = renderSkillsCatalog([]);
    expect(md).toContain('# Platform skills (agents)');
    expect(md).toContain('_No platform skills found._');
  });

  it('renders a per-app table with skill rows', () => {
    const md = renderSkillsCatalog(buildSkillApps([skill()]));
    expect(md).toContain('## AppA__V0_0_1');
    expect(md).toContain('appKey: `app_a`');
    expect(md).toContain('`summarize_account`');
    expect(md).toContain('finance');
  });

  it('escapes pipes and shows an em-dash for empty cells', () => {
    const md = renderSkillsCatalog(
      buildSkillApps([skill({ description: 'a | b', tags: [], sub_type: '' })]),
    );
    expect(md).toContain('a \\| b');
    // subType + tags empty → em-dash cells present
    expect(md).toContain('—');
  });
});

describe('renderSkillsGenerated', () => {
  it('emits a never union + empty consts for no skills', () => {
    const ts = renderSkillsGenerated([]);
    expect(ts).toContain('export type SkillName = never;');
    expect(ts).toContain('export const SKILLS: SkillEntry[] = [];');
    expect(ts).toContain('export const SKILL_APP_KEYS: Record<string, string> = {};');
  });

  it('emits a name union, SKILLS array, and app-key map for real skills', () => {
    const ts = renderSkillsGenerated(
      buildSkillApps([
        skill({ name: 'alpha', app_definition_key: 'app_a' }),
        skill({ name: 'beta', app_definition_key: 'app_b' }),
      ]),
    );
    expect(ts).toContain('export type SkillName = "alpha" | "beta";');
    expect(ts).toContain('"alpha": "app_a"');
    expect(ts).toContain('"beta": "app_b"');
    expect(ts).toContain('export const SKILLS: SkillEntry[] =');
    expect(ts).toContain('SKILLS_BY_NAME[skill.name] = skill;');
  });

  it(
    'folds a cross-app duplicate name to ONE app-key entry (last wins)',
    () => {
      // Two apps define `companion-new`. A naive per-skill emit would produce a
      // duplicate object key (a TS error). It must appear exactly once, keyed
      // to the LAST occurrence — matching JS runtime last-wins.
      const ts = renderSkillsGenerated(
        buildSkillApps([
          skill({ name: 'companion-new', app_definition_key: 'testadv1' }),
          skill({ name: 'companion-new', app_definition_key: 'wealthdomain' }),
        ]),
      );
      // Exactly one `"companion-new":` key in the whole file.
      const keyCount = ts.split('"companion-new":').length - 1;
      expect(keyCount).toBe(1);
      // buildSkillApps sorts apps by key, so wealthdomain is last → its key wins.
      expect(ts).toContain('"companion-new": "wealthdomain"');
      expect(ts).not.toContain('"companion-new": "testadv1"');
    },
  );
});
