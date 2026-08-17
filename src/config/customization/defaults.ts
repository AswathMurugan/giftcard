/**
 * Per-type code defaults — the ultimate fallback so the app never breaks if
 * a preference (or the whole preferences API) is missing. Merge order in
 * `useComponentConfig`:
 *
 *   { type, ...COMPONENT_DEFAULTS[type], ...serverOverride }
 *
 * i.e. a server-resolved override always wins over these.
 */
import type { ComponentConfig, ComponentType } from './types';

export const COMPONENT_DEFAULTS: Record<
  ComponentType,
  Partial<ComponentConfig>
> = {
  button: { visible: true, disabled: false, variant: 'default' },
  input: { visible: true, disabled: false, required: false },
  select: { visible: true, disabled: false, required: false },
  checkbox: { visible: true, disabled: false },
  textarea: { visible: true, disabled: false, required: false },
  switch: { visible: true, disabled: false },
  radio: { visible: true, disabled: false },
  toggle: { visible: true, disabled: false, variant: 'default' },
  slider: { visible: true, disabled: false },
  'native-select': { visible: true, disabled: false, required: false },
  badge: { visible: true, variant: 'default' },
  // Container — visibility + style only (no disabled/variant/label).
  card: { visible: true },
  // Static text label — admin-editable label text + visibility + style.
  label: { visible: true },
  // Address-only — has no Cfg* wrapper; used by useColumnConfig.
  table: { visible: true },
  // Address-only — declares an admin-editable text key; used by usePageText.
  text: { visible: true },
};
