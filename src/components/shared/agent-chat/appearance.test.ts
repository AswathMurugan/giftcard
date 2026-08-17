import { describe, it, expect } from 'vitest';
import { appearanceStyle, resolveIcons, DEFAULT_ICONS } from './appearance';

describe('resolveIcons', { tags: ['agent-chat', 'logic'] }, () => {
  it('returns the defaults when nothing is supplied', { tags: ['edge-case'] }, () => {
    expect(resolveIcons()).toEqual(DEFAULT_ICONS);
    expect(resolveIcons({})).toEqual(DEFAULT_ICONS);
  });

  it('overrides only the glyphs given, keeping the rest', () => {
    const icons = resolveIcons({ send: 'icon_-Tb_send' });
    expect(icons.send).toBe('icon_-Tb_send');
    expect(icons.attach).toBe(DEFAULT_ICONS.attach);
    expect(icons.close).toBe(DEFAULT_ICONS.close);
  });

  it('covers every glyph the chat renders', { tags: ['smoke'] }, () => {
    // A missing key here means some glyph is unthemeable.
    expect(Object.keys(DEFAULT_ICONS).sort()).toEqual(
      ['attach', 'close', 'file', 'history', 'launcher', 'newChat', 'send'].sort(),
    );
  });
});

describe('appearanceStyle', { tags: ['agent-chat', 'important'] }, () => {
  it('emits nothing without colours — the app theme shows through', { tags: ['edge-case'] }, () => {
    expect(appearanceStyle()).toEqual({});
    expect(appearanceStyle({})).toEqual({});
    expect(appearanceStyle({ icons: { send: 'x' } })).toEqual({});
  });

  it(
    'fans a single accent across the whole primary ramp',
    { tags: ['important'] },
    () => {
      // The component uses several ramp steps; setting only `accent` must
      // recolour ALL of them, or parts stay on the app's own gold.
      const s = appearanceStyle({ colors: { accent: '#0F766E' } });
      for (const key of [
        '--primary',
        '--color-primary',
        '--color-primary-500',
        '--color-primary-600',
        '--color-primary-700',
        '--color-primary-50',
        '--color-primary-100',
        '--color-primary-300',
      ]) {
        expect(s[key]).toBe('#0F766E');
      }
    },
  );

  it('lets accentSoft and accentBorder override the fanned accent', () => {
    const s = appearanceStyle({
      colors: { accent: '#111', accentSoft: '#eee', accentBorder: '#999' },
    });
    expect(s['--color-primary']).toBe('#111');
    expect(s['--color-primary-50']).toBe('#eee');
    expect(s['--color-primary-300']).toBe('#999');
  });

  it('maps surface + text colours to their semantic tokens', () => {
    const s = appearanceStyle({
      colors: {
        surface: '#fff',
        surfaceMuted: '#f4f4f5',
        border: '#e4e4e7',
        text: '#18181b',
        textMuted: '#71717a',
      },
    });
    expect(s['--background']).toBe('#fff');
    expect(s['--muted']).toBe('#f4f4f5');
    expect(s['--border']).toBe('#e4e4e7');
    expect(s['--input']).toBe('#e4e4e7');
    expect(s['--foreground']).toBe('#18181b');
    expect(s['--muted-foreground']).toBe('#71717a');
  });

  it('omits keys that were not set — no empty-string overrides', { tags: ['edge-case'] }, () => {
    // An emitted empty value would BLANK the token rather than inherit it.
    const s = appearanceStyle({ colors: { accent: '#111' } });
    expect(s).not.toHaveProperty('--background');
    expect(s).not.toHaveProperty('--foreground');
    expect(Object.values(s).every(Boolean)).toBe(true);
  });
});
