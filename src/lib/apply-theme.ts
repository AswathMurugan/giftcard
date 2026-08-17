/**
 * Runtime theme applier.
 *
 * Walks a theme record and writes the corresponding CSS custom properties
 * onto `document.documentElement` (or a supplied element). Mirrors the
 * Phoenix renderer's `applyTheme` (apps/renderer → @ui-core/theme) so a
 * cloned app paints the same CSS variables the renderer does.
 *
 * The starter applies a theme at runtime from the tenant's `App.Theme`
 * preference; when that preference is absent it applies `DEFAULT_THEME`
 * (see `default-theme.ts`). Nothing about theming is code-generated.
 */

export type ThemeRecord = Record<string, unknown>;

export type ThemeMode = 'light' | 'dark';

export interface ThemeBundle {
  light: ThemeRecord;
  dark: ThemeRecord;
}

interface ElementWithStyle {
  style: { setProperty: (name: string, value: string) => void };
  setAttribute?: (name: string, value: string) => void;
}

function toKebab(input: string | undefined): string {
  if (!input) return '';
  return input.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

function isBundle(input: ThemeRecord | ThemeBundle): input is ThemeBundle {
  return (
    !!input &&
    typeof input === 'object' &&
    'light' in input &&
    'dark' in input &&
    !('colors' in input)
  );
}

/**
 * Apply a theme bundle (or a single record) to the DOM as CSS variables.
 *
 * @param theme - A `{ light, dark }` bundle or a flat theme record.
 * @param mode  - Which side of the bundle to apply (default `light`).
 * @param el    - Target element; defaults to `document.documentElement`.
 */
export function applyTheme(
  theme: ThemeBundle | ThemeRecord,
  mode: ThemeMode = 'light',
  el?: ElementWithStyle,
): void {
  const target: ElementWithStyle | undefined =
    el ??
    (typeof document !== 'undefined'
      ? (document.documentElement as unknown as ElementWithStyle)
      : undefined);

  if (!target) return;

  const record: ThemeRecord = isBundle(theme) ? theme[mode] : theme;

  if (target.setAttribute) {
    target.setAttribute('data-theme-mode', mode);
  }

  const set = (name: string, value: string | number) =>
    target.style.setProperty(name, String(value));

  const walk = (obj: unknown, path: string[] = []) => {
    Object.entries((obj as Record<string, unknown>) || {}).forEach(
      ([key, val]) => {
        if (val && typeof val === 'object' && !Array.isArray(val)) {
          walk(val, [...path, key]);
          return;
        }

        if (path[0] === 'colors') {
          const group = path[1];
          if (!group) {
            set(`--color-${toKebab(key)}`, val as string);
            return;
          }
          if (key === 'on') {
            set(`--color-on-${toKebab(group)}`, val as string);
            return;
          }
          const suffix = key === 'default' ? '' : `-${toKebab(key)}`;
          set(`--color-${toKebab(group)}${suffix}`, val as string);
          return;
        }

        if (path[0] === 'fontSizes') {
          const device = path[1];
          if (!device) {
            set(`--font-size-${toKebab(key)}`, val as string);
            return;
          }
          set(`--font-size-${toKebab(device)}-${toKebab(key)}`, val as string);
          return;
        }

        // Singular `fontSize` for runtime tenant-theme bundles.
        if (path[0] === 'fontSize') {
          set(`--font-size-${toKebab(key)}`, val as string);
          return;
        }

        if (path[0] === 'letterSpacings') {
          const device = path[1];
          if (!device) {
            set(`--letter-spacing-${toKebab(key)}`, val as string);
            return;
          }
          set(
            `--letter-spacing-${toKebab(device)}-${toKebab(key)}`,
            val as string,
          );
          return;
        }

        if (path[0] === 'letterSpacing') {
          set(`--letter-spacing-${toKebab(key)}`, val as string);
          return;
        }

        if (path[0] === 'lineHeights') {
          const device = path[1];
          if (!device) {
            set(`--line-height-${toKebab(key)}`, val as string);
            return;
          }
          set(
            `--line-height-${toKebab(device)}-${toKebab(key)}`,
            val as string,
          );
          return;
        }

        if (path[0] === 'lineHeight') {
          set(`--line-height-${toKebab(key)}`, val as string);
          return;
        }

        if (path[0] === 'fontWeights') {
          set(`--font-weight-${toKebab(key)}`, val as string);
          return;
        }

        if (path[0] === 'fontFamily') {
          set(`--font-family-${toKebab(key)}`, val as string);
          return;
        }

        if (key === 'fontFamily') {
          set(`--font-family-sans`, val as string);
        }
      },
    );
  };

  walk(record);
}
