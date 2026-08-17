/**
 * OrgHierarchySelector — the lean cascading org/advisor picker.
 *
 * Drop it on a page wrapped in `<OrgContextProvider>`. It:
 *   - loads the hierarchy from `user-org-context-v3` and seeds OrgContext,
 *   - renders one cascading multi-select field per selectable level,
 *   - renders an advisor field (gated on a deepest-level org selection),
 *   - writes the selection into OrgContext on every change.
 *
 * The page's saved-query reads then auto-apply `_org` from that selection.
 *
 * This is a pragmatic wrapper on the starter's shadcn primitives — not the
 * full platform orghierarchy component (4 display modes, WCAG-AA, imperative
 * ref). Single display, single/multi select, debounced search, cascade-reset.
 */
import { useEffect, useMemo, useState } from 'react';
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
import { useOrgContext, type Advisor } from '@/config/org';
import {
  useOrgContextData,
  useOrgSearch,
  useAdvisorSearch,
  ORG_CONTEXT_QUERY,
  ADVISOR_SEARCH_QUERY,
} from '@/hooks/org';
import { OrgLevelField } from './OrgLevelField';
import {
  isLevelEnabled,
  itemsAtLevel,
  parentIdsFor,
  removeOrg,
  selectableLevels,
  selectedOrgIdsDeepest,
  toggleOrg,
} from './cascade';

export interface OrgHierarchySelectorProps {
  /** Single vs multi select per level (default multi). */
  multiple?: boolean;
  /** Show the advisor field (default true). */
  showAdvisor?: boolean;
  /** Override the org-context platform saved query name. */
  orgContextQuery?: string;
  /** Override the advisor-search platform saved query name. */
  advisorQuery?: string;
  className?: string;
}

export function OrgHierarchySelector({
  multiple = true,
  showAdvisor = true,
  orgContextQuery = ORG_CONTEXT_QUERY,
  advisorQuery = ADVISOR_SEARCH_QUERY,
  className,
}: OrgHierarchySelectorProps) {
  const ctx = useOrgContext();
  const { data: hierarchy, isLoading } = useOrgContextData(orgContextQuery);
  const { resultsFor, setQuery } = useOrgSearch();

  // Seed the context hierarchy once loaded.
  useEffect(() => {
    if (hierarchy && ctx) ctx.setHierarchy(hierarchy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hierarchy]);

  const levels = useMemo(
    () => selectableLevels(hierarchy?.orgLevels ?? []),
    [hierarchy],
  );

  if (!ctx) {
    // Misuse guard: selector outside a provider can't scope anything.
    return null;
  }
  const selection = ctx.selection;
  const deepestOrgIds = selectedOrgIdsDeepest(selection, hierarchy?.orgLevels ?? []);

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {isLoading && levels.length === 0 ? (
          <span className="text-sm text-muted-foreground">Loading org hierarchy…</span>
        ) : (
          levels.map((level) => {
            const parentIds = parentIdsFor(selection, levels, level);
            const q = '';
            const options = resultsFor(level.level_order, parentIds, q);
            return (
              <OrgLevelField
                key={level.id}
                levelName={level.name}
                options={options}
                selected={itemsAtLevel(selection, level.id)}
                disabled={!isLevelEnabled(selection, levels, level)}
                multiple={multiple}
                onSearch={(query) => setQuery(level.level_order, query)}
                onToggle={(org) =>
                  ctx.setSelection(
                    toggleOrg(selection, levels, level, org, multiple),
                  )
                }
                onRemove={(org) =>
                  ctx.setSelection(removeOrg(selection, levels, level, org))
                }
              />
            );
          })
        )}

        {showAdvisor && (
          <AdvisorField
            orgIds={deepestOrgIds}
            queryName={advisorQuery}
            selected={selection.advisors}
            multiple={multiple}
            onChange={(advisors) =>
              ctx.setSelection({ ...selection, advisors })
            }
          />
        )}
      </div>
    </div>
  );
}

// ── Advisor field (uses the debounced advisor-search hook) ──────────────────

interface AdvisorFieldProps {
  orgIds: string[];
  queryName: string;
  selected: Advisor[];
  multiple: boolean;
  onChange: (advisors: Advisor[]) => void;
}

function AdvisorField({
  orgIds,
  queryName,
  selected,
  multiple,
  onChange,
}: AdvisorFieldProps) {
  const [open, setOpen] = useState(false);
  const { results, search } = useAdvisorSearch(orgIds, queryName);
  const disabled = orgIds.length === 0;
  const selectedIds = new Set(selected.map((a) => a.userId));

  const toggle = (a: Advisor) => {
    const exists = selectedIds.has(a.userId);
    if (exists) onChange(selected.filter((s) => s.userId !== a.userId));
    else onChange(multiple ? [...selected, a] : [a]);
  };

  const label = (a: Advisor) =>
    a.fullName || `${a.firstName} ${a.lastName}`.trim() || a.userId;

  return (
    <div className="flex flex-col gap-1.5">
      <Label>Advisor</Label>
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
                {disabled ? 'Select an org first…' : 'Select advisor…'}
              </span>
            ) : (
              selected.map((a) => (
                <Badge key={a.userId} variant="secondary" className="gap-1">
                  {label(a)}
                  <X
                    className="h-3 w-3 cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(a);
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
              placeholder="Search advisor…"
              onValueChange={search}
            />
            <CommandList>
              <CommandEmpty>No advisors.</CommandEmpty>
              <CommandGroup>
                {results.map((a) => (
                  <CommandItem
                    key={a.userId}
                    value={a.userId}
                    onSelect={() => {
                      toggle(a);
                      if (!multiple) setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4',
                        selectedIds.has(a.userId) ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    <span className="flex-1">{label(a)}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
