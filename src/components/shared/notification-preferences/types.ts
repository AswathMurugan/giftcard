/**
 * Notification Preferences — types + user-facing strings.
 *
 * Ported from the platform `@ui-composite/notification_preferences` lib. The
 * starter has no i18n runtime, so the English strings (from the renderer's
 * `notificationPreferences` translation block) are kept inline.
 */

export type CategoryLabelMap = Record<string, string>;

export interface NotificationPreferenceItem {
  alertType: string;
  name: string;
  description: string;
  category: string;
  categoryLabel: string;
  optOutAllowed: boolean;
  optedOut: boolean;
}

export interface PreferenceCategoryGroup {
  key: string;
  label: string;
  items: NotificationPreferenceItem[];
}

export interface NotificationPreferencesProps {
  isOpen: boolean;
  onClose: () => void;
  categoryLabels?: CategoryLabelMap;
}

export const NOTIF_PREFS_TEXT = {
  title: 'Notification Preferences',
  required: 'Required',
  statusActive: 'Active',
  statusOptedOut: 'Opted Out',
  confirmOptOut: (name: string) =>
    `You have opted out of ${name}. You will no longer receive this notification.`,
  confirmReSubscribe: (name: string) => `You are now subscribed to ${name}.`,
  errorToggle: 'Failed to save your preference. Please try again.',
  fetchError: 'Failed to load notification preferences. Please try again.',
  loading: 'Loading preferences',
  empty: 'No notification preferences available.',
  done: 'Done',
};

/** Fallback category label: "account_alerts" → "Account Alerts". */
export function humanizeCategory(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
