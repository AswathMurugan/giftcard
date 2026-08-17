import { describe, it, expect, vi } from 'vitest';
import { sanitizeColumnDefs } from './sanitize-column-defs';

describe(
  'sanitizeColumnDefs',
  { tags: ['data-table', 'logic'] },
  () => {
    describe('passthrough cases', { tags: ['smoke'] }, () => {
      it(
        'returns undefined when input is undefined',
        { tags: ['edge-case'] },
        () => {
          expect(sanitizeColumnDefs(undefined)).toBeUndefined();
        },
      );

      it(
        'returns undefined when input is null',
        { tags: ['edge-case'] },
        () => {
          expect(sanitizeColumnDefs(null)).toBeUndefined();
        },
      );

      it('returns an empty array for an empty input', () => {
        expect(sanitizeColumnDefs([])).toEqual([]);
      });

      it(
        'leaves a column with `field` untouched',
        { tags: ['important'] },
        () => {
          const col = { field: 'name', headerName: 'Name' };
          const result = sanitizeColumnDefs([col]);
          expect(result).toEqual([col]);
          // Reference equality — column should not be cloned when no
          // change is needed (perf + identity stability for AG-Grid).
          expect(result?.[0]).toBe(col);
        },
      );

      it(
        'leaves a column with only `colId` untouched',
        { tags: ['important'] },
        () => {
          const col = {
            colId: 'name',
            headerName: 'Name',
            valueGetter: () => 'x',
          };
          const result = sanitizeColumnDefs([col]);
          expect(result?.[0]).toBe(col);
        },
      );

      it(
        'leaves a column with both filter:false AND sortable:false untouched',
        { tags: ['edge-case'] },
        () => {
          // Already opted out — no clone needed.
          const col = {
            headerName: 'Actions',
            filter: false,
            sortable: false,
            valueGetter: () => null,
          };
          const result = sanitizeColumnDefs([col]);
          expect(result?.[0]).toBe(col);
        },
      );

      it(
        'leaves a column group (children) untouched',
        { tags: ['edge-case'] },
        () => {
          // Groups carry no filter/sort of their own; child handling is
          // independent. We deliberately do NOT recurse into children —
          // the CEL builder's safety net catches any leftover bogus
          // keys.
          const group = {
            headerName: 'Details',
            children: [{ headerName: 'X', valueGetter: () => 'x' }],
          };
          const result = sanitizeColumnDefs([group]);
          expect(result?.[0]).toBe(group);
        },
      );
    });

    describe('suppression cases', { tags: ['important'] }, () => {
      it(
        'forces filter:false + sortable:false on a valueGetter-only column',
        () => {
          // The Accounts-page bug shape: Account Name has only a
          // valueGetter that composes nick_name/name/account_number.
          // No field, no colId — AG-Grid would auto-assign "0" and
          // the funnel would emit `ilike(0, '%foo%')`. Strip both
          // affordances upstream so the user never sees the funnel.
          const col = {
            headerName: 'Account Name',
            valueGetter: () => 'x',
          };
          const result = sanitizeColumnDefs([col]);
          expect(result).toEqual([
            {
              headerName: 'Account Name',
              valueGetter: col.valueGetter,
              filter: false,
              sortable: false,
            },
          ]);
          // New object — original must not be mutated.
          expect(result?.[0]).not.toBe(col);
          expect((col as { filter?: unknown }).filter).toBeUndefined();
        },
      );

      it(
        'forces filter:false + sortable:false on a column with empty-string field',
        { tags: ['edge-case'] },
        () => {
          // An empty `field` is not a usable backend identifier — the
          // sanitiser treats it the same as missing.
          const col = { headerName: 'X', field: '', valueGetter: () => 1 };
          const result = sanitizeColumnDefs([col]) as Array<{
            filter?: unknown;
            sortable?: unknown;
          }>;
          expect(result?.[0]?.filter).toBe(false);
          expect(result?.[0]?.sortable).toBe(false);
        },
      );

      it(
        'calls onSuppress with the headerName for each suppressed column',
        () => {
          const onSuppress = vi.fn();
          sanitizeColumnDefs(
            [
              { headerName: 'Account Name', valueGetter: () => 'x' },
              { field: 'account_number', headerName: 'Account Number' },
              { headerName: 'Notes', valueGetter: () => 'y' },
            ],
            { onSuppress },
          );
          expect(onSuppress).toHaveBeenCalledTimes(2);
          expect(onSuppress).toHaveBeenNthCalledWith(1, 'Account Name');
          expect(onSuppress).toHaveBeenNthCalledWith(2, 'Notes');
        },
      );

      it(
        'calls onSuppress with undefined when headerName is missing',
        { tags: ['edge-case'] },
        () => {
          const onSuppress = vi.fn();
          sanitizeColumnDefs([{ valueGetter: () => 1 }], { onSuppress });
          expect(onSuppress).toHaveBeenCalledWith(undefined);
        },
      );

      it(
        'does NOT call onSuppress for already-opted-out columns',
        { tags: ['edge-case'] },
        () => {
          const onSuppress = vi.fn();
          sanitizeColumnDefs(
            [
              {
                headerName: 'Actions',
                filter: false,
                sortable: false,
                valueGetter: () => null,
              },
            ],
            { onSuppress },
          );
          expect(onSuppress).not.toHaveBeenCalled();
        },
      );
    });

    describe('mixed input', { tags: ['important'] }, () => {
      it(
        'preserves order and only neuters identityless columns',
        () => {
          const acctName = {
            headerName: 'Account Name',
            valueGetter: () => 'x',
          };
          const acctNumber = {
            field: 'account_number',
            headerName: 'Account Number',
          };
          const result = sanitizeColumnDefs([acctName, acctNumber]) as Array<
            Record<string, unknown>
          >;
          expect(result).toHaveLength(2);
          // First: neutered clone, not original.
          expect(result?.[0]).not.toBe(acctName);
          expect(result?.[0]?.filter).toBe(false);
          expect(result?.[0]?.sortable).toBe(false);
          expect(result?.[0]?.headerName).toBe('Account Name');
          // Second: untouched (same reference).
          expect(result?.[1]).toBe(acctNumber);
        },
      );
    });

    describe('robustness', { tags: ['edge-case'] }, () => {
      it('passes through non-object entries unchanged', () => {
        // Defensive — AG-Grid's column-def type doesn't actually allow
        // these, but a runtime null shouldn't crash the sanitiser.
        const input = [null, undefined, 'x', 0] as unknown[];
        expect(sanitizeColumnDefs(input)).toEqual(input);
      });
    });
  },
);
