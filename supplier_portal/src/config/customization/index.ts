/**
 * Component customization layer — public API.
 *
 * Lets an admin/org reshape generated UI at runtime (label, placeholder,
 * visibility, variant, basic inline style, table column props) — without
 * regenerating the app. Backed by the same preferences API the app already
 * calls. Components flagged `permission: true` in their schema slot are
 * additionally access-controlled via the per-user `screen_component`
 * permission API.
 *
 * Customization is built INTO the shadcn primitives: pass `config={SCHEMA.x}`
 * to any customizable primitive (Button, Card, Badge, Input, …). Tables use
 * `useColumnConfig`. Schemas come from `buildSchema` in `<Page>.schema.ts`.
 */
export {
  ConfigProvider,
  useComponentConfig,
  useColumnConfig,
  usePageText,
  resolveText,
  splitSlotId,
  isPermissionHidden,
} from './ConfigProvider';
export { useCustomization, type CustomizationResult } from './use-customization';
export { buildSchema } from './schema';
export {
  resolveComponentConfig,
  applyColumnOverrides,
  type ColumnLike,
} from './resolve';
export {
  buildPreferenceIndex,
  parsePreferenceName,
  decodeEnvValues,
  mapEnvString,
  resolveValue,
  pickStyle,
  type PreferenceIndex,
  type PreferenceLookup,
  type TablePreferenceLookup,
  type EnvKey,
} from './preference-index';
export {
  COMPONENT_DEFAULTS,
} from './defaults';
export {
  ALLOWED_STYLE_PROPERTIES,
  type ComponentType,
  type ComponentConfig,
  type Slot,
  type SlotDecl,
  type PageSchema,
} from './types';
