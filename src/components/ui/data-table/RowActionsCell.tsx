import type { ICellRendererParams } from 'ag-grid-community';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import {
  resolveRowActions,
  type RowActionsSource,
} from './normalize-row-actions';

/**
 * Per-row actions cell — the standardized kebab (⋮) menu for the DataTable's
 * opt-in actions column.
 *
 * Why this lives in the wrapper (not hand-rolled per page): a custom AG Grid
 * cell renderer has no shared spec, so each page would size/align its own
 * trigger differently and the row heights would drift. Centralizing it here
 * guarantees one button size, one alignment, and a consistent 46px row height
 * across every generated table.
 *
 * The actions source is threaded through AG Grid's `context.rowActions`
 * (set by DataTable when the caller passes the `rowActions` prop). The row is
 * `params.data`. Destructive actions render the DS red menu item; any confirm
 * (e.g. an AlertDialog before a delete mutation) is owned by the action's
 * `onSelect`, not this cell.
 */
export interface RowActionsCellContext<TData = unknown> {
  rowActions?: RowActionsSource<TData>;
}

export function RowActionsCell<TData = unknown>(
  params: ICellRendererParams<TData> & {
    context?: RowActionsCellContext<TData>;
  },
) {
  const row = params.data ?? null;
  const actions = resolveRowActions(params.context?.rowActions, row);

  // Nothing to show → render an empty (but height-consistent) cell.
  if (actions.length === 0 || row == null) {
    return <div className="flex h-full w-full items-center justify-end" />;
  }

  return (
    <div className="flex h-full w-full items-center justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Row actions">
            <i
              className="icon icon_-Tb_dots_vertical text-[1.25rem]"
              aria-hidden="true"
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {actions.map((action, i) => (
            <DropdownMenuItem
              key={`${action.label}-${i}`}
              variant={action.variant}
              disabled={action.disabled}
              onSelect={() => action.onSelect(row)}
            >
              {action.icon && (
                <i
                  className={`icon ${action.icon} text-[1.125rem]`}
                  aria-hidden="true"
                />
              )}
              {action.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export default RowActionsCell;
