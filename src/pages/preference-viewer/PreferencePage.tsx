import {
  useCallback,
  useMemo,
  useState,
  type ChangeEvent,
  type MouseEvent,
} from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
} from "@/components/ui/item"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { getAppConfig, getDataHeaders } from "@/config/api-config"
import { getApplications } from "@/config/applications"
import { usePageText } from "@/config/customization"
import { asText, coerceBool } from "@/lib/runtime"
import {
  PLATFORM_APP_LENS,
  usePreferences,
  type Preference,
} from "@/queries/use-preferences"
import { apiManager } from "@/services/api-manager"
import { APPLICATION } from "@/types/app.generated"
import {
  appliedPreferenceCountLabel,
  buildPreferenceUpdateBody,
  clearSuccessfulPreferenceDrafts,
  compactPreferenceName,
  groupAppliedPreferences,
  PREFERENCE_EDITOR_KIND,
  preferenceComponentLabel,
  preferenceDraftKey,
  preferenceDisplayName,
  preferenceEditorKind,
  preferenceOptions,
  preferenceScopeLabel,
  preferencesForApp,
  updatePreferenceDrafts,
} from "./preference-helpers"
import { PREFERENCE_VIEWER } from "./PreferencePage.schema"

function testIdPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

function preferenceFieldId(preference: Preference): string {
  const identity = `${asText(preference.app_definition_key)}-${asText(preference.name)}`
  return `preference-input-${testIdPart(identity) || "value"}`
}

function preferenceAppLabel(preference: Preference): string {
  const appKey = asText(preference.app_definition_key).trim()
  if (isPlatformPreference(preference)) return PLATFORM_APP_LENS
  const app = getApplications().find(
    (candidate) => candidate.app_definition_key === appKey
  )
  return app?.label || app?.name || appKey
}

function isPlatformPreference(preference: Preference): boolean {
  return asText(preference.app_definition_key)
    .trim()
    .toLowerCase()
    .startsWith("platform")
}

function preferenceHeaders(preference: Preference): Record<string, string> {
  const config = getAppConfig()
  const appKey = asText(preference.app_definition_key).trim()
  const headers = getDataHeaders(appKey || undefined)
  if (isPlatformPreference(preference)) {
    headers["X-Jiffy-App-Name"] = PLATFORM_APP_LENS
  }
  headers["X-Jiffy-Tenant"] = config.tenant
  return headers
}

interface PreferenceEditorProps {
  disabled: boolean
  preference: Preference
  secretLabel: string
  value: string
  onValueChange: (preference: Preference, value: string) => void
}

type PreferenceAppFilter = "current" | "all"

function PreferenceEditor({
  disabled,
  preference,
  secretLabel,
  value,
  onValueChange,
}: PreferenceEditorProps) {
  const name = asText(preference.name)
  const fieldId = preferenceFieldId(preference)
  const editor = preferenceEditorKind(preference)
  const options = preferenceOptions(preference)

  const handleInputChange = (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    onValueChange(preference, event.target.value)
  }
  const handleSelectChange = (event: ChangeEvent<HTMLSelectElement>) => {
    onValueChange(preference, event.target.value)
  }
  const handleCheckedChange = (checked: boolean) => {
    onValueChange(preference, String(checked))
  }

  switch (editor) {
    case PREFERENCE_EDITOR_KIND.SECRET:
      return (
        <Input
          id={fieldId}
          name={name}
          type="password"
          value=""
          placeholder={secretLabel}
          data-testid={fieldId}
          disabled
        />
      )
    case PREFERENCE_EDITOR_KIND.BOOLEAN:
      return (
        <Switch
          id={fieldId}
          name={name}
          checked={coerceBool(value)}
          onCheckedChange={handleCheckedChange}
          aria-label={preferenceDisplayName(preference)}
          data-testid={fieldId}
          disabled={disabled}
        />
      )
    case PREFERENCE_EDITOR_KIND.SELECT:
      return (
        <NativeSelect
          id={fieldId}
          name={name}
          value={value}
          onChange={handleSelectChange}
          data-testid={fieldId}
          disabled={disabled}
        >
          {options.map((option) => (
            <NativeSelectOption key={option.value} value={option.value}>
              {option.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      )
    case PREFERENCE_EDITOR_KIND.MULTILINE:
      return (
        <Textarea
          id={fieldId}
          name={name}
          value={value}
          onChange={handleInputChange}
          data-testid={fieldId}
          disabled={disabled}
          className="min-h-[7.5rem] font-mono text-[0.8125rem] font-normal"
        />
      )
    case PREFERENCE_EDITOR_KIND.NUMBER:
    case PREFERENCE_EDITOR_KIND.TEXT:
      return (
        <Input
          id={fieldId}
          name={name}
          type={editor}
          value={value}
          onChange={handleInputChange}
          data-testid={fieldId}
          disabled={disabled}
        />
      )
  }
}

function PreferencePageSkeleton({ label }: { label: string }) {
  return (
    <div
      aria-label={label}
      aria-busy="true"
      className="-mx-6 grid md:grid-cols-[18rem_minmax(0,1fr)] xl:grid-cols-[25rem_minmax(0,1fr)]"
    >
      <div className="flex flex-col gap-2 px-3 py-4">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-11 w-full" />
        ))}
      </div>
      <div className="grid gap-x-10 px-6 py-5 lg:grid-cols-2">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="border-b border-border py-4">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="mt-2 h-4 w-full" />
            <Skeleton className="mt-3 h-16 w-full" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function PreferencePage() {
  const t = usePageText(PREFERENCE_VIEWER)
  const currentPreferences = usePreferences()
  const config = getAppConfig()
  const currentAppKey =
    asText(APPLICATION?.app_definition_key).trim() || config.appDefinitionKey
  const [appFilter, setAppFilter] = useState<PreferenceAppFilter>("current")
  const filteredPreferences = useMemo(
    () =>
      appFilter === "current"
        ? preferencesForApp(currentPreferences.data ?? [], currentAppKey)
        : (currentPreferences.data ?? []),
    [appFilter, currentAppKey, currentPreferences.data]
  )
  const groups = useMemo(
    () => groupAppliedPreferences(filteredPreferences, appFilter === "all"),
    [appFilter, filteredPreferences]
  )
  const [selectedKey, setSelectedKey] = useState("")
  const [draftValues, setDraftValues] = useState<Record<string, string>>({})
  const [isSaving, setIsSaving] = useState(false)
  const activeGroup =
    groups.find((group) => group.key === selectedKey) ?? groups[0]
  const dirtyCount = Object.keys(draftValues).length
  const allAppsDataIsIncomplete =
    appFilter === "all" && currentPreferences.tenantPreferencesError
  const preferencesByKey = useMemo(
    () =>
      new Map(
        (currentPreferences.data ?? []).map((preference) => [
          preferenceDraftKey(preference),
          preference,
        ])
      ),
    [currentPreferences.data]
  )

  const handleSelectPage = (event: MouseEvent<HTMLButtonElement>) => {
    setSelectedKey(event.currentTarget.value)
  }
  const handleRetry = () => {
    void currentPreferences.refetch()
  }
  const handleAppFilterChange = (value: string) => {
    if (value === "current" || value === "all") setAppFilter(value)
  }
  const handleValueChange = useCallback(
    (preference: Preference, value: string) => {
      setDraftValues((current) =>
        updatePreferenceDrafts(current, preference, value)
      )
    },
    []
  )
  const handleReset = () => {
    setDraftValues({})
  }
  const handleSave = async () => {
    const updates = Object.entries(draftValues)
    if (updates.length === 0 || currentPreferences.isPlaceholderData) return

    setIsSaving(true)
    try {
      const results = await Promise.allSettled(
        updates.map(async ([key, value]) => {
          const preference = preferencesByKey.get(key)
          if (!preference?.id)
            throw new Error(`Preference ${key} cannot be updated`)
          await apiManager.put(
            "proxy",
            `/api/preferences/${encodeURIComponent(preference.id)}`,
            buildPreferenceUpdateBody(preference, value),
            preferenceHeaders(preference)
          )
        })
      )
      const successfulKeys = new Set(
        results.flatMap((result, index) =>
          result.status === "fulfilled" ? [updates[index][0]] : []
        )
      )
      const requiresTenantRefresh = [...successfulKeys].some((key) => {
        const preference = preferencesByKey.get(key)
        return preference ? isPlatformPreference(preference) : false
      })
      const refreshed = await currentPreferences.refetch()
      const refreshSucceeded =
        !refreshed.error &&
        (!requiresTenantRefresh || !refreshed.data?.tenantPreferencesError)

      if (refreshSucceeded) {
        setDraftValues((current) =>
          clearSuccessfulPreferenceDrafts(current, successfulKeys)
        )
      }

      const failedCount = results.length - successfulKeys.size
      if (failedCount === 0 && refreshSucceeded) {
        toast.success(t("saveSuccess", "Preference changes saved"), {
          testId: "toast-save-preferences",
        })
      } else if (successfulKeys.size > 0 && refreshSucceeded) {
        toast.error(
          t("partialSaveError", "Some preference changes could not be saved"),
          { testId: "toast-save-preferences-error" }
        )
      } else {
        toast.error(t("saveError", "Could not save preference changes"), {
          testId: "toast-save-preferences-error",
        })
      }
    } catch {
      toast.error(t("saveError", "Could not save preference changes"), {
        testId: "toast-save-preferences-error",
      })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="sticky top-0 z-20 -mx-6 -mt-3 shrink-0 bg-secondary px-6 py-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-[1.25rem] leading-tight font-medium text-foreground">
              {t("title", "Configure Preferences")}
            </h1>
            <p className="mt-2 text-[1rem] leading-normal text-grayscale-600">
              {t(
                "subtitle",
                "View and edit preferences for each screen in the app. Select a screen on the left to review and update its preferences."
              )}
            </p>
          </div>
          <div data-testid="preference-app-filter">
            <SegmentedControl
              id="preference-app-filter-control"
              value={appFilter}
              options={[
                {
                  value: "current",
                  label: t("currentAppFilterLabel", "Current App"),
                },
                {
                  value: "all",
                  label: t("allAppsFilterLabel", "All Apps"),
                },
              ]}
              onValueChange={handleAppFilterChange}
              size="sm"
              aria-label={t("appFilterLabel", "Preference app filter")}
            />
          </div>
        </div>
      </header>

      {currentPreferences.isLoading ? (
        <PreferencePageSkeleton
          label={t("loadingLabel", "Loading applied preferences")}
        />
      ) : currentPreferences.isError || allAppsDataIsIncomplete ? (
        <div className="py-6">
          <Alert variant="destructive">
            <AlertTitle>
              {t("errorTitle", "Could not load preferences")}
            </AlertTitle>
            <AlertDescription>
              {t(
                "errorDescription",
                "Refresh the applied preferences and try again."
              )}
            </AlertDescription>
          </Alert>
          <Button
            config={PREFERENCE_VIEWER.retryButton}
            data-testid="retry-preferences"
            className="mt-4"
            onClick={handleRetry}
          >
            {t("retryButtonLabel", "Retry")}
          </Button>
        </div>
      ) : groups.length === 0 ? (
        <Empty data-testid="preference-empty-state" className="min-h-[24rem]">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <i
                className="icon icon_-Tb_adjustments_horizontal text-[1.25rem]"
                aria-hidden="true"
              />
            </EmptyMedia>
            <EmptyTitle>{t("emptyTitle", "No applied preferences")}</EmptyTitle>
            <EmptyDescription>
              {t(
                appFilter === "current"
                  ? "currentAppEmptyDescription"
                  : "emptyDescription",
                appFilter === "current"
                  ? "The current app is using its built-in defaults."
                  : "No applied preferences are available."
              )}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <div className="-mx-6 grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden md:grid-cols-[18rem_minmax(0,1fr)] md:grid-rows-1 xl:grid-cols-[25rem_minmax(0,1fr)]">
            <nav
              aria-label={t("pageListLabel", "Preference pages")}
              className="z-10 bg-background px-3 py-4 md:h-full md:overflow-y-auto"
            >
              <div className="flex gap-2 overflow-x-auto md:flex-col md:overflow-visible">
                {groups.map((group) => {
                  const active = group.key === activeGroup?.key
                  return (
                    <Button
                      key={group.key}
                      type="button"
                      variant="ghost"
                      value={group.key}
                      data-testid={`preference-page-${testIdPart(group.key)}`}
                      aria-pressed={active}
                      onClick={handleSelectPage}
                      className={`h-11 min-w-fit justify-between gap-4 px-3 text-[1rem] font-normal text-foreground md:w-full ${
                        active
                          ? "bg-primary-50 font-semibold hover:bg-primary-50 hover:text-foreground"
                          : "hover:bg-secondary hover:text-foreground"
                      }`}
                    >
                      <span className="truncate">{group.label}</span>
                      <Badge variant="outline">
                        {group.preferences.length}
                      </Badge>
                    </Button>
                  )
                })}
              </div>
            </nav>

            <section className="min-h-0 min-w-0 overflow-y-auto bg-background px-6 py-5">
              {activeGroup ? (
                <>
                  <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="text-[1.125rem] font-semibold text-foreground">
                      {activeGroup.label}
                    </h2>
                    <span className="text-sm text-muted-foreground">
                      {appliedPreferenceCountLabel(
                        activeGroup.preferences.length
                      )}
                    </span>
                  </div>
                  <ItemGroup className="grid gap-x-10 gap-y-0 lg:grid-cols-2">
                    {activeGroup.preferences.map((preference) => {
                      const name = asText(preference.name)
                      const key = preferenceDraftKey(preference)
                      const component = preferenceComponentLabel(preference)
                      const fieldId = preferenceFieldId(preference)
                      const rowIdentity =
                        appFilter === "all"
                          ? `${asText(preference.app_definition_key)}-${name}`
                          : name
                      return (
                        <Item
                          key={key}
                          role="listitem"
                          data-row-key={rowIdentity}
                          data-testid={`preference-row-${testIdPart(rowIdentity)}`}
                          className="flex-col items-stretch gap-3 rounded-none border-x-0 border-t-0 border-b border-border px-0 py-4"
                        >
                          <ItemContent>
                            <Label
                              htmlFor={fieldId}
                              className="line-clamp-none text-[1rem] font-medium break-all"
                            >
                              {preferenceDisplayName(preference)}
                            </Label>
                            <ItemDescription className="line-clamp-none font-mono text-[0.8125rem] break-all">
                              {appFilter === "current"
                                ? compactPreferenceName(preference)
                                : name}
                            </ItemDescription>
                            {preference.description && (
                              <p className="text-sm leading-normal text-muted-foreground">
                                {preference.description}
                              </p>
                            )}
                          </ItemContent>
                          <div className="flex flex-wrap gap-2">
                            {appFilter === "all" && (
                              <Badge variant="secondary">
                                {preferenceAppLabel(preference)}
                              </Badge>
                            )}
                            {component && (
                              <Badge variant="secondary">{component}</Badge>
                            )}
                            {preference.category && (
                              <Badge variant="secondary">
                                {preference.category}
                              </Badge>
                            )}
                            <Badge variant="outline">
                              {preferenceScopeLabel(preference)}
                            </Badge>
                          </div>
                          <PreferenceEditor
                            preference={preference}
                            value={draftValues[key] ?? asText(preference.value)}
                            secretLabel={t("secretValue", "Hidden value")}
                            disabled={
                              isSaving ||
                              currentPreferences.isPlaceholderData ||
                              !asText(preference.id)
                            }
                            onValueChange={handleValueChange}
                          />
                        </Item>
                      )
                    })}
                  </ItemGroup>
                </>
              ) : (
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>
                      {t("emptyPageTitle", "Select a preference page")}
                    </EmptyTitle>
                  </EmptyHeader>
                </Empty>
              )}
            </section>
          </div>
          <footer className="-mx-6 -mb-6 flex h-[4.75rem] shrink-0 items-center justify-end gap-3 border-t border-border bg-background px-6 py-2">
            <Button
              type="button"
              variant="ghost"
              data-testid="reset-preference-changes"
              disabled={dirtyCount === 0 || isSaving}
              onClick={handleReset}
            >
              <i
                className="icon icon_-Tb_arrow_back_up text-[1.25rem]"
                aria-hidden="true"
              />
              {t("resetButtonLabel", "Reset")}
            </Button>
            <Button
              type="button"
              data-testid="save-preference-changes"
              aria-busy={isSaving}
              disabled={
                dirtyCount === 0 ||
                isSaving ||
                currentPreferences.isPlaceholderData
              }
              onClick={handleSave}
            >
              <i
                className="icon icon_-Tb_device_floppy text-[1.25rem]"
                aria-hidden="true"
              />
              {t("saveButtonLabel", "Save Changes")}
            </Button>
          </footer>
        </>
      )}
    </div>
  )
}

export default PreferencePage
