/**
 * Notification Preferences data access. Ported from the platform lib's
 * `use-alert-catalogue` + `use-alert-optout` hooks, rewritten onto the
 * starter's apiManager (no react-query dependency).
 *
 * Service (configured in src/config/api-config.ts): `events` → `/events`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiManager } from '@/services/api-manager';

const EVENTS_SERVICE_KEY = 'events';
const ALERT_PREFS_CATALOGUE_ENDPOINT = '/alert-prefs/catalogue';
const PLATFORM_APP_DEFINITION_KEY = 'platform';

export interface AlertCatalogueItem {
  alert_type: string;
  name: string;
  description: string;
  category: string;
  opt_out_allowed: boolean;
  opted_out: boolean;
}

export interface UseAlertCatalogueReturn {
  items: AlertCatalogueItem[];
  isLoading: boolean;
  error: Error | null;
}

/** Fetch the alert catalogue when `enabled` (the dialog is open). */
export function useAlertCatalogue(enabled: boolean): UseAlertCatalogueReturn {
  const [items, setItems] = useState<AlertCatalogueItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setIsLoading(true);
    setError(null);
    (async () => {
      try {
        const response = await apiManager.get(
          EVENTS_SERVICE_KEY,
          ALERT_PREFS_CATALOGUE_ENDPOINT,
          {},
          { params: { app_definition_key: PLATFORM_APP_DEFINITION_KEY } },
        );
        if (!active) return;
        const data = response.data;
        setItems(Array.isArray(data) ? data : (data?.data ?? []));
      } catch (err) {
        if (active) setError(err as Error);
      } finally {
        if (active) setIsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [enabled]);

  return { items, isLoading, error };
}

export interface OptOutParams {
  alertType: string;
  optedOut: boolean;
}

export interface UseAlertOptOutReturn {
  optOut: (params: OptOutParams) => Promise<void>;
}

/** PUT the opt-out state for a single alert type. */
export function useAlertOptOut(): UseAlertOptOutReturn {
  const optOut = useCallback(
    async ({ alertType, optedOut }: OptOutParams): Promise<void> => {
      await apiManager.put(
        EVENTS_SERVICE_KEY,
        `/alert-prefs/${encodeURIComponent(alertType)}/optout`,
        { opted_out: optedOut },
      );
    },
    [],
  );

  return { optOut };
}
