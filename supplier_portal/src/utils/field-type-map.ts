/**
 * Maps entity field types to shadcn/ui component imports.
 *
 * Used by the AI agent and generated code to determine which component
 * to render for each entity field type.
 */

import type { BusinessType } from '@/types/entity';

export type FieldType = BusinessType;

export interface FieldComponentMapping {
  /** Package import path */
  importFrom: string;
  /** Named export to import */
  componentName: string;
  /** Whether the field is read-only by nature (UUID, Autonumber, etc.) */
  readOnly?: boolean;
  /** Additional notes for the AI agent */
  notes?: string;
}

/**
 * Mapping from entity field type to the shadcn/ui component to use.
 *
 * IMPORTANT: Only use shadcn/ui components available in this project.
 */
export const FIELD_TYPE_MAP: Record<FieldType, FieldComponentMapping> = {
  Text: { importFrom: '@/components/ui/input', componentName: 'Input' },
  Email: { importFrom: '@/components/ui/input', componentName: 'Input', notes: 'Set type="email"' },
  Phonenumber: { importFrom: '@/components/ui/input', componentName: 'Input', notes: 'Set type="tel"' },
  Currency: { importFrom: '@/components/ui/input', componentName: 'Input', notes: 'Set type="number", add currency prefix' },
  Percent: { importFrom: '@/components/ui/input', componentName: 'Input', notes: 'Set type="number", add % suffix' },
  Checkbox: { importFrom: '@/components/ui/checkbox', componentName: 'Checkbox' },
  Date: { importFrom: '@/components/ui/calendar', componentName: 'Calendar', notes: 'Use with Popover for date picker' },
  Datetime: { importFrom: '@/components/ui/calendar', componentName: 'Calendar', notes: 'Use with Popover, enable time selection' },
  Duration: { importFrom: '@/components/ui/input', componentName: 'Input', notes: 'Duration input' },
  Enumeration: { importFrom: '@/components/ui/select', componentName: 'Select', notes: 'Use Select with SelectContent/SelectItem' },
  UUID: { importFrom: '@/components/ui/input', componentName: 'Input', readOnly: true },
  SSN: { importFrom: '@/components/ui/input', componentName: 'Input', notes: 'Masked input for SSN' },
  Float: { importFrom: '@/components/ui/input', componentName: 'Input', notes: 'Set type="number"' },
  Integer: { importFrom: '@/components/ui/input', componentName: 'Input', notes: 'Set type="number", step=1, no decimals' },
  Decimal: { importFrom: '@/components/ui/input', componentName: 'Input', notes: 'Set type="number"' },
  Multilinetext: { importFrom: '@/components/ui/textarea', componentName: 'Textarea' },
  Json: { importFrom: '@/components/ui/textarea', componentName: 'Textarea', readOnly: true, notes: 'Display as formatted JSON string' },
  File: { importFrom: '@/components/ui/input', componentName: 'Input', notes: 'Set type="file"' },
  Link: { importFrom: '@/components/ui/select', componentName: 'Select', notes: 'Load options from the linked entity via a saved query (useSavedQueryList) — create one with the create_saved_query tool if none exists' },
  Backlink: { importFrom: '@/components/ui/table', componentName: 'Table', notes: 'Render as sub-table using shadcn Table component' },
  Ltree: { importFrom: '@/components/ui/input', componentName: 'Input', readOnly: true },
  Autonumber: { importFrom: '@/components/ui/input', componentName: 'Input', readOnly: true },
  URL: { importFrom: '@/components/ui/input', componentName: 'Input', notes: 'Set type="url"' },
  Seal: { importFrom: '@/components/ui/input', componentName: 'Input', readOnly: true },
  Signature: { importFrom: '@/components/ui/input', componentName: 'Input', readOnly: true },
  Computed: { importFrom: '@/components/ui/input', componentName: 'Input', readOnly: true },
};

/** Fields that should be excluded from table columns by default */
export const EXCLUDED_FROM_TABLE: FieldType[] = ['Json', 'File', 'Backlink', 'Multilinetext'];

/** Fields that should be excluded from forms (auto-generated / system fields) */
export const EXCLUDED_FROM_FORM: string[] = ['id', 'created_at', 'updated_at', 'execution_id'];
