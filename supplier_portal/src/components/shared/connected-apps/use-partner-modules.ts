import { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchPartnerModulesWithConfigs,
  groupPartnersIntoCategories,
} from '@/services/partner-modules-api';
import type { ConnectedAppsCategory } from './types';

export interface UsePartnerModulesResult {
  categories: ConnectedAppsCategory[];
  isLoading: boolean;
  setCategories: React.Dispatch<React.SetStateAction<ConnectedAppsCategory[]>>;
  refetch: () => Promise<void>;
}

export function usePartnerModules(enabled: boolean): UsePartnerModulesResult {
  const [categories, setCategories] = useState<ConnectedAppsCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const refetch = useCallback(async (): Promise<void> => {
    try {
      const items = await fetchPartnerModulesWithConfigs();
      if (isMountedRef.current) {
        setCategories(groupPartnersIntoCategories(items));
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    setIsLoading(true);
    refetch();
  }, [enabled, refetch]);

  return { categories, isLoading, setCategories, refetch };
}
