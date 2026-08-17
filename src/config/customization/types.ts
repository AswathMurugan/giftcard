/**
 * Component customization — types.
 *
 * The customization layer lets an admin/org reshape generated UI at RUNTIME
 * (label, placeholder, visibility, variant, basic inline style, and table
 * column props) WITHOUT regenerating the app. Values come from the same
 * merged preferences API the BrandingProvider already reads
 * (`/api/preferences?is_merged=true`), so org→app→tenant precedence
 * is resolved SERVER-SIDE — the client never merges scopes.
 *
 * Permissions (page-level, allow-list) gate whether a component renders at
 * all. Both layers are looked up by a flat address: `<Page>.<componentName>`.
 *
 * Nothing here is code-generated except the per-page schema (see
 * `schema.ts`), which the agent emits alongside each page.
 */
import type { CSSProperties } from 'react';

/**
 * The customizable component kinds. Each maps to one `Cfg*` wrapper that
 * composes the matching shadcn primitive. Raw HTML is intentionally NOT
 * customizable — only these typed components are.
 *
 * `'table'` and `'text'` are ADDRESS-ONLY types: they have no rendered
 * primitive. A `'table'` slot addresses admin column-prop overrides
 * (`useColumnConfig`); a `'text'` slot declares an admin-editable raw-HTML
 * text key resolved by `usePageText` (so the key is discoverable in the
 * schema and type-checked at the call site).
 */
export type ComponentType =
  | 'button'
  | 'input'
  | 'select'
  | 'checkbox'
  | 'textarea'
  | 'switch'
  | 'radio'
  | 'toggle'
  | 'slider'
  | 'native-select'
  | 'badge'
  | 'card'
  | 'label'
  | 'table'
  | 'text';

/**
 * The basic, safe set of CSS properties an admin may override inline.
 * Deliberately small — no pseudo-states, no media queries, no layout-breaking
 * props. Anything outside this set in a preference record is ignored.
 */
export const ALLOWED_STYLE_PROPERTIES = new Set<keyof CSSProperties>([
  'color',
  'backgroundColor',
  'borderColor',
  'borderWidth',
  'borderRadius',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'textAlign',
  'textDecoration',
  'padding',
  'margin',
  'opacity',
  'width',
  'height',
]);

/**
 * Resolved configuration for a single component, after merging code defaults
 * with the server-resolved preference override. Consumed by `Cfg*`.
 *
 * Superset of props across all component types — each `Cfg*` reads only the
 * fields it understands. Easier for support to author than per-type unions.
 */
export interface ComponentConfig {
  type: ComponentType;
  /** Visible text label (button text, field label). */
  label?: string;
  /** Input/textarea placeholder. */
  placeholder?: string;
  /** Small helper text rendered beneath a field. */
  helpText?: string;
  /** Whether the field is required (adds `*` + aria-required). */
  required?: boolean;
  /** When `false`, the component renders nothing (preference-driven hide). */
  visible?: boolean;
  /** Disables the control. */
  disabled?: boolean;
  /** Component variant token (e.g. button 'primary' | 'outline'). */
  variant?: string;
  /** Extra class names appended to the component's own classes. */
  className?: string;
  /** Inline style overrides (filtered to ALLOWED_STYLE_PROPERTIES). */
  style?: CSSProperties;
}

/**
 * A schema leaf: the customizable component's stable id (full address
 * `<Page>.<name>`) plus its type. Produced by `buildSchema`; passed to a
 * primitive via its `config` prop. Referencing the node (not a string) makes
 * a typo a compile error.
 */
export interface Slot<T extends ComponentType = ComponentType> {
  /** Full address: `<Page>.<componentName>`. */
  id: string;
  /**
   * The slot's component type. Generic so `buildSchema` can preserve the
   * per-key literal (e.g. `'text'`), which `usePageText` relies on to
   * type-check text keys. Defaults to the full union for plain `Slot` uses.
   */
  type: T;
  /**
   * When true, this component is access-controlled: it renders only if the
   * current user has a `screen_component` permission for it. When false/absent
   * the component is never permission-gated (always shown). See
   * `useComponentPermissions`.
   */
  permission?: boolean;
}

/**
 * A schema declaration value: either a bare component type (no permission
 * gating) or an object with the type plus optional flags.
 *
 *   { kpiOutflows: { type: 'card', permission: true } }  // gated
 *   { kpiInflows:  'card' }                               // plain
 */
export type SlotDecl<T extends ComponentType = ComponentType> =
  | T
  | { type: T; permission?: boolean };

/** Extract the ComponentType literal from a SlotDecl. */
export type SlotDeclType<D> = D extends ComponentType
  ? D
  : D extends { type: infer T }
    ? T
    : never;

/**
 * Per-page schema: map of component name → its resolved Slot. When built from
 * a concrete `{ name: SlotDecl }` map, each slot preserves its literal type.
 */
export type PageSchema<Names extends string = string> = Record<Names, Slot>;
