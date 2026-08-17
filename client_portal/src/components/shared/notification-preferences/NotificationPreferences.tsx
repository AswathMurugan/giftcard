/**
 * NotificationPreferences — modal listing alert types grouped by category,
 * each with an opt-in/out toggle. Mandatory alerts show a "Required" chip and
 * a locked, on-state toggle. Toggling is optimistic with inline error revert
 * and a transient confirmation toast.
 *
 * Ported from the platform `@ui-composite/notification_preferences` lib onto
 * the starter's shadcn Dialog/Switch/Badge + design tokens.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useAlertCatalogue, useAlertOptOut } from './use-alert-prefs';
import type { AlertCatalogueItem } from './use-alert-prefs';
import {
  NOTIF_PREFS_TEXT as T,
  humanizeCategory,
} from './types';
import type {
  CategoryLabelMap,
  NotificationPreferencesProps,
  PreferenceCategoryGroup,
} from './types';

const TOAST_DURATION_MS = 4000;

/** Group flat catalogue items by category, resolving each group's label. */
export function buildCategoryGroups(
  items: AlertCatalogueItem[],
  categoryLabels: CategoryLabelMap,
): PreferenceCategoryGroup[] {
  const map = new Map<string, AlertCatalogueItem[]>();
  for (const item of items) {
    const existing = map.get(item.category);
    if (existing) existing.push(item);
    else map.set(item.category, [item]);
  }
  return Array.from(map.entries()).map(([key, groupItems]) => {
    const label = categoryLabels[key] ?? humanizeCategory(key);
    return {
      key,
      label,
      items: groupItems.map((item) => ({
        alertType: item.alert_type,
        name: item.name,
        description: item.description,
        category: item.category,
        categoryLabel: label,
        optOutAllowed: item.opt_out_allowed,
        optedOut: item.opted_out,
      })),
    };
  });
}

export function NotificationPreferences({
  isOpen,
  onClose,
  categoryLabels = {},
}: NotificationPreferencesProps) {
  const { items, isLoading, error } = useAlertCatalogue(isOpen);
  const { optOut } = useAlertOptOut();

  const [optimisticStates, setOptimisticStates] = useState<
    Record<string, boolean>
  >({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<{ message: string } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isOpen) {
      setOptimisticStates({});
      setRowErrors({});
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const showToast = useCallback((message: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message });
    toastTimerRef.current = setTimeout(() => setToast(null), TOAST_DURATION_MS);
  }, []);

  const categoryGroups = useMemo(
    () => buildCategoryGroups(items, categoryLabels),
    [items, categoryLabels],
  );

  const handleToggleChange = useCallback(
    (alertType: string, itemName: string) => async (checked: boolean) => {
      // `checked` = subscribed; optedOut is the inverse.
      setOptimisticStates((prev) => ({ ...prev, [alertType]: !checked }));
      setRowErrors((prev) => {
        const next = { ...prev };
        delete next[alertType];
        return next;
      });
      try {
        await optOut({ alertType, optedOut: !checked });
        showToast(
          checked
            ? T.confirmReSubscribe(itemName)
            : T.confirmOptOut(itemName),
        );
      } catch {
        setOptimisticStates((prev) => ({ ...prev, [alertType]: checked }));
        setRowErrors((prev) => ({ ...prev, [alertType]: T.errorToggle }));
      }
    },
    [optOut, showToast],
  );

  const resolveOptedOut = useCallback(
    (alertType: string, baseOptedOut: boolean): boolean =>
      alertType in optimisticStates ? optimisticStates[alertType] : baseOptedOut,
    [optimisticStates],
  );

  function renderBody() {
    if (isLoading) {
      return (
        <div className="flex flex-col gap-3" aria-label={T.loading} aria-busy>
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
            >
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56" />
              </div>
              <Skeleton className="h-5 w-10 rounded-full" />
            </div>
          ))}
        </div>
      );
    }
    if (error) {
      return (
        <p className="py-8 text-center text-sm text-muted-foreground" role="status">
          {T.fetchError}
        </p>
      );
    }
    if (categoryGroups.length === 0) {
      return (
        <p className="py-8 text-center text-sm text-muted-foreground" role="status">
          {T.empty}
        </p>
      );
    }
    return (
      <div className="flex flex-col gap-6">
        {categoryGroups.map((group) => (
          <div key={group.key} className="flex flex-col gap-2">
            <span className="text-sm font-semibold text-muted-foreground">
              {group.label}
            </span>
            <div className="flex flex-col gap-2">
              {group.items.map((item) => {
                const optedOut = resolveOptedOut(item.alertType, item.optedOut);
                const rowError = rowErrors[item.alertType];
                return (
                  <div
                    key={item.alertType}
                    className="flex flex-col gap-1 rounded-lg border border-border p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate font-semibold text-foreground">
                          {item.name}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {item.description}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {!item.optOutAllowed && (
                          <Badge variant="secondary">
                            <i
                              className="icon icon_-Tb_lock text-[0.875rem]"
                              aria-hidden="true"
                            />
                            {T.required}
                          </Badge>
                        )}
                        {item.optOutAllowed ? (
                          <>
                            <span
                              className={cn(
                                'text-sm',
                                optedOut
                                  ? 'text-muted-foreground'
                                  : 'text-success',
                              )}
                            >
                              {optedOut ? T.statusOptedOut : T.statusActive}
                            </span>
                            <Switch
                              aria-label={item.name}
                              checked={!optedOut}
                              onCheckedChange={handleToggleChange(
                                item.alertType,
                                item.name,
                              )}
                            />
                          </>
                        ) : (
                          <Switch
                            aria-label={item.name}
                            checked
                            disabled
                          />
                        )}
                      </div>
                    </div>
                    {rowError && (
                      <span className="text-sm text-destructive" role="alert">
                        {rowError}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-border p-6 pb-4">
          <DialogTitle>{T.title}</DialogTitle>
        </DialogHeader>
        <div className="relative flex flex-col gap-4 overflow-y-auto p-6">
          {renderBody()}
          {toast && (
            <div
              className="sticky bottom-0 rounded-md border border-success-200 bg-success-50 px-3 py-2 text-sm text-success"
              role="status"
              aria-live="polite"
            >
              {toast.message}
            </div>
          )}
        </div>
        <DialogFooter className="mx-0 mb-0">
          <Button onClick={onClose}>{T.done}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default NotificationPreferences;
