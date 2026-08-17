import { describe, it, expect } from 'vitest';
import {
  extractBranding,
  resolveTheme,
  resolveAssetUrl,
  tenantAssetOrigin,
  parseTenantThemeDefaultDraft,
  tenantDraftToThemeBundle,
  resolveInvertSidebarColors,
  EMPTY_BRANDING,
  type BrandingPreferenceRecord,
} from './branding';
import { DEFAULT_THEME } from './default-theme';
import { applyTheme } from './apply-theme';

/** Collect the CSS variables applyTheme would set onto an element. */
function collectVars(theme: Parameters<typeof applyTheme>[0]): Record<string, string> {
  const vars: Record<string, string> = {};
  applyTheme(theme, 'light', {
    style: {
      setProperty: (name: string, value: string) => {
        vars[name] = value;
      },
    },
    setAttribute: () => {},
  });
  return vars;
}

function rec(
  partial: Partial<BrandingPreferenceRecord> & { name: string },
): BrandingPreferenceRecord {
  return {
    value: '',
    category: 'branding',
    disabled: false,
    ...partial,
  };
}

/** A minimal Tenant.Theme collection value (mirrors the real preference). */
const TENANT_THEME_VALUE = JSON.stringify({
  themes: [
    {
      id: 'theme-a',
      name: 'Theme A',
      draft: { colors: { primary: { 50: '#ffffff', 500: '#aaaaaa', 950: '#000000' } } },
    },
    {
      id: 'theme-b',
      name: 'Theme B',
      draft: {
        colors: {
          primary: { 50: '#f0', 500: '#bb0000', 950: '#11' },
          secondary: { 500: '#777777' },
        },
        standardColors: { danger: { 500: '#ff0000' } },
        fontFamily: { primary: 'Source Sans 3' },
      },
    },
  ],
  defaultThemeId: 'theme-b',
});

describe('branding', { tags: ['branding', 'logic'] }, () => {
  describe('extractBranding', { tags: ['important'] }, () => {
    it('returns all-null branding for empty / nullish input', { tags: ['edge-case'] }, () => {
      expect(extractBranding([])).toEqual(EMPTY_BRANDING);
      expect(extractBranding(null)).toEqual(EMPTY_BRANDING);
      expect(extractBranding(undefined)).toEqual(EMPTY_BRANDING);
    });

    it('extracts logo, favicon, logoHeight, and theme', () => {
      const result = extractBranding([
        rec({ name: 'App.LogoUrl', value: 'https://x/logo.svg' }),
        rec({ name: 'App.FavIcon', value: 'https://x/fav.png' }),
        rec({ name: 'App.LogoHeight', value: '2.5rem' }),
        rec({ name: 'App.Theme', value: '{"colors":{"primary":{"default":"#111"}}}' }),
      ]);
      expect(result.logoUrl).toBe('https://x/logo.svg');
      expect(result.faviconUrl).toBe('https://x/fav.png');
      expect(result.logoHeight).toBe('2.5rem');
      expect(result.theme).toEqual({ colors: { primary: { default: '#111' } } });
    });

    it('prefers App.* over Tenant.* for logo and favicon', { tags: ['important'] }, () => {
      const result = extractBranding([
        rec({ name: 'Tenant.Logo', value: 'tenant-logo-key' }),
        rec({ name: 'App.LogoUrl', value: 'https://x/app-logo.svg' }),
        rec({ name: 'Tenant.Favicon', value: 'tenant-fav-key' }),
        rec({ name: 'App.FavIcon', value: 'https://x/app-fav.png' }),
      ]);
      expect(result.logoUrl).toBe('https://x/app-logo.svg');
      expect(result.faviconUrl).toBe('https://x/app-fav.png');
    });

    it('falls back to Tenant.* when App.* is absent', () => {
      const result = extractBranding([
        rec({ name: 'Tenant.Logo', value: 'tenant-logo-key' }),
        rec({ name: 'Tenant.Favicon', value: 'tenant-fav-key' }),
      ]);
      expect(result.logoUrl).toBe('tenant-logo-key');
      expect(result.faviconUrl).toBe('tenant-fav-key');
    });

    it('accepts the symmetric App.Logo / App.Favicon keys (App wins)', { tags: ['important'] }, () => {
      const result = extractBranding([
        rec({ name: 'Tenant.Logo', value: 'tenant-logo-key' }),
        rec({ name: 'App.Logo', value: 'https://x/app-logo.svg' }),
        rec({ name: 'Tenant.Favicon', value: 'tenant-fav-key' }),
        rec({ name: 'App.Favicon', value: 'https://x/app-fav.png' }),
      ]);
      expect(result.logoUrl).toBe('https://x/app-logo.svg');
      expect(result.faviconUrl).toBe('https://x/app-fav.png');
    });

    it('leaves theme null when App.Theme JSON is invalid and no Tenant.Theme', { tags: ['edge-case'] }, () => {
      const result = extractBranding([
        rec({ name: 'App.Theme', value: '{not valid json' }),
      ]);
      expect(result.theme).toBeNull();
    });

    it('skips disabled records', { tags: ['edge-case'] }, () => {
      const result = extractBranding([
        rec({ name: 'App.LogoUrl', value: 'https://x/logo.svg', disabled: true }),
      ]);
      expect(result.logoUrl).toBeNull();
    });

    it('skips records outside the branding category (case-insensitive match)', () => {
      const fromTitlecase = extractBranding([
        rec({ name: 'App.Theme', category: 'Branding', value: '{"colors":{}}' }),
      ]);
      expect(fromTitlecase.theme).toEqual({ colors: {} });

      const fromOtherCategory = extractBranding([
        rec({ name: 'App.LogoUrl', category: 'Display', value: 'https://x/logo.svg' }),
      ]);
      expect(fromOtherCategory.logoUrl).toBeNull();
    });

    it('treats empty string values as null', { tags: ['edge-case'] }, () => {
      const result = extractBranding([
        rec({ name: 'App.LogoUrl', value: '' }),
        rec({ name: 'App.LogoHeight', value: '' }),
      ]);
      expect(result.logoUrl).toBeNull();
      expect(result.logoHeight).toBeNull();
    });
  });

  describe('resolveAssetUrl', { tags: ['important'] }, () => {
    it('prepends the origin to a PUBLIC_ASSETS storage key (PHX-4278)', () => {
      expect(
        resolveAssetUrl(
          'PUBLIC_ASSETS/aiwithdata/branding/abc/logo/x.jpeg',
          'https://tenant.host',
        ),
      ).toBe('https://tenant.host/PUBLIC_ASSETS/aiwithdata/branding/abc/logo/x.jpeg');
    });

    it('does not double the slash between origin and key', { tags: ['edge-case'] }, () => {
      expect(resolveAssetUrl('PUBLIC_ASSETS/x.png', 'https://h/')).toBe(
        'https://h/PUBLIC_ASSETS/x.png',
      );
      expect(resolveAssetUrl('/PUBLIC_ASSETS/x.png', 'https://h')).toBe(
        '/PUBLIC_ASSETS/x.png',
      );
    });

    it('leaves absolute / protocol-relative / data URLs untouched', () => {
      expect(resolveAssetUrl('https://x/logo.svg', 'https://h')).toBe('https://x/logo.svg');
      expect(resolveAssetUrl('//cdn/x.png', 'https://h')).toBe('//cdn/x.png');
      expect(resolveAssetUrl('data:image/png;base64,AAAA', 'https://h')).toBe(
        'data:image/png;base64,AAAA',
      );
    });

    it('returns the raw key when no origin is available (SSR/tests)', { tags: ['edge-case'] }, () => {
      expect(resolveAssetUrl('PUBLIC_ASSETS/x.png', undefined)).toBe('PUBLIC_ASSETS/x.png');
      expect(resolveAssetUrl(null, 'https://h')).toBeNull();
      expect(resolveAssetUrl('', 'https://h')).toBeNull();
    });
  });

  describe('tenantAssetOrigin', { tags: ['important'] }, () => {
    it('rebuilds the tenant host from an editor preview host (PHX-4278)', () => {
      // The preview iframe runs at <workspace-id>.editors.<envDomain>;
      // assets must resolve to <tenant>.<envDomain>.
      expect(
        tenantAssetOrigin(
          'aiwithdata',
          '5e91cfb6-d060-41d2-966a-38729f74d880.editors.us.sandbox.phoenix.jiffy.ai',
          'https://5e91cfb6-d060-41d2-966a-38729f74d880.editors.us.sandbox.phoenix.jiffy.ai',
        ),
      ).toBe('https://aiwithdata.us.sandbox.phoenix.jiffy.ai');
    });

    it('feeds resolveAssetUrl to produce the correct tenant asset URL', () => {
      const origin = tenantAssetOrigin(
        'aiwithdata',
        '5e91cfb6.editors.us.sandbox.phoenix.jiffy.ai',
        'https://5e91cfb6.editors.us.sandbox.phoenix.jiffy.ai',
      );
      expect(
        resolveAssetUrl(
          'PUBLIC_ASSETS/aiwithdata/branding/abc/logo/x.jpeg',
          origin,
        ),
      ).toBe(
        'https://aiwithdata.us.sandbox.phoenix.jiffy.ai/PUBLIC_ASSETS/aiwithdata/branding/abc/logo/x.jpeg',
      );
    });

    it('keeps the current origin on a deployed (non-editor) tenant host', () => {
      expect(
        tenantAssetOrigin(
          'aiwithdata',
          'aiwithdata.us.sandbox.phoenix.jiffy.ai',
          'https://aiwithdata.us.sandbox.phoenix.jiffy.ai',
        ),
      ).toBe('https://aiwithdata.us.sandbox.phoenix.jiffy.ai');
    });

    it('falls back to currentOrigin when not an editor host', { tags: ['edge-case'] }, () => {
      expect(
        tenantAssetOrigin('aiwithdata', 'localhost', 'http://localhost:3001'),
      ).toBe('http://localhost:3001');
    });

    it('falls back to currentOrigin when tenant is missing on an editor host', { tags: ['edge-case'] }, () => {
      expect(
        tenantAssetOrigin(
          null,
          'x.editors.us.sandbox.phoenix.jiffy.ai',
          'https://x.editors.us.sandbox.phoenix.jiffy.ai',
        ),
      ).toBe('https://x.editors.us.sandbox.phoenix.jiffy.ai');
    });

    it('returns currentOrigin (or undefined) when hostname is absent', { tags: ['edge-case'] }, () => {
      expect(tenantAssetOrigin('aiwithdata', undefined, 'https://h')).toBe('https://h');
      expect(tenantAssetOrigin('aiwithdata', undefined, undefined)).toBeUndefined();
    });
  });

  describe('Tenant.Theme fallback (PHX-4278)', { tags: ['important'] }, () => {
    it('parseTenantThemeDefaultDraft picks the defaultThemeId draft', () => {
      const draft = parseTenantThemeDefaultDraft(TENANT_THEME_VALUE) as {
        colors: { primary: Record<string, string> };
      };
      // defaultThemeId === 'theme-b'
      expect(draft.colors.primary['500']).toBe('#bb0000');
    });

    it('parseTenantThemeDefaultDraft returns null for invalid / empty', { tags: ['edge-case'] }, () => {
      expect(parseTenantThemeDefaultDraft(null)).toBeNull();
      expect(parseTenantThemeDefaultDraft('{bad json')).toBeNull();
      expect(parseTenantThemeDefaultDraft('{"themes":[]}')).toBeNull();
    });

    it('tenantDraftToThemeBundle merges primary (default = shade 500) over DEFAULT_THEME, drops fontFamily', () => {
      const bundle = tenantDraftToThemeBundle({
        colors: { primary: { 50: '#f0', 500: '#bb0000', 950: '#11' } },
        fontFamily: { primary: 'Source Sans 3' },
      }) as unknown as { light: { colors: Record<string, Record<string, string>>; fontFamily?: unknown } };
      expect(bundle.light.colors.primary['500']).toBe('#bb0000');
      expect(bundle.light.colors.primary.default).toBe('#bb0000');
      expect(bundle.light.colors.primary['50']).toBe('#f0');
      // fontFamily stripped so the bundled face wins.
      expect('fontFamily' in bundle.light).toBe(false);
      // Non-edited families remain from DEFAULT_THEME.
      expect(bundle.light.colors.grayscale).toEqual(
        (DEFAULT_THEME.light.colors as Record<string, unknown>).grayscale,
      );
    });

    it('extractBranding uses Tenant.Theme when App.Theme is absent', () => {
      const result = extractBranding([rec({ name: 'Tenant.Theme', value: TENANT_THEME_VALUE })]);
      const theme = result.theme as { light: { colors: Record<string, Record<string, string>> } };
      expect(theme.light.colors.primary.default).toBe('#bb0000');
      expect(theme.light.colors.secondary.default).toBe('#777777');
    });

    it('App.Theme wins over Tenant.Theme', { tags: ['important'] }, () => {
      const result = extractBranding([
        rec({ name: 'Tenant.Theme', value: TENANT_THEME_VALUE }),
        rec({ name: 'App.Theme', value: '{"colors":{"primary":{"default":"#abc"}}}' }),
      ]);
      expect(result.theme).toEqual({ colors: { primary: { default: '#abc' } } });
    });

    it('a LATER Tenant.Theme wins over an earlier one (PHX-5283 merge-order contract)', { tags: ['important'] }, () => {
      // usePreferences appends the platform-lens (org-resolved) Tenant.Theme
      // AFTER the app-lens records, so last-match must win — this is what makes
      // the per-org brand theme override any stale/app-lens copy.
      const stale = JSON.stringify({
        themes: [{ id: 't', name: 'stale', draft: { colors: { primary: { 500: '#000000' } } } }],
        defaultThemeId: 't',
      });
      const result = extractBranding([
        rec({ name: 'Tenant.Theme', value: stale }),
        rec({ name: 'Tenant.Theme', value: TENANT_THEME_VALUE }), // platform, appended last
      ]);
      const theme = result.theme as { light: { colors: Record<string, Record<string, string>> } };
      expect(theme.light.colors.primary.default).toBe('#bb0000'); // from TENANT_THEME_VALUE
    });
  });

  describe('resolveTheme', { tags: ['smoke'] }, () => {
    it('returns the tenant App.Theme when present', () => {
      const theme = { colors: { primary: { default: '#abc' } } };
      expect(resolveTheme({ ...EMPTY_BRANDING, theme })).toBe(theme);
    });

    it('falls back to DEFAULT_THEME (minus fontFamily) when theme is null', { tags: ['important'] }, () => {
      const resolved = resolveTheme(EMPTY_BRANDING) as {
        light: Record<string, unknown>;
        dark: Record<string, unknown>;
      };
      // Same colours as the default theme on each side…
      expect(resolved.light.colors).toEqual(DEFAULT_THEME.light.colors);
      expect(resolved.dark.colors).toEqual(DEFAULT_THEME.dark.colors);
      // …but fontFamily is omitted so the CSS --font-sans chain resolves
      // 'Source Sans 3 Variable' (the bundled face) instead of writing the
      // runtime slot from the default.
      expect('fontFamily' in resolved.light).toBe(false);
      expect('fontFamily' in resolved.dark).toBe(false);
    });

    it('keeps a tenant fontFamily override (does not strip it)', { tags: ['important'] }, () => {
      const theme = { fontFamily: { primary: "'Inter', sans-serif" } };
      const resolved = resolveTheme({ ...EMPTY_BRANDING, theme }) as Record<string, unknown>;
      expect(resolved).toBe(theme);
      expect((resolved.fontFamily as Record<string, unknown>).primary).toBe(
        "'Inter', sans-serif",
      );
    });
  });

  describe('applyTheme → shadcn alias bridge', { tags: ['important'] }, () => {
    // The shadcn semantic tokens in index.css are var() aliases of these
    // --color-* ramps. Asserting applyTheme writes the ramp vars proves a
    // tenant theme reaches shadcn components (Button/Badge/Card) via the
    // CSS cascade.
    it('writes --color-primary (drives --primary) from colors.primary.default', () => {
      const vars = collectVars({
        colors: { primary: { default: '#123456' } },
      });
      expect(vars['--color-primary']).toBe('#123456');
    });

    it('writes the primary ramp shades the aliases consume', () => {
      const vars = collectVars({
        colors: {
          primary: { 50: '#aa0000', 200: '#bb0000', 600: '#cc0000', 800: '#dd0000' },
        },
      });
      expect(vars['--color-primary-50']).toBe('#aa0000');
      expect(vars['--color-primary-200']).toBe('#bb0000');
      expect(vars['--color-primary-600']).toBe('#cc0000');
      expect(vars['--color-primary-800']).toBe('#dd0000');
    });

    it('writes --color-on-primary (drives --primary-foreground) from colors.primary.on', () => {
      const vars = collectVars({
        colors: { primary: { on: '#ffffff' } },
      });
      expect(vars['--color-on-primary']).toBe('#ffffff');
    });

    it('writes grayscale ramp vars that back surface / text / border tokens', () => {
      const vars = collectVars({
        colors: {
          grayscale: { 100: '#f0f0f0', 200: '#e0e0e0', 500: '#808080', 900: '#101010' },
        },
      });
      expect(vars['--color-grayscale-100']).toBe('#f0f0f0');
      expect(vars['--color-grayscale-200']).toBe('#e0e0e0');
      expect(vars['--color-grayscale-500']).toBe('#808080');
      expect(vars['--color-grayscale-900']).toBe('#101010');
    });

    it('writes --font-family-primary from fontFamily.primary', () => {
      const vars = collectVars({
        fontFamily: { primary: "'Inter', sans-serif" },
      });
      expect(vars['--font-family-primary']).toBe("'Inter', sans-serif");
    });
  });

  describe('resolveInvertSidebarColors', { tags: ['important', 'sidebar'] }, () => {
    it('reads the flag off the DEFAULT tenant theme draft (PHX-5283)', () => {
      const tenantTheme = JSON.stringify({
        themes: [
          { id: 'a', name: 'A', draft: { invertSidebarColors: false } },
          { id: 'b', name: 'B', draft: { invertSidebarColors: true } },
        ],
        defaultThemeId: 'b',
      });
      expect(resolveInvertSidebarColors(null, tenantTheme)).toBe(true);
    });

    it('uses the non-default themes\' flag only via the default id', () => {
      const tenantTheme = JSON.stringify({
        themes: [
          { id: 'a', name: 'A', draft: { invertSidebarColors: true } },
          { id: 'b', name: 'B', draft: { invertSidebarColors: false } },
        ],
        defaultThemeId: 'b',
      });
      expect(resolveInvertSidebarColors(null, tenantTheme)).toBe(false);
    });

    it('defaults to false when the flag is absent', { tags: ['edge-case'] }, () => {
      const tenantTheme = JSON.stringify({
        themes: [{ id: 'a', name: 'A', draft: { colors: {} } }],
        defaultThemeId: 'a',
      });
      expect(resolveInvertSidebarColors(null, tenantTheme)).toBe(false);
      expect(resolveInvertSidebarColors(null, null)).toBe(false);
      expect(resolveInvertSidebarColors('{bad json', null)).toBe(false);
    });

    it('honours a flat App.Theme record flag over the tenant theme', () => {
      const tenantTheme = JSON.stringify({
        themes: [{ id: 'a', name: 'A', draft: { invertSidebarColors: false } }],
        defaultThemeId: 'a',
      });
      expect(
        resolveInvertSidebarColors('{"invertSidebarColors":true}', tenantTheme),
      ).toBe(true);
    });

    it('is surfaced on the Branding object by extractBranding', () => {
      const tenantTheme = JSON.stringify({
        themes: [{ id: 'a', name: 'A', draft: { invertSidebarColors: true } }],
        defaultThemeId: 'a',
      });
      const result = extractBranding([
        rec({ name: 'Tenant.Theme', value: tenantTheme }),
      ]);
      expect(result.invertSidebarColors).toBe(true);
    });
  });
});
