/**
 * ConnectedApps — modal for managing third-party app integrations. Partners
 * are grouped by category; each partner shows its connected accounts and an
 * "Add" action that runs the OAuth popup flow.
 *
 * Ported from the platform `@ui-composite/connected_apps` lib onto the
 * starter's shadcn Dialog + design tokens.
 */
import { useState, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AccountItem } from './AccountItem';
import { usePartnerModules } from './use-partner-modules';
import { usePartnerAdd } from './use-partner-add';
import {
  deleteAccountPreferences,
  getPartnerInitials,
  savePreferences,
  setDefaultConfig,
} from '@/services/partner-modules-api';
import { CONNECTED_APPS_TEXT as T } from './types';
import type {
  ConnectedAppsProps,
  ConnectedPartner,
  ConnectedAccount,
} from './types';

function PartnerRow({
  partner,
  onAdd,
  onDelete,
  onUpdate,
  onSetDefault,
}: {
  partner: ConnectedPartner;
  onAdd: (partner: ConnectedPartner) => void;
  onDelete: (a: ConnectedAccount, p: ConnectedPartner) => Promise<void>;
  onUpdate: (
    a: ConnectedAccount,
    p: ConnectedPartner,
    u: { name?: string; description?: string },
  ) => void;
  onSetDefault: (a: ConnectedAccount, p: ConnectedPartner) => void;
}) {
  const connectedCount = partner.accounts.filter(
    (a) => a.status === 'connected',
  ).length;
  const totalCount = partner.accounts.length;
  const hasAccounts = totalCount > 0;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex items-center gap-3">
        {partner.iconSrc ? (
          <img
            src={partner.iconSrc}
            alt={partner.name}
            className="size-10 shrink-0 rounded-md object-cover"
          />
        ) : (
          <span
            className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground"
            aria-hidden="true"
          >
            {getPartnerInitials(partner.name)}
          </span>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-semibold text-foreground">
            {partner.name}
          </span>
          {hasAccounts ? (
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <span
                className="size-1.5 rounded-full bg-success"
                aria-hidden="true"
              />
              {T.connectedBadge(connectedCount, totalCount)}
            </span>
          ) : (
            <span className="truncate text-sm text-muted-foreground">
              {partner.description}
            </span>
          )}
        </div>

        <Button
          variant="secondary"
          size="sm"
          aria-label={`${T.addButton} ${partner.name}`}
          onClick={() => onAdd(partner)}
        >
          {T.addButton}
        </Button>
      </div>

      {hasAccounts && (
        <div className="flex flex-col gap-2 pl-12">
          {partner.accounts.map((account) => (
            <AccountItem
              key={account.id}
              account={account}
              partner={partner}
              onDelete={onDelete}
              onUpdate={onUpdate}
              onSetDefault={onSetDefault}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function ConnectedApps({ isOpen, onClose, onSave }: ConnectedAppsProps) {
  const { categories, isLoading, setCategories, refetch } =
    usePartnerModules(isOpen);
  const [deletedAccountIds, setDeletedAccountIds] = useState<Set<string>>(
    new Set(),
  );

  const handlePendingAccount = useCallback(
    (partner: ConnectedPartner, account: ConnectedAccount) => {
      setCategories((prev) =>
        prev.map((cat) => ({
          ...cat,
          partners: cat.partners.map((p) =>
            p.id === partner.id
              ? { ...p, accounts: [...p.accounts, account] }
              : p,
          ),
        })),
      );
    },
    [setCategories],
  );

  const { handleAdd } = usePartnerAdd({
    onRefresh: refetch,
    onPendingAccount: handlePendingAccount,
  });

  const handleDelete = useCallback(
    async (account: ConnectedAccount, partner: ConnectedPartner) => {
      await deleteAccountPreferences(partner.id, account.id);
      setCategories((prev) =>
        prev.map((cat) => ({
          ...cat,
          partners: cat.partners.map((p) => ({
            ...p,
            accounts: p.accounts.filter((a) => a.id !== account.id),
          })),
        })),
      );
      setDeletedAccountIds((prev) => new Set(prev).add(account.id));
    },
    [setCategories],
  );

  const handleUpdate = useCallback(
    (
      account: ConnectedAccount,
      partner: ConnectedPartner,
      updates: { name?: string; description?: string },
    ) => {
      setCategories((prev) =>
        prev.map((cat) => ({
          ...cat,
          partners: cat.partners.map((p) => ({
            ...p,
            accounts: p.accounts.map((a) =>
              a.id === account.id ? { ...a, ...updates } : a,
            ),
          })),
        })),
      );

      const prefs: { name: string; value: string; description: string }[] = [];
      const prefName = (attr: string) => `${partner.id}:${account.id}:${attr}`;
      if (updates.name) {
        prefs.push({
          name: prefName('displayLabel'),
          value: updates.name,
          description: `Display label for ${partner.name}`,
        });
      }
      if (updates.description) {
        prefs.push({
          name: prefName('description'),
          value: updates.description,
          description: `Description for ${partner.name}`,
        });
      }
      if (prefs.length > 0) {
        savePreferences(
          prefs,
          partner.app_definition,
          partner.app_definition_key,
        ).catch(() => {});
      }
    },
    [setCategories],
  );

  const handleSetDefault = useCallback(
    (account: ConnectedAccount, partner: ConnectedPartner) => {
      setDefaultConfig(partner.id, account.id).catch(() => {});
    },
    [],
  );

  const handleSave = useCallback(() => {
    onSave?.({ deletedAccountIds: [...deletedAccountIds] });
    onClose();
  }, [onSave, onClose, deletedAccountIds]);

  function renderBody() {
    if (isLoading) {
      return (
        <div className="flex flex-col gap-3" aria-label="Loading integrations">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-lg border border-border p-3"
            >
              <Skeleton className="size-10 rounded-md" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-48" />
              </div>
              <Skeleton className="h-8 w-16" />
            </div>
          ))}
        </div>
      );
    }
    if (categories.length === 0) {
      return (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {T.empty}
        </p>
      );
    }
    return categories.map((category) => (
      <div key={category.id} className="flex flex-col gap-2">
        {category.name && (
          <span className="text-sm font-semibold text-muted-foreground">
            {category.name}
          </span>
        )}
        {category.partners.map((partner) => (
          <PartnerRow
            key={partner.id}
            partner={partner}
            onAdd={handleAdd}
            onDelete={handleDelete}
            onUpdate={handleUpdate}
            onSetDefault={handleSetDefault}
          />
        ))}
      </div>
    ));
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-border p-6 pb-4">
          <DialogTitle>{T.title}</DialogTitle>
          <DialogDescription>{T.subtitle}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 overflow-y-auto p-6">
          {renderBody()}
        </div>
        <DialogFooter className="mx-0 mb-0">
          <Button variant="outline" onClick={onClose}>
            {T.cancel}
          </Button>
          <Button onClick={handleSave}>{T.save}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ConnectedApps;
