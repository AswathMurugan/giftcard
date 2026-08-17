/**
 * GridViewSwitcher — the shared + per-user saved-views control for a DataTable
 * (PHXSR-106, PHXSR-208). Renders a CONNECTED segmented control (a base "All"
 * view + each saved view as joined tabs, active tab in cream/gold), a `+N`
 * overflow, and a ⋮ menu with view actions. Organization views are selectable
 * but read-only; "Save as New View" creates a personal copy.
 *
 * Drop it into a DataTable's `toolbarLeft` slot and give it the grid `api`
 * (captured via the DataTable's `onGridReady`). Shared views load from merged
 * app preferences; personal views persist via `useTableViews`. Selecting a view
 * applies its column state + filters; the base segment resets to defaults.
 *
 * @example
 * const [api, setApi] = useState<GridApi | null>(null);
 * <DataTable
 *   onGridReady={(e) => setApi(e.api)}
 *   toolbarLeft={api && (
 *     <GridViewSwitcher api={api} page="service-requests" componentId="sr_requests" baseLabel="All Requests" />
 *   )}
 *   columnDefs={cols} rowData={rows}
 * />
 */
import { useCallback, useMemo, useState, type ChangeEvent } from 'react';
import type { ColumnState, FilterModel, GridApi } from 'ag-grid-community';
import { ChevronDown, MoreVertical, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from '@/components/ui/toast';

import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useTableViews } from '@/hooks/useTableViews';
import {
  findScopedView,
  isValidScopedViewName,
  type GridViewState,
  type ScopedTableView,
} from '@/hooks/table-views-helpers';

/** Max saved-view tabs shown before the rest collapse into the `+N` overflow. */
const MAX_VISIBLE_VIEWS = 3;

interface DialogState {
  mode: 'save' | 'rename';
  name: string;
}

export interface GridViewSwitcherProps {
  /** The AG Grid api, captured from the DataTable's `onGridReady`. */
  api: GridApi;
  /** URL slug of the page the grid lives on (scopes the preference). */
  page: string;
  /** Stable component id for this table (part of the preference name). */
  componentId: string;
  /** Label for the base/default (no-filter) view segment. Defaults to "All". */
  baseLabel?: string;
}

export function GridViewSwitcher({ api, page, componentId, baseLabel = 'All' }: GridViewSwitcherProps) {
  const { views, saving, saveNewView, updateView, renameView, deleteView } = useTableViews(page, componentId);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const activeView = findScopedView(views, activeId);
  const hasActive = activeView != null;
  const activeReadOnly = activeView?.readOnly ?? true;

  const captureState = useCallback(
    (): GridViewState => ({
      columnState: api.getColumnState(),
      filterModel: (api.getFilterModel() as Record<string, unknown> | null) ?? {},
      sortModel: [],
      selectedFilterName: '',
    }),
    [api],
  );

  const applyState = useCallback(
    (state: GridViewState) => {
      api.applyColumnState({ state: state.columnState as ColumnState[], applyOrder: true });
      api.setFilterModel((state.filterModel as FilterModel) ?? null);
    },
    [api],
  );

  const selectBase = useCallback(() => {
    setActiveId(null);
    api.resetColumnState();
    api.setFilterModel(null);
  }, [api]);

  const selectView = useCallback(
    (view: ScopedTableView) => {
      setActiveId(view.runtimeId);
      applyState(view.value);
    },
    [applyState],
  );

  const openSave = useCallback(() => setDialog({ mode: 'save', name: '' }), []);
  const openRename = useCallback(() => {
    if (activeView && !activeView.readOnly) {
      setDialog({ mode: 'rename', name: activeView.key });
    }
  }, [activeView]);

  const onSaveChanges = useCallback(async () => {
    if (activeId == null) return;
    try {
      await updateView(activeId, captureState());
      toast.success('Changes saved to view');
    } catch {
      toast.error('Couldn’t save changes. Please try again.');
    }
  }, [activeId, updateView, captureState]);

  const onDelete = useCallback(async () => {
    if (activeId == null) return;
    try {
      await deleteView(activeId);
      selectBase();
      toast.success('View deleted');
    } catch {
      toast.error('Couldn’t delete the view. Please try again.');
    }
  }, [activeId, deleteView, selectBase]);

  const nameValid = dialog
    ? isValidScopedViewName(
        views,
        dialog.name,
        dialog.mode === 'rename' ? (activeId ?? undefined) : undefined
      )
    : false;
  const nameConflict = dialog != null && dialog.name.trim() !== '' && !nameValid;

  const onDialogSubmit = useCallback(async () => {
    if (!dialog || !nameValid || saving) return;
    const name = dialog.name.trim();
    try {
      if (dialog.mode === 'save') {
        const created = await saveNewView(name, captureState());
        if (created) setActiveId(created.runtimeId);
        toast.success('View saved');
      } else if (activeId != null) {
        await renameView(activeId, name);
        toast.success('View renamed');
      }
      setDialog(null);
    } catch {
      toast.error('Couldn’t save the view. Please try again.');
    }
  }, [dialog, nameValid, saving, saveNewView, captureState, activeId, renameView]);

  const onDialogNameChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => setDialog((d) => (d ? { ...d, name: e.target.value } : d)),
    [],
  );

  // Split saved views into visible tabs + an overflow bucket, always keeping the
  // ACTIVE view visible (pull it out of the overflow into the last visible slot).
  const { visible, overflow } = useMemo(() => {
    let vis = views.slice(0, MAX_VISIBLE_VIEWS);
    let ovf = views.slice(MAX_VISIBLE_VIEWS);
    if (activeId != null && ovf.some((v) => v.runtimeId === activeId)) {
      const active = ovf.find((v) => v.runtimeId === activeId)!;
      ovf = ovf.filter((v) => v.runtimeId !== activeId);
      // The last visible slot is given to the active view; the view it displaces
      // must return to the FRONT of the overflow (else it vanishes from the UI).
      const displaced = vis[MAX_VISIBLE_VIEWS - 1];
      vis = [...vis.slice(0, MAX_VISIBLE_VIEWS - 1), active];
      if (displaced) ovf = [displaced, ...ovf];
    }
    return { visible: vis, overflow: ovf };
  }, [views, activeId]);

  return (
    <div className="flex items-center">
      {/* One connected segmented control: base + view tabs · +N overflow · ⋮ menu.
          `divide-x` draws the hairline between cells; `overflow-hidden rounded-lg`
          clips the active cream fill to the rounded ends. */}
      {/* Border/divider use a NEUTRAL grayscale-300 frame to match the JIFFYAI
          DS `.jf-seg`; gold (primary-300) is reserved for the selected segment. */}
      <div className="flex items-center divide-x divide-grayscale-300 overflow-hidden rounded-full border border-grayscale-300 bg-card">
        <ViewSegment label={baseLabel} active={!hasActive} onClick={selectBase} />
        {visible.map((v) => (
          <ViewSegment
            key={v.runtimeId}
            label={v.key}
            active={activeId === v.runtimeId}
            readOnly={v.readOnly}
            onClick={() => selectView(v)}
          />
        ))}

        {overflow.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`${overflow.length} more views`}
                className="flex h-10 shrink-0 items-center gap-1 px-4 text-[1rem] text-grayscale-900 transition-colors hover:bg-grayscale-50 dark:text-grayscale-300 dark:hover:bg-grayscale-800"
              >
                +{overflow.length}
                <ChevronDown className="size-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-[16rem] w-[13rem] overflow-y-auto rounded-lg p-1.5">
              {overflow.map((v) => (
                <DropdownMenuItem
                  key={v.runtimeId}
                  onClick={() => selectView(v)}
                  title={v.readOnly ? `${v.key} — shared view, read-only` : v.key}
                  className="truncate focus:bg-grayscale-50 dark:focus:bg-grayscale-800"
                >
                  {v.key}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="View options"
              className="flex h-10 w-[4.25rem] shrink-0 items-center justify-center text-grayscale-900 transition-colors hover:bg-grayscale-50 dark:text-grayscale-300 dark:hover:bg-grayscale-800"
            >
              <MoreVertical className="size-5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[13rem] rounded-lg p-1.5">
            <DropdownMenuItem onClick={onSaveChanges} disabled={!hasActive || activeReadOnly || saving} className="min-h-[2.5rem] gap-3 px-3 text-[0.9375rem] focus:bg-grayscale-50 dark:focus:bg-grayscale-800">
              <Save className="size-4 text-muted-foreground" /> Save Changes to View
            </DropdownMenuItem>
            <DropdownMenuItem onClick={openSave} className="min-h-[2.5rem] gap-3 px-3 text-[0.9375rem] focus:bg-grayscale-50 dark:focus:bg-grayscale-800">
              <Plus className="size-4 text-muted-foreground" /> Save as New View
            </DropdownMenuItem>
            <DropdownMenuItem onClick={openRename} disabled={!hasActive || activeReadOnly} className="min-h-[2.5rem] gap-3 px-3 text-[0.9375rem] focus:bg-grayscale-50 dark:focus:bg-grayscale-800">
              <Pencil className="size-4 text-muted-foreground" /> Rename View
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onDelete} disabled={!hasActive || activeReadOnly || saving} className="min-h-[2.5rem] gap-3 px-3 text-[0.9375rem] focus:bg-grayscale-50 dark:focus:bg-grayscale-800">
              <Trash2 className="size-4 text-muted-foreground" /> Delete View
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Save / Rename name dialog */}
      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="sm:max-w-[27.5rem]">
          <DialogHeader>
            <DialogTitle>{dialog?.mode === 'rename' ? 'Rename View' : 'Save View'}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-1">
            <Label htmlFor="grid-view-name">View Name</Label>
            <Input
              id="grid-view-name"
              value={dialog?.name ?? ''}
              onChange={onDialogNameChange}
              aria-invalid={nameConflict}
              aria-describedby={nameConflict ? 'grid-view-name-error' : 'grid-view-name-help'}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onDialogSubmit();
              }}
              placeholder="Enter view name"
              autoFocus
            />
            {nameConflict ? (
              <p id="grid-view-name-error" role="alert" className="text-xs text-destructive">
                A view with this name already exists.
              </p>
            ) : (
              <p id="grid-view-name-help" className="text-xs text-muted-foreground">
                This view will save your current filters, column settings, and sort order.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button onClick={onDialogSubmit} disabled={!nameValid || saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** A single view segment — cream fill + a complete rounded gold outline when
 *  active, neutral otherwise. The rounded active edge prevents the selected
 *  view from looking cut off where it meets the menu segment. */
function ViewSegment({
  label,
  active,
  readOnly = false,
  onClick,
}: {
  label: string;
  active: boolean;
  readOnly?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={readOnly ? `${label} — shared view, read-only` : label}
      className={cn(
        'relative flex h-10 max-w-[12rem] shrink-0 items-center truncate px-4 text-[1rem] transition-colors',
        active
          ? 'z-10 rounded-full bg-primary-50 font-semibold text-grayscale-900 ring-1 ring-inset ring-primary-300 dark:bg-primary-500/20 dark:text-foreground dark:ring-primary-500'
          : 'bg-card font-normal text-grayscale-900 hover:bg-grayscale-50 dark:text-grayscale-300 dark:hover:bg-grayscale-800',
      )}
    >
      {label}
    </button>
  );
}
