import { asText, coerceBool } from "@/lib/runtime"
import type { Preference } from "@/queries/use-preferences"

const APPLICATION_GROUP = "__application__"
const TENANT_GROUP = "__tenant__"
const OTHER_GROUP = "__other__"

export interface PreferenceGroup {
  key: string
  label: string
  preferences: Preference[]
}

export interface PreferenceOption {
  label: string
  value: string
}

export const PREFERENCE_EDITOR_KIND = {
  BOOLEAN: "boolean",
  MULTILINE: "multiline",
  NUMBER: "number",
  SECRET: "secret",
  SELECT: "select",
  TEXT: "text",
} as const

export type PreferenceEditorKind =
  (typeof PREFERENCE_EDITOR_KIND)[keyof typeof PREFERENCE_EDITOR_KIND]

function humanize(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

function hasReference(value: unknown): boolean {
  if (asText(value).trim()) return true
  if (typeof value !== "object" || value === null) return false
  return asText((value as { id?: unknown }).id).trim() !== ""
}

function preferenceProperty(preference: Preference): string {
  return asText(preference.name).split(".").at(-1)?.toLowerCase() ?? ""
}

function normalizeOptions(value: unknown): PreferenceOption[] {
  if (!Array.isArray(value)) return []
  const options = new Map<string, PreferenceOption>()
  for (const raw of value) {
    const option =
      typeof raw === "object" && raw !== null
        ? {
            label: asText((raw as { label?: unknown }).label),
            value: asText((raw as { value?: unknown }).value),
          }
        : { label: asText(raw), value: asText(raw) }
    if (option.value && !options.has(option.value)) {
      options.set(option.value, {
        label: option.label || option.value,
        value: option.value,
      })
    }
  }
  return Array.from(options.values())
}

/** Read optional select metadata without inventing choices for a preference. */
export function preferenceOptions(preference: Preference): PreferenceOption[] {
  const record = preference as unknown as Record<string, unknown>
  const raw = record.options ?? record.display_options ?? record.allowed_values
  let options = normalizeOptions(raw)
  if (options.length === 0 && typeof raw === "string") {
    try {
      options = normalizeOptions(JSON.parse(raw))
    } catch {
      return []
    }
  }

  const value = asText(preference.value)
  if (
    value &&
    options.length > 0 &&
    !options.some((option) => option.value === value)
  ) {
    options.unshift({ label: value, value })
  }
  return options
}

/** Choose the HTML editor from backend metadata and safe property semantics. */
export function preferenceEditorKind(
  preference: Preference
): PreferenceEditorKind {
  if (coerceBool(preference.is_secret)) return PREFERENCE_EDITOR_KIND.SECRET

  const displayType = asText(preference.display_type).trim().toLowerCase()
  const property = preferenceProperty(preference)
  if (
    ["boolean", "bool", "switch", "toggle"].includes(displayType) ||
    ["disabled", "required", "visible"].includes(property)
  ) {
    return PREFERENCE_EDITOR_KIND.BOOLEAN
  }
  if (
    ["number", "numeric", "integer", "float", "decimal"].includes(displayType)
  ) {
    return PREFERENCE_EDITOR_KIND.NUMBER
  }
  if (
    ["select", "dropdown", "enum"].includes(displayType) &&
    preferenceOptions(preference).length
  ) {
    return PREFERENCE_EDITOR_KIND.SELECT
  }

  const value = asText(preference.value).trim()
  if (
    ["json", "object", "textarea", "multiline"].includes(displayType) ||
    value.startsWith("{") ||
    value.startsWith("[")
  ) {
    return PREFERENCE_EDITOR_KIND.MULTILINE
  }
  return PREFERENCE_EDITOR_KIND.TEXT
}

export function preferenceDraftKey(preference: Preference): string {
  return asText(preference.id).trim() || asText(preference.name).trim()
}

export function updatePreferenceDrafts(
  current: Record<string, string>,
  preference: Preference,
  value: string
): Record<string, string> {
  const key = preferenceDraftKey(preference)
  if (value === asText(preference.value)) {
    if (!(key in current)) return current
    const next = { ...current }
    delete next[key]
    return next
  }
  if (current[key] === value) return current
  return { ...current, [key]: value }
}

export function clearSuccessfulPreferenceDrafts(
  current: Record<string, string>,
  successfulKeys: ReadonlySet<string>
): Record<string, string> {
  if (successfulKeys.size === 0) return current
  const next = { ...current }
  for (const key of successfulKeys) delete next[key]
  return next
}

/** Keep the complete server record while replacing only its editable value. */
export function buildPreferenceUpdateBody(
  preference: Preference,
  value: string
): Record<string, unknown> {
  return {
    ...(preference as unknown as Record<string, unknown>),
    id: preference.id,
    value,
  }
}

export function preferencesForApp(
  records: Preference[],
  appDefinitionKey: string
): Preference[] {
  const currentKey = appDefinitionKey.trim()
  if (!currentKey) return []
  return records.filter(
    (preference) => asText(preference.app_definition_key).trim() === currentKey
  )
}

/** Resolve the page bucket for one merged preference record. */
export function preferencePageKey(preference: Preference): string {
  const name = asText(preference.name).trim()
  const segments = name.split(".")
  if (segments[0] === "App" && segments[1] === "Screen" && segments[2]) {
    return segments[2]
  }
  const componentId = asText(preference.component_id).trim().replace(/^\/+/, "")
  if (componentId) return componentId
  if (segments[0] === "Tenant") return TENANT_GROUP
  if (segments[0] === "App") return APPLICATION_GROUP
  return OTHER_GROUP
}

export function preferencePageLabel(key: string): string {
  if (key === APPLICATION_GROUP) return "Application"
  if (key === TENANT_GROUP) return "Tenant"
  if (key === OTHER_GROUP) return "Other"
  return humanize(key)
}

/**
 * Group the effective records page-by-page. Disabled/draft records are not
 * applied. Duplicate names use the final merged value; all-app mode includes
 * the app key in that identity so separate apps never replace each other.
 */
export function groupAppliedPreferences(
  records: Preference[],
  distinguishApps = false
): PreferenceGroup[] {
  const effective = new Map<string, Preference>()
  for (const preference of records) {
    const name = asText(preference?.name).trim()
    if (
      !name ||
      coerceBool(preference.disabled) ||
      coerceBool(preference.draft)
    )
      continue
    const identity = distinguishApps
      ? `${asText(preference.app_definition_key)}\u0000${name}`
      : name
    effective.set(identity, preference)
  }

  const grouped = new Map<string, Preference[]>()
  for (const preference of effective.values()) {
    const key = preferencePageKey(preference)
    const pagePreferences = grouped.get(key) ?? []
    pagePreferences.push(preference)
    grouped.set(key, pagePreferences)
  }

  const rank = (key: string) => {
    if (key === APPLICATION_GROUP) return 0
    if (key === TENANT_GROUP) return 1
    if (key === OTHER_GROUP) return 3
    return 2
  }

  return Array.from(grouped, ([key, preferences]) => ({
    key,
    label: preferencePageLabel(key),
    preferences: preferences.sort((a, b) =>
      asText(a.name).localeCompare(asText(b.name))
    ),
  })).sort(
    (a, b) => rank(a.key) - rank(b.key) || a.label.localeCompare(b.label)
  )
}

export function preferenceDisplayName(preference: Preference): string {
  const name = asText(preference.name)
  const segments = name.split(".")
  return humanize(segments.at(-1) || name)
}

/** Remove the redundant App.Screen.<page>. prefix in current-app mode. */
export function compactPreferenceName(preference: Preference): string {
  const name = asText(preference.name)
  const segments = name.split(".")
  return segments[0] === "App" &&
    segments[1] === "Screen" &&
    segments.length > 3
    ? segments.slice(3).join(".")
    : name
}

export function preferenceComponentLabel(
  preference: Preference
): string | null {
  const segments = asText(preference.name).split(".")
  if (segments[0] === "App" && segments[1] === "Screen" && segments[3]) {
    return humanize(segments[3])
  }
  return null
}

export function preferenceScopeLabel(preference: Preference): string {
  if (hasReference(preference.user)) return "User"
  if (hasReference(preference.org)) return "Organization"
  return "Tenant"
}

export function appliedPreferenceCountLabel(count: number): string {
  return `${count} applied ${count === 1 ? "preference" : "preferences"}`
}
