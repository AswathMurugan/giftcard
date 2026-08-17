/**
 * A single cascading level field: a popover with a searchable, multi-select
 * list of orgs for one hierarchy level. Selected orgs show as removable chips.
 * Disabled until its parent level has a selection (gating).
 */
import { useState } from 'react';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { Organization } from '@/config/org';

export interface OrgLevelFieldProps {
  levelName: string;
  options: Organization[];
  selected: Organization[];
  disabled?: boolean;
  multiple?: boolean;
  onSearch: (query: string) => void;
  onToggle: (org: Organization) => void;
  onRemove: (org: Organization) => void;
}

export function OrgLevelField({
  levelName,
  options,
  selected,
  disabled,
  multiple = true,
  onSearch,
  onToggle,
  onRemove,
}: OrgLevelFieldProps) {
  const [open, setOpen] = useState(false);
  const selectedIds = new Set(selected.map((o) => o.id));

  return (
    <div className="flex flex-col gap-1.5">
      <Label>{levelName}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          className={cn(
            'flex min-h-9 w-full items-center justify-between gap-2 rounded-lg border border-input bg-card px-3 py-2 text-sm',
            disabled && 'pointer-events-none opacity-50',
          )}
        >
          <div className="flex flex-1 flex-wrap items-center gap-1">
            {selected.length === 0 ? (
              <span className="text-muted-foreground">
                Select {levelName.toLowerCase()}…
              </span>
            ) : (
              selected.map((o) => (
                <Badge key={o.id} variant="secondary" className="gap-1">
                  {o.name}
                  <X
                    className="h-3 w-3 cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(o);
                    }}
                  />
                </Badge>
              ))
            )}
          </div>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder={`Search ${levelName.toLowerCase()}…`}
              onValueChange={onSearch}
            />
            <CommandList>
              <CommandEmpty>No results.</CommandEmpty>
              <CommandGroup>
                {options.map((o) => {
                  const isSelected = selectedIds.has(o.id);
                  return (
                    <CommandItem
                      key={o.id}
                      value={o.id}
                      onSelect={() => {
                        onToggle(o);
                        if (!multiple) setOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          'mr-2 h-4 w-4',
                          isSelected ? 'opacity-100' : 'opacity-0',
                        )}
                      />
                      <span className="flex-1">{o.name}</span>
                      <span className="text-xs text-muted-foreground">{o.code}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
