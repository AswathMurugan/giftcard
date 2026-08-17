/**
 * SearchableSelect option helpers — kept in a separate module (not the
 * component file) so the component file only exports components, satisfying
 * `react-refresh/only-export-components` (fast refresh).
 */

/** An option is a bare string (label === value) or an explicit {label,value}. */
export type SearchableSelectOption =
  | string
  | { label: string; value: string; disabled?: boolean }

export interface OptionObject {
  label: string
  value: string
  disabled?: boolean
}

/** Normalize string | {label,value} options to a uniform {label,value} list. */
export function normalizeOptions(
  options: readonly SearchableSelectOption[] | null | undefined,
): OptionObject[] {
  if (!Array.isArray(options)) return []
  return options.map((o) =>
    typeof o === "string" ? { label: o, value: o } : o,
  )
}
