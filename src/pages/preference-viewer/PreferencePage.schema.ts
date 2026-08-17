import { buildSchema } from "@/config/customization"

/** Built-in preference viewer schema. The page name `preference` is reserved. */
export const PREFERENCE_VIEWER = buildSchema("preference", {
  title: "text",
  subtitle: "text",
  appFilterLabel: "text",
  currentAppFilterLabel: "text",
  allAppsFilterLabel: "text",
  pageListLabel: "text",
  loadingLabel: "text",
  errorTitle: "text",
  errorDescription: "text",
  retryButton: "button",
  retryButtonLabel: "text",
  emptyTitle: "text",
  emptyDescription: "text",
  currentAppEmptyDescription: "text",
  emptyPageTitle: "text",
  secretValue: "text",
  resetButtonLabel: "text",
  saveButtonLabel: "text",
  saveSuccess: "text",
  partialSaveError: "text",
  saveError: "text",
})
