import { describe, it, expect } from 'vitest';
import {
  reverseRamp,
  toDarkRecord,
  DEFAULT_THEME,
} from './default-theme';
import type { ThemeRecord } from './apply-theme';

describe('default-theme dark inversion', { tags: ['branding', 'theme', 'logic'] }, () => {
  describe('reverseRamp', { tags: ['important'] }, () => {
    it('mirrors 50<->950 (…), keeps 500 and non-numeric keys', () => {
      const out = reverseRamp({
        '50': 'a', '100': 'b', '200': 'c', '300': 'd', '400': 'e',
        '500': 'MID',
        '600': 'f', '700': 'g', '800': 'h', '900': 'i', '950': 'j',
        default: 'D', on: 'O',
      });
      expect(out['50']).toBe('j'); // was 950
      expect(out['950']).toBe('a'); // was 50
      expect(out['100']).toBe('i'); // was 900
      expect(out['400']).toBe('f'); // was 600
      expect(out['500']).toBe('MID'); // fixed
      expect(out.default).toBe('D'); // kept
      expect(out.on).toBe('O'); // kept
    });

    it('produces the gold `.dark` values from the light gold ramp', () => {
      // The default gold light ramp reversed === the values authored in
      // index.css .dark (cream 50 -> dark-brown 50).
      const light = (DEFAULT_THEME.light.colors as Record<string, Record<string, string>>).primary;
      const rev = reverseRamp(light);
      expect(rev['50'].toLowerCase()).toBe('#2b2004'); // was light 950
      expect(rev['950'].toLowerCase()).toBe('#f9f4e1'); // was light 50
      expect(rev['500']).toBe(light['500']); // 500 fixed
    });
  });

  describe('toDarkRecord', { tags: ['important'] }, () => {
    it('reverses ONLY the primary ramp, leaves others untouched', () => {
      const light: ThemeRecord = {
        colors: {
          primary: { '50': 'L', '950': 'D', '500': 'M' },
          grayscale: { '50': 'g50', '950': 'g950' },
        },
        fontWeights: { bold: '700' },
      };
      const dark = toDarkRecord(light) as {
        colors: Record<string, Record<string, string>>;
        fontWeights: Record<string, string>;
      };
      expect(dark.colors.primary['50']).toBe('D'); // reversed
      expect(dark.colors.primary['950']).toBe('L');
      expect(dark.colors.grayscale).toEqual({ '50': 'g50', '950': 'g950' }); // untouched
      expect(dark.fontWeights).toEqual({ bold: '700' }); // untouched
    });

    it('is a no-op when there is no primary ramp', () => {
      const rec: ThemeRecord = { colors: { grayscale: { '50': 'x' } } };
      expect(toDarkRecord(rec)).toBe(rec);
    });
  });

  describe('DEFAULT_THEME', { tags: ['smoke'] }, () => {
    it('dark side differs from light on primary (was identical — the bug)', () => {
      const l = (DEFAULT_THEME.light.colors as Record<string, Record<string, string>>).primary;
      const d = (DEFAULT_THEME.dark.colors as Record<string, Record<string, string>>).primary;
      expect(d['50']).not.toBe(l['50']);
      expect(d['50']).toBe(l['950']);
    });
  });
});
