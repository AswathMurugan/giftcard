/**
 * USE CASE — DataTable
 *
 * Reference only. Read before rendering a list/grid.
 *
 * DS rules shown here:
 * - Gold header (Primary-50 bg, 18px/600 heading via the `title` prop),
 *   Primary-200 table border, Primary-300 column dividers — all baked into the
 *   component theme; don't restyle the grid.
 * - Pass `title` for the table heading (DS Heading 4, 18px). Search + columns
 *   controls live together at the top-right automatically.
 * - Render status/category cells with `Badge` (see badge.tsx use case).
 * - In real pages, feed rows via `useSavedQueryTable` for server-side
 *   pagination — this sample uses static rows just to show the shape.
 * - Sizing: the table self-floors via `minHeight` (default `'32rem'`). Drop
 *   it in directly — don't wrap in a fixed-pixel height. By default the page
 *   scrolls as one and the table sits at its floor. Only to fill the viewport
 *   remainder and scroll rows internally, give it a `flex-1 min-h-0` parent
 *   inside an `h-full` page root (never `h-svh`).
 * - ROW ACTIONS (the ⋮ menu) are OPT-IN: pass the `rowActions` prop and the
 *   table appends ONE standardized, pinned-right kebab column — same button
 *   size, alignment, and row height on every table. NEVER hand-roll an actions
 *   `cellRenderer` (it drifts in height). Omit the prop → no actions column.
 *   Destructive actions use `variant: 'destructive'` (DS red item); the
 *   confirm step (e.g. an AlertDialog before a delete mutation) is owned by
 *   the action's `onSelect`, not the table.
 */
import type { ColDef } from 'ag-grid-community';
import { DataTable } from '@/components/ui/data-table';
import type { RowAction } from '@/components/ui/data-table';

interface AccountRow {
  name: string;
  type: string;
  balance: number;
  status: string;
}

const ROWS: AccountRow[] = [
  { name: 'Jane Doe', type: 'Individual', balance: 1284920, status: 'Active' },
  { name: 'Acme Trust', type: 'Trust', balance: 5402100, status: 'Pending' },
  { name: 'John Smith', type: 'Retirement', balance: 845300, status: 'On Hold' },
];

const COLUMN_DEFS: ColDef<AccountRow>[] = [
  { field: 'name', headerName: 'Client' },
  { field: 'type', headerName: 'Type' },
  {
    field: 'balance',
    headerName: 'Balance',
    valueFormatter: (p) =>
      typeof p.value === 'number' ? `$${p.value.toLocaleString()}` : '',
  },
  { field: 'status', headerName: 'Status' },
];

// Opt-in per-row actions → the standardized ⋮ menu. View/Edit are neutral;
// Delete is `destructive` (DS red). Real pages do the work in `onSelect`
// (open a drawer, route, or confirm-then-mutate); here they're stubs.
const ROW_ACTIONS: RowAction<AccountRow>[] = [
  { label: 'View', icon: 'icon_-Tb_eye', onSelect: () => {} },
  { label: 'Edit', icon: 'icon_-Tb_pencil', onSelect: () => {} },
  {
    label: 'Delete',
    icon: 'icon_-Tb_trash',
    variant: 'destructive',
    onSelect: () => {},
  },
];

export function DataTableUseCase() {
  return (
    <div className="p-6">
      <DataTable<AccountRow>
        title="Accounts"
        rowData={ROWS}
        columnDefs={COLUMN_DEFS}
        rowActions={ROW_ACTIONS}
      />
    </div>
  );
}

export default DataTableUseCase;
