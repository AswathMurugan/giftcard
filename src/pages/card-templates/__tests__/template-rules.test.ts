/**
 * What a card template is allowed to carry, and what it must not.
 *
 * Two rules earn their tests here. A template is shared across clients, so
 * issuer identifiers must never ride along — BIN and ICA belong to one issuer
 * and would follow the design onto another client's card. And an unset
 * parameter must stay OUT of the spec rather than going in as `''` or `0`: a
 * template carrying `thickness_mil: 0` applies a real, wrong thickness to
 * every order that picks it up, where an absent key leaves the order alone.
 */
import { describe, it, expect } from 'vitest';
import {
  byNewest,
  categoriesOf,
  draftFromSpec,
  matchesTemplate,
  specCount,
  specFromDraft,
  templateGroups,
  templateParams,
  validateTemplate,
  type TemplateRow,
} from '@/pages/card-templates/template-helpers';

describe('template parameters', { tags: ['card-templates', 'logic'] }, () => {
  it('never offers issuer identifiers', { tags: ['important'] }, () => {
    const keys = templateParams().map((p) => p.key);
    expect(keys).not.toContain('bin');
    expect(keys).not.toContain('ica');
    expect(keys).not.toContain('preprint_bin');
    // The whole Identifiers group collapses to just the brand, which is a
    // build parameter rather than an issuer number.
    expect(keys).toContain('card_brand');
  });

  it('offers the build parameters a supplier prices from', () => {
    const keys = templateParams().map((p) => p.key);
    for (const k of ['shape', 'substrate', 'thickness_mil', 'finish', 'mag_stripe', 'sig_panel']) {
      expect(keys).toContain(k);
    }
  });

  it('drops a group left empty by the filter rather than showing a heading', () => {
    // Identifiers keeps card_brand, so every surviving group has params — an
    // empty heading would read as "nothing to set here" instead of "gone".
    for (const g of templateGroups()) expect(g.params.length).toBeGreaterThan(0);
  });
});

describe('specFromDraft', { tags: ['card-templates', 'important'] }, () => {
  it('omits unset parameters instead of writing a falsy value', () => {
    const spec = specFromDraft({ shape: 'CR80', thickness_mil: '', finish: '   ' });
    expect(spec).toEqual({ shape: 'CR80' });
    expect('thickness_mil' in spec).toBe(false);
    expect('finish' in spec).toBe(false);
  });

  it('types numbers and booleans the way the seeded templates store them', () => {
    const spec = specFromDraft({
      thickness_mil: '30',
      mag_stripe: 'true',
      scratch_off: 'false',
      substrate: 'PVC',
    });
    expect(spec.thickness_mil).toBe(30);
    expect(spec.mag_stripe).toBe(true);
    expect(spec.scratch_off).toBe(false);
    expect(spec.substrate).toBe('PVC');
  });

  it('drops a number that is not one', { tags: ['edge-case'] }, () => {
    expect(specFromDraft({ thickness_mil: 'thick' })).toEqual({});
  });

  it('ignores keys a template may not carry, however they arrive', {
    tags: ['edge-case'],
  }, () => {
    const spec = specFromDraft({ shape: 'CR80', bin: '414720', ica: '9912' });
    expect(spec).toEqual({ shape: 'CR80' });
  });
});

describe('draftFromSpec', { tags: ['card-templates', 'logic'] }, () => {
  it('round-trips a stored spec back through the form', () => {
    const stored = { shape: 'CR100', thickness_mil: 33, mag_stripe: true, finish: 'Frosted' };
    const back = specFromDraft(draftFromSpec(stored));
    expect(back).toMatchObject(stored);
  });

  it('falls back to a parameter default when the spec has nothing', () => {
    // Shape defaults because the board lays out as CR80 regardless — the
    // control should show the truth rather than "Not set".
    expect(draftFromSpec(null).shape).toBe('CR80');
    expect(draftFromSpec(null).substrate).toBe('');
  });

  it('reads a boolean that arrived as a string', { tags: ['edge-case'] }, () => {
    // The backend does not honour declared types; mag_stripe has come back as
    // both a boolean and a string.
    expect(draftFromSpec({ mag_stripe: 'true' }).mag_stripe).toBe('true');
    expect(draftFromSpec({ mag_stripe: false }).mag_stripe).toBe('false');
  });
});

describe('specCount', { tags: ['card-templates', 'smoke'] }, () => {
  it('counts what would actually be saved, not what the form holds', () => {
    const { set, total } = specCount({ shape: 'CR80', finish: '', mag_stripe: 'true' });
    expect(set).toBe(2);
    expect(total).toBe(templateParams().length);
  });
});

describe('validateTemplate', { tags: ['card-templates', 'important'] }, () => {
  const existing: TemplateRow[] = [{ id: '1', name: 'Christmas Evergreen' }];

  it('requires a name', () => {
    expect(validateTemplate('   ', existing)[0].message).toMatch(/Give the template a name/);
  });

  it('refuses a duplicate name whatever its case or padding', { tags: ['edge-case'] }, () => {
    // The tile shows the name and nothing else, so a second one is unpickable.
    expect(validateTemplate('  christmas evergreen ', existing)).toHaveLength(1);
  });

  it('accepts a fresh name', () => {
    expect(validateTemplate('Winter Table', existing)).toEqual([]);
  });
});

describe('gallery', { tags: ['card-templates', 'logic'] }, () => {
  const rows: TemplateRow[] = [
    { id: '1', name: 'Christmas Evergreen', category: 'seasonal', created_at: '2026-01-02' },
    { id: '2', name: 'Walmart', category: 'Shop', description: 'Retail blue', created_at: '2026-03-04' },
    { id: '3', name: 'Untitled', category: '  ', created_at: '2026-02-01' },
  ];

  it('matches on name, category or description', () => {
    expect(matchesTemplate(rows[0], 'ever')).toBe(true);
    expect(matchesTemplate(rows[1], 'shop')).toBe(true);
    expect(matchesTemplate(rows[1], 'retail')).toBe(true);
    expect(matchesTemplate(rows[0], 'walmart')).toBe(false);
    expect(matchesTemplate(rows[0], '  ')).toBe(true);
  });

  it('lists only real categories', { tags: ['edge-case'] }, () => {
    expect(categoriesOf(rows)).toEqual(['Shop', 'seasonal']);
  });

  it('puts the newest first, so a template just saved is the first tile', () => {
    expect(byNewest(rows).map((r) => r.id)).toEqual(['2', '3', '1']);
  });
});
