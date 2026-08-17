/**
 * Pure helpers for the related-screens catalog codegen
 * (`scripts/fetch-related-screens.ts`).
 *
 * The script makes ONE call to
 * `/api/internal/component-definitions-all/screen` (tenant-wide, every app's
 * screens in a single response) and turns the raw rows into:
 *   - `src/types/catalogs/related-screens.catalog.md`  — the agent-facing menu of every
 *     OTHER app's pages + their navigation variables, grouped by app.
 *   - `src/types/related-screens.generated.ts` — a typed runtime registry the
 *     cross-app nav resolver consumes.
 *
 * These functions are kept free of `fs` / `fetch` so they can be unit-tested
 * with raw fixtures (the repo rule: extract + test pure logic).
 *
 * Cross-app deep-linking model:
 *   - A screen's `nav.*` variables are the deep-link query params the target
 *     page reads (via `useSearchParams`). `response.*` / `page.*` variables are
 *     internal runtime state, NOT navigation params — we ignore them.
 *   - A screen with one or more REQUIRED `nav.*` variables can only be wired to
 *     a BUTTON (which has row/record context to fill them), never a static
 *     side-menu item. A screen with no `nav.*` variables can be either.
 */

/** Raw screen row from `component-definitions-all/screen`. */
export interface RawScreen {
  app_definition_key?: string;
  app_definition?: string;
  name?: string;
  label?: string;
  description?: string;
  component_type?: string;
  variables?: RawScreenVariable[];
  [key: string]: unknown;
}

export interface RawScreenVariable {
  name?: string;
  label?: string;
  type?: string;
  is_array?: boolean;
  default_value?: unknown;
}

/** A navigation variable a deep link must (or may) supply as a query param. */
export interface NavVariable {
  /** Bare param name with the `nav.` prefix stripped (e.g. `accountId`). */
  param: string;
  /** Full declared name (e.g. `nav.accountId`). */
  fullName: string;
  label: string;
  type: string;
  isArray: boolean;
  /** A nav var with no default is treated as required for deep-linking. */
  required: boolean;
}

/** A normalized screen in one related app. */
export interface RelatedScreen {
  appKey: string;
  appDefinition: string;
  /** Screen name = the route/page identifier used for deep-linking. */
  name: string;
  label: string;
  description: string;
  navVariables: NavVariable[];
  /**
   * Whether this screen can be a static side-menu target. True only when it
   * has NO required nav variables (nothing a context-less sidebar must fill).
   */
  sidebarEligible: boolean;
}

/** All screens for one related app. */
export interface RelatedApp {
  appKey: string;
  appDefinition: string;
  screens: RelatedScreen[];
}

const NAV_PREFIX = 'nav.';

/** True when a variable is a navigation (deep-link) param, not internal state. */
export function isNavVariable(v: RawScreenVariable | null | undefined): boolean {
  return typeof v?.name === 'string' && v.name.startsWith(NAV_PREFIX);
}

/**
 * Whether a nav variable has a meaningful default. An empty object `{}`, empty
 * string, null, or undefined all count as "no default" → required.
 */
function hasDefault(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return true;
}

/** Normalize a raw `nav.*` variable into a {@link NavVariable}. */
export function toNavVariable(raw: RawScreenVariable): NavVariable {
  const fullName = raw.name ?? '';
  const param = fullName.startsWith(NAV_PREFIX)
    ? fullName.slice(NAV_PREFIX.length)
    : fullName;
  return {
    param,
    fullName,
    label: raw.label ?? param,
    type: raw.type ?? 'string',
    isArray: raw.is_array === true,
    required: !hasDefault(raw.default_value),
  };
}

/**
 * Normalize one raw screen row. Returns `null` when the row isn't a usable
 * screen (no app key or no name → can't be a deep-link target).
 */
export function normalizeScreen(raw: RawScreen | null | undefined): RelatedScreen | null {
  if (!raw) return null;
  const appKey = (raw.app_definition_key ?? '').trim();
  const name = (raw.name ?? '').trim();
  if (!appKey || !name) return null;

  const seenParams = new Set<string>();
  const navVariables = (raw.variables ?? [])
    .filter(isNavVariable)
    .map(toNavVariable)
    .filter((v) => (seenParams.has(v.param) ? false : (seenParams.add(v.param), true)));

  const sidebarEligible = !navVariables.some((v) => v.required);

  return {
    appKey,
    appDefinition: (raw.app_definition ?? '').trim(),
    name,
    label: (raw.label ?? name).trim(),
    description: (raw.description ?? '').trim(),
    navVariables,
    sidebarEligible,
  };
}

/**
 * Build the grouped related-apps registry from raw screen rows.
 *
 * @param rows       every screen from `component-definitions-all/screen`
 * @param relatedAppKeys  the app_definition_keys to KEEP (the apps related to
 *   the current one). When omitted/empty, all apps except `currentAppKey` are
 *   kept (best-effort when the related set isn't known at fetch time).
 * @param currentAppKey   the current app — always excluded (you don't cross-app
 *   link to yourself).
 */
export function buildRelatedApps(
  rows: RawScreen[],
  relatedAppKeys: string[] = [],
  currentAppKey = '',
): RelatedApp[] {
  const keep = new Set(relatedAppKeys.filter(Boolean));
  const current = currentAppKey.trim();

  const byApp = new Map<string, RelatedApp>();
  for (const row of rows) {
    const screen = normalizeScreen(row);
    if (!screen) continue;
    if (screen.appKey === current) continue;
    if (keep.size > 0 && !keep.has(screen.appKey)) continue;

    let app = byApp.get(screen.appKey);
    if (!app) {
      app = {
        appKey: screen.appKey,
        appDefinition: screen.appDefinition,
        screens: [],
      };
      byApp.set(screen.appKey, app);
    }
    app.screens.push(screen);
  }

  // Deterministic output: sort apps by key, screens by name; dedupe screens.
  const apps = [...byApp.values()].sort((a, b) => a.appKey.localeCompare(b.appKey));
  for (const app of apps) {
    const seen = new Set<string>();
    app.screens = app.screens
      .filter((s) => (seen.has(s.name) ? false : (seen.add(s.name), true)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  return apps;
}

/** Escape a cell value for a Markdown table. */
function mdCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ').trim() || '—';
}

/** Render the agent-facing catalog markdown. */
export function renderRelatedScreensCatalog(apps: RelatedApp[]): string {
  const lines: string[] = [];
  lines.push('# Related application screens (cross-app navigation)');
  lines.push('');
  lines.push(
    '<!-- AUTO-GENERATED by scripts/fetch-related-screens.ts — do not edit by hand. -->',
  );
  lines.push(
    '<!-- Source: Phoenix GET /api/internal/component-definitions-all/screen -->',
  );
  lines.push('');
  lines.push(
    'Pages in OTHER applications related to this one, for wiring cross-app',
    'navigation (see docs/CROSS-APP-NAVIGATION-PLAN.md). When the user asks to',
    'link to another app\u2019s page, find it here — never guess the screen name.',
  );
  lines.push('');
  lines.push('**Binding rule:** a screen with required nav variables can only be');
  lines.push('bound to a **button** (which has row/record context to fill them),');
  lines.push('NOT a static side-menu item. Screens with no nav variables can be');
  lines.push('either. The `Sidebar?` column reflects this.');
  lines.push('');

  if (apps.length === 0) {
    lines.push('_No related-application screens found._');
    lines.push('');
    return lines.join('\n');
  }

  for (const app of apps) {
    lines.push(`## ${app.appDefinition || app.appKey}`);
    lines.push('');
    lines.push(`- appKey: \`${app.appKey}\``);
    lines.push('');
    lines.push('| Screen | Label | Description | Nav variables | Sidebar? |');
    lines.push('|--------|-------|-------------|---------------|----------|');
    for (const s of app.screens) {
      const navVars =
        s.navVariables.length === 0
          ? '—'
          : s.navVariables
              .map(
                (v) =>
                  `${v.param}${v.required ? '*' : ''}:${v.type}${v.isArray ? '[]' : ''}`,
              )
              .join(', ');
      lines.push(
        `| \`${mdCell(s.name)}\` | ${mdCell(s.label)} | ${mdCell(s.description)} | ${mdCell(navVars)} | ${s.sidebarEligible ? 'yes' : 'no'} |`,
      );
    }
    lines.push('');
  }
  lines.push('_`*` marks a required nav variable (no default → must be supplied)._');
  lines.push('');
  return lines.join('\n');
}

/** Render the typed runtime registry consumed by the resolver. */
export function renderRelatedScreensGenerated(apps: RelatedApp[]): string {
  const lines: string[] = [];
  lines.push('/* eslint-disable */');
  lines.push(
    '// AUTO-GENERATED by scripts/fetch-related-screens.ts - do not edit by hand.',
  );
  lines.push(
    '// Source: Phoenix GET /api/internal/component-definitions-all/screen',
  );
  lines.push('');
  lines.push('export interface RelatedScreenNavVariable {');
  lines.push('  param: string;');
  lines.push('  fullName: string;');
  lines.push('  label: string;');
  lines.push('  type: string;');
  lines.push('  isArray: boolean;');
  lines.push('  required: boolean;');
  lines.push('}');
  lines.push('');
  lines.push('export interface RelatedScreenEntry {');
  lines.push('  appKey: string;');
  lines.push('  appDefinition: string;');
  lines.push('  name: string;');
  lines.push('  label: string;');
  lines.push('  description: string;');
  lines.push('  navVariables: RelatedScreenNavVariable[];');
  lines.push('  sidebarEligible: boolean;');
  lines.push('}');
  lines.push('');
  lines.push('export interface RelatedAppEntry {');
  lines.push('  appKey: string;');
  lines.push('  appDefinition: string;');
  lines.push('  screens: RelatedScreenEntry[];');
  lines.push('}');
  lines.push('');
  lines.push(
    `export const RELATED_APPS: RelatedAppEntry[] = ${JSON.stringify(apps, null, 2)};`,
  );
  lines.push('');
  lines.push('/** Flat lookup: `${appKey}::${screenName}` → entry. */');
  lines.push(
    'export const RELATED_SCREENS_BY_KEY: Record<string, RelatedScreenEntry> = {};',
  );
  lines.push('for (const app of RELATED_APPS) {');
  lines.push('  for (const screen of app.screens) {');
  lines.push('    RELATED_SCREENS_BY_KEY[`${app.appKey}::${screen.name}`] = screen;');
  lines.push('  }');
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}
