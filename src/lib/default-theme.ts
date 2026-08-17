/**
 * Default theme bundle — the Phoenix "Gold" palette + Source Sans 3 type.
 *
 * Applied at runtime whenever the tenant has no `App.Theme` branding
 * preference set. The colour values here match the static ramps in
 * `src/index.css`, so applying it on mount re-asserts the first-paint
 * defaults rather than changing them (no flash).
 *
 * Mirrors the Phoenix renderer's fallback theme (apps/renderer →
 * @ui-core/theme, where it is called `emeraldTheme`). Renamed here to
 * `DEFAULT_THEME` because the palette is Phoenix Gold, not emerald — the
 * name describes its role (the default) rather than a colour.
 */

import type { ThemeBundle, ThemeRecord } from './apply-theme';

const defaultBase: ThemeRecord = {
  colors: {
    primary: {
      50: '#F9F4E1',
      100: '#F6EDC9',
      200: '#F1E2A9',
      300: '#D6C16A',
      400: '#BFA238',
      500: '#9E7B19',
      600: '#8A6A15',
      700: '#745711',
      800: '#5E460E',
      900: '#443308',
      950: '#2B2004',
      default: '#9E7B19',
    },
    secondary: {
      50: '#FAFAFA',
      100: '#F4F4F5',
      200: '#E4E4E7',
      300: '#D4D4D8',
      400: '#A8ABB1',
      500: '#73767C',
      600: '#535862',
      700: '#3F434A',
      800: '#2B2F36',
      900: '#1C1C1C',
      950: '#000000',
      default: '#1C1C1C',
    },
    success: {
      50: '#F2F8F4',
      100: '#DDEEE4',
      200: '#B8DBC8',
      300: '#86BF9E',
      400: '#3F8F62',
      500: '#005928',
      600: '#004D22',
      700: '#00401C',
      800: '#003316',
      900: '#00240F',
      950: '#001707',
      default: '#005928',
    },
    warning: {
      50: '#FFF7EF',
      100: '#FFE9D9',
      200: '#FFD1B3',
      300: '#FFB68A',
      400: '#F7935D',
      500: '#D96A2B',
      600: '#B85722',
      700: '#94461B',
      800: '#703514',
      900: '#4D240E',
      950: '#331707',
      default: '#D96A2B',
    },
    danger: {
      50: '#FDF2F1',
      100: '#F9DDDA',
      200: '#F2B8B3',
      300: '#E48880',
      400: '#C94B3F',
      500: '#8B1200',
      600: '#7A1000',
      700: '#660D00',
      800: '#520A00',
      900: '#3D0700',
      950: '#260400',
      default: '#8B1200',
    },
    info: {
      50: '#F2F8FC',
      100: '#DDEEF8',
      200: '#B8D7EC',
      300: '#86B8DB',
      400: '#3F8FBF',
      500: '#075985',
      600: '#064E73',
      700: '#05405E',
      800: '#04324A',
      900: '#032435',
      950: '#021725',
      default: '#075985',
    },
    grayscale: {
      50: '#FAFAFA',
      100: '#F4F4F5',
      200: '#E4E4E7',
      300: '#D4D4D8',
      400: '#A8ABB1',
      500: '#73767C',
      600: '#535862',
      700: '#3F434A',
      800: '#2B2F36',
      900: '#1C1C1C',
      950: '#000000',
      default: '#1C1C1C',
    },
    monochrome: {
      white: '#ffffff',
      black: '#000000',
    },
  },
  fontFamily: {
    // Lead with the family name the starter actually bundles
    // (`@fontsource-variable/source-sans-3` registers 'Source Sans 3
    // Variable'). Requesting plain 'Source Sans 3' here made the page bind
    // to whatever static 'Source Sans 3' face the host (e.g. the editor
    // preview chrome) had loaded — a single fixed weight — instead of the
    // bundled variable font. A tenant `App.Theme.fontFamily.primary` still
    // overrides this.
    primary:
      "'Source Sans 3 Variable', 'Source Sans 3', ui-sans-serif, system-ui, sans-serif",
    secondary: 'Georgia, "Times New Roman", serif',
  },
  fontWeights: {
    light: '300',
    normal: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
  },
  lineHeights: {
    desktop: {
      tight: '1.25',
      normal: '1.5',
      relaxed: '1.75',
    },
    mobile: {
      tight: '1.25',
      normal: '1.5',
      relaxed: '1.75',
    },
  },
};

/** 50↔950, 100↔900, …, 500 fixed — mirrors a 50..950 ramp end-for-end. */
const RAMP_MIRROR: Record<string, string> = {
  '50': '950', '100': '900', '200': '800', '300': '700', '400': '600',
  '500': '500',
  '600': '400', '700': '300', '800': '200', '900': '100', '950': '50',
};

/**
 * Reverse a colour ramp for dark mode: shade 50 becomes the old 950, 100↔900,
 * …, 500 unchanged. `default`/`on`/any non-numeric key is kept as-is. For the
 * gold ramp this produces exactly the inverted values authored in index.css's
 * `.dark` block (cream 50 → dark-brown 50), and it generalizes to ANY tenant
 * brand ramp — no per-colour math.
 */
export function reverseRamp(
  ramp: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(ramp)) {
    const mirror = RAMP_MIRROR[k];
    out[k] = mirror && ramp[mirror] !== undefined ? ramp[mirror] : v;
  }
  return out;
}

/**
 * Build the DARK record from a light one: reverse the BRAND (`primary`) ramp so
 * gold surfaces (`bg-primary-50` banners, icon tiles, the table header, …) flip
 * in dark mode. Neutral/status ramps are left as-is — dark neutral surfaces come
 * from the semantic tokens in index.css's `.dark` block, not the raw ramps.
 *
 * WHY this is needed: `applyTheme` writes the ramp as INLINE styles on <html>,
 * and inline beats the `.dark` class — so without a real dark record the LIGHT
 * primary ramp was pinned inline in dark mode and every gold surface stayed
 * light. Giving the bundle a genuine dark side fixes the whole class at once.
 */
export function toDarkRecord(light: ThemeRecord): ThemeRecord {
  const colors = (light.colors ?? {}) as Record<
    string,
    Record<string, string>
  >;
  if (!colors.primary) return light;
  return {
    ...light,
    colors: { ...colors, primary: reverseRamp(colors.primary) },
  };
}

export const DEFAULT_THEME: ThemeBundle = {
  light: defaultBase,
  dark: toDarkRecord(defaultBase),
};
