import { useState, useCallback, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CONNECTED_APPS_TEXT } from './types';
import type { ConnectedAccount, ConnectedPartner } from './types';

export interface AccountItemProps {
  readonly account: ConnectedAccount;
  readonly partner: ConnectedPartner;
  readonly onDelete: (
    account: ConnectedAccount,
    partner: ConnectedPartner,
  ) => Promise<void>;
  readonly onUpdate: (
    account: ConnectedAccount,
    partner: ConnectedPartner,
    updates: { name?: string; description?: string },
  ) => void;
  readonly onSetDefault: (
    account: ConnectedAccount,
    partner: ConnectedPartner,
  ) => void;
}

export function AccountItem({
  account,
  partner,
  onDelete,
  onUpdate,
  onSetDefault,
}: AccountItemProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [editingField, setEditingField] = useState<'name' | 'description' | null>(
    null,
  );
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const isSaving = account.status === 'saving';
  const showKebab =
    account.status === 'connected' || account.status === 'error';

  useEffect(() => {
    if (
      (account.isNameProviderManaged && editingField === 'name') ||
      (account.isDescriptionProviderManaged && editingField === 'description')
    ) {
      setEditingField(null);
    }
  }, [
    account.isNameProviderManaged,
    account.isDescriptionProviderManaged,
    editingField,
  ]);

  const handleDelete = useCallback(async () => {
    setIsDeleting(true);
    try {
      await onDelete(account, partner);
    } catch {
      setIsDeleting(false);
    }
  }, [account, partner, onDelete]);

  const handleSetDefault = useCallback(() => {
    onSetDefault(account, partner);
  }, [account, partner, onSetDefault]);

  const handleStartEdit = useCallback(
    (field: 'name' | 'description') => {
      const current =
        field === 'name' ? account.name : (account.description ?? '');
      setEditingField(field);
      setEditValue(current);
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    [account.name, account.description],
  );

  const handleEditBlur = useCallback(() => {
    if (!editingField) return;
    const trimmed = editValue.trim();
    const original =
      editingField === 'name' ? account.name : (account.description ?? '');
    if (trimmed && trimmed !== original) {
      onUpdate(account, partner, { [editingField]: trimmed });
    }
    setEditingField(null);
  }, [editingField, editValue, account, partner, onUpdate]);

  const handleEditKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        inputRef.current?.blur();
      } else if (e.key === 'Escape') {
        setEditingField(null);
      }
    },
    [],
  );

  const spinner = (label: string) => (
    <i
      className="icon icon_-Tb_loader_2 animate-spin text-[1.125rem] text-muted-foreground"
      aria-label={label}
    />
  );

  if (isSaving) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2">
        <span className="truncate text-sm font-semibold text-foreground">
          {account.name}
        </span>
        {spinner(CONNECTED_APPS_TEXT.savingAccount)}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        {/* Name */}
        {account.isNameProviderManaged ? (
          <span className="truncate text-sm font-semibold text-foreground">
            {account.name}
          </span>
        ) : editingField === 'name' ? (
          <Input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleEditBlur}
            onKeyDown={handleEditKeyDown}
            className="h-7 py-1 text-sm"
          />
        ) : (
          <span
            className="cursor-text truncate rounded px-1 text-sm font-semibold text-foreground hover:bg-muted"
            onClick={() => handleStartEdit('name')}
            role="button"
            tabIndex={0}
          >
            {account.name}
          </span>
        )}

        {/* Description */}
        {account.isDescriptionProviderManaged ? (
          <span className="truncate text-xs text-muted-foreground">
            {account.description}
          </span>
        ) : editingField === 'description' ? (
          <Input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleEditBlur}
            onKeyDown={handleEditKeyDown}
            className="h-7 py-1 text-sm"
          />
        ) : (
          <span
            className="cursor-text truncate rounded px-1 text-xs text-muted-foreground hover:bg-muted"
            onClick={() => handleStartEdit('description')}
            role="button"
            tabIndex={0}
          >
            {account.description || CONNECTED_APPS_TEXT.addDescription}
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {isDeleting && spinner(CONNECTED_APPS_TEXT.deletingAccount)}

        {!isDeleting && account.status === 'error' && (
          <i
            className="icon icon_-Tb_alert_circle text-[1.25rem] text-destructive"
            aria-hidden="true"
          />
        )}

        {!isDeleting && account.status === 'pending' && (
          <span
            className="inline-flex p-1"
            aria-label={CONNECTED_APPS_TEXT.pendingConnection}
          >
            <i className="icon icon_-Tb_link text-[1.25rem] text-muted-foreground" aria-hidden="true" />
          </span>
        )}

        {!isDeleting && showKebab && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={CONNECTED_APPS_TEXT.accountActions}
              >
                <i className="icon icon_-Tb_dots_vertical text-[1.25rem]" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onSelect={handleSetDefault} className="gap-2">
                <i className="icon icon_-Tb_star text-[1.125rem]" aria-hidden="true" />
                {CONNECTED_APPS_TEXT.setDefault}
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onSelect={handleDelete}
                className="gap-2"
              >
                <i className="icon icon_-Tb_trash text-[1.125rem]" aria-hidden="true" />
                {CONNECTED_APPS_TEXT.delete}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}
