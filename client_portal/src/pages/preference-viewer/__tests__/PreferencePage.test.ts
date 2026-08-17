import { describe, expect, it } from "vitest"
import type { Preference } from "@/queries/use-preferences"
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
  preferencePageKey,
  preferencePageLabel,
  preferenceScopeLabel,
  preferencesForApp,
  updatePreferenceDrafts,
} from "@/pages/preference-viewer/preference-helpers"

function preference(
  partial: Partial<Preference> & { name: string }
): Preference {
  return {
    id: partial.name,
    app_definition_key: "app-key",
    app_definition: "app",
    value: "",
    category: "Style",
    org: null,
    user: null,
    disabled: false,
    draft: false,
    is_secret: false,
    ...partial,
  }
}

describe(
  "PreferencePage helpers",
  { tags: ["preference-viewer", "logic"] },
  () => {
    describe("page grouping", { tags: ["important"] }, () => {
      it("groups screen records by component id or preference name", () => {
        expect(
          preferencePageKey(
            preference({
              name: "Legacy.Preference",
              component_id: "client-list",
            })
          )
        ).toBe("client-list")
        expect(
          preferencePageKey(
            preference({
              name: "App.Screen.account-overview.datatable-2",
              component_id: "datatable-2",
              type: "table_preference",
            })
          )
        ).toBe("account-overview")
        expect(
          preferencePageKey(preference({ name: "App.Layout.Sidebar" }))
        ).toBe("__application__")
        expect(preferencePageKey(preference({ name: "Tenant.Theme" }))).toBe(
          "__tenant__"
        )
      })

      it("keeps only applied records and lets the final merged value win", () => {
        const groups = groupAppliedPreferences([
          preference({
            name: "App.Screen.clients.card.visible",
            value: "false",
          }),
          preference({
            name: "App.Screen.clients.card.visible",
            value: "true",
          }),
          preference({
            name: "App.Screen.clients.button.label",
            disabled: true,
          }),
          preference({ name: "App.Screen.accounts.card.visible", draft: true }),
        ])

        expect(groups).toHaveLength(1)
        expect(groups[0].key).toBe("clients")
        expect(groups[0].preferences).toHaveLength(1)
        expect(groups[0].preferences[0].value).toBe("true")
      })

      it("orders application and tenant before alphabetized screen pages", () => {
        const groups = groupAppliedPreferences([
          preference({ name: "App.Screen.zebra.card.visible" }),
          preference({ name: "Tenant.Theme" }),
          preference({ name: "App.Layout.Sidebar" }),
          preference({ name: "App.Screen.accounts.card.visible" }),
        ])
        expect(groups.map((group) => group.label)).toEqual([
          "Application",
          "Tenant",
          "Accounts",
          "Zebra",
        ])
      })

      it("filters current-app records by exact app definition key", () => {
        const current = preference({
          name: "App.Screen.employees.table.visible",
          app_definition_key: "employee-app-key",
        })
        const records = [
          current,
          preference({
            name: "App.Screen.accounts.table.visible",
            app_definition_key: "account-app-key",
          }),
          preference({
            name: "Tenant.Theme",
            app_definition_key: "platform",
          }),
        ]

        expect(preferencesForApp(records, "employee-app-key")).toEqual([
          current,
        ])
        expect(preferencesForApp(records, "EMPLOYEE-APP-KEY")).toEqual([])
        expect(preferencesForApp(records, "")).toEqual([])
        expect(
          groupAppliedPreferences(records, true).map((group) => group.label)
        ).toContain("Tenant")
      })

      it("keeps same-named records from different apps in all-app mode", () => {
        const name = "App.Screen.clients.table.visible"
        const groups = groupAppliedPreferences(
          [
            preference({ name, id: "one", app_definition_key: "app-one" }),
            preference({ name, id: "two", app_definition_key: "app-two" }),
          ],
          true
        )

        expect(groups).toHaveLength(1)
        expect(groups[0].preferences.map((record) => record.id)).toEqual([
          "one",
          "two",
        ])
      })
    })

    describe("editors", { tags: ["important"] }, () => {
      it("maps boolean, number, JSON, secret, and plain values to safe controls", () => {
        expect(
          preferenceEditorKind(
            preference({
              name: "App.Screen.clients.card.visible",
              display_type: "select",
            })
          )
        ).toBe(PREFERENCE_EDITOR_KIND.BOOLEAN)
        expect(
          preferenceEditorKind(
            preference({
              name: "App.Screen.clients.table.pageSize",
              display_type: "number",
            })
          )
        ).toBe(PREFERENCE_EDITOR_KIND.NUMBER)
        expect(
          preferenceEditorKind(
            preference({ name: "Tenant.Theme", value: '{"theme":"gold"}' })
          )
        ).toBe(PREFERENCE_EDITOR_KIND.MULTILINE)
        expect(
          preferenceEditorKind(
            preference({
              name: "Tenant.ApiKey",
              value: "token",
              is_secret: true,
            })
          )
        ).toBe(PREFERENCE_EDITOR_KIND.SECRET)
        expect(
          preferenceEditorKind(
            preference({ name: "App.Layout.Label", value: "Clients" })
          )
        ).toBe(PREFERENCE_EDITOR_KIND.TEXT)
      })

      it(
        "uses a select only when the API supplies choices",
        { tags: ["edge-case"] },
        () => {
          const withoutOptions = preference({
            name: "App.Screen.clients.card.variant",
            value: "default",
            display_type: "select",
          })
          const withOptions = Object.assign(
            preference({
              name: "App.Screen.clients.card.variant",
              value: "default",
              display_type: "select",
            }),
            { options: ["secondary", { label: "Tertiary", value: "tertiary" }] }
          )

          expect(preferenceEditorKind(withoutOptions)).toBe(
            PREFERENCE_EDITOR_KIND.TEXT
          )
          expect(preferenceEditorKind(withOptions)).toBe(
            PREFERENCE_EDITOR_KIND.SELECT
          )
          expect(preferenceOptions(withOptions)).toEqual([
            { label: "default", value: "default" },
            { label: "secondary", value: "secondary" },
            { label: "Tertiary", value: "tertiary" },
          ])
        }
      )

      it(
        "parses JSON-encoded option metadata and ignores malformed metadata",
        {
          tags: ["edge-case"],
        },
        () => {
          const encoded = Object.assign(
            preference({
              name: "select",
              value: "List",
              display_type: "select",
            }),
            { display_options: '["List","Grid"]' }
          )
          const malformed = Object.assign(
            preference({
              name: "select",
              value: "List",
              display_type: "select",
            }),
            { display_options: "List,Grid" }
          )

          expect(preferenceOptions(encoded)).toEqual([
            { label: "List", value: "List" },
            { label: "Grid", value: "Grid" },
          ])
          expect(preferenceOptions(malformed)).toEqual([])
        }
      )

      it("builds a full-record update without mutating the source preference", () => {
        const source = preference({
          name: "App.Screen.clients.card.visible",
          id: "pref-1",
          value: "true",
          component_id: "clients",
        })

        expect(buildPreferenceUpdateBody(source, "false")).toMatchObject({
          id: "pref-1",
          name: source.name,
          component_id: "clients",
          value: "false",
        })
        expect(source.value).toBe("true")
        expect(preferenceDraftKey(source)).toBe("pref-1")
        expect(preferenceDraftKey({ ...source, id: "" })).toBe(source.name)

        const changed = updatePreferenceDrafts({}, source, "false")
        expect(changed).toEqual({ "pref-1": "false" })
        expect(updatePreferenceDrafts(changed, source, "true")).toEqual({})

        const partialDrafts = { first: "saved", second: "failed" }
        expect(
          clearSuccessfulPreferenceDrafts(partialDrafts, new Set(["first"]))
        ).toEqual({ second: "failed" })
      })
    })

    describe("labels", { tags: ["smoke"] }, () => {
      const record = preference({
        name: "App.Screen.account-overview.clientCard.backgroundColor",
        org: "org-1",
      })

      it("humanizes page, component, and property labels", () => {
        expect(preferencePageLabel("account-overview")).toBe("Account Overview")
        expect(preferenceDisplayName(record)).toBe("Background Color")
        expect(preferenceComponentLabel(record)).toBe("Client Card")
      })

      it("removes the screen and page prefix from current-app technical names", () => {
        expect(
          compactPreferenceName(
            preference({
              name: "App.Screen.employee-details.EmployeeTable.actions.headerName",
            })
          )
        ).toBe("EmployeeTable.actions.headerName")
        expect(
          compactPreferenceName(preference({ name: "App.Layout.Sidebar" }))
        ).toBe("App.Layout.Sidebar")
        expect(
          compactPreferenceName(preference({ name: "Tenant.Theme" }))
        ).toBe("Tenant.Theme")
      })

      it("describes scope and count with correct singular/plural text", () => {
        expect(preferenceScopeLabel(record)).toBe("Organization")
        expect(
          preferenceScopeLabel(
            preference({
              name: "object-scope",
              org: { id: "org-2" },
            })
          )
        ).toBe("Organization")
        expect(
          preferenceScopeLabel(
            preference({
              name: "user-scope",
              user: { id: "user-1" },
            })
          )
        ).toBe("User")
        expect(appliedPreferenceCountLabel(1)).toBe("1 applied preference")
        expect(appliedPreferenceCountLabel(2)).toBe("2 applied preferences")
      })
    })
  }
)
