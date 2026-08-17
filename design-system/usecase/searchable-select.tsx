/**
 * USE CASE — SearchableSelect (a dropdown WITH a search box)
 *
 * Reference only. Read before building a searchable picker.
 *
 * When to use:
 * - Use `SearchableSelect` when the option list is long enough that typing to
 *   filter helps (banks, accounts, clients, countries, advisors…).
 * - Keep plain `Select` for a short fixed list.
 * - For multi-select chips / custom item rendering, drop to the lower-level
 *   `Combobox` primitives in `@/components/ui/combobox`.
 *
 * DS rules shown here:
 * - Pair with a `<Label htmlFor>` like any field control.
 * - It IS the styled component — don't hand-roll a search box inside a Select
 *   (Radix Select can't host an input). Just pass `options` + `value` +
 *   `onValueChange`; the trigger (gold open-border + chevron), the search input
 *   (left magnifier), and the gold-tinted selected row are all baked in.
 * - Options come from real data / a real enum (`*_VALUES`) — never invented.
 */
import { useState } from 'react';
import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/ui/searchable-select';

const BANKS = [
  'Chase Bank',
  'Bank of America',
  'Wells Fargo',
  'Citibank',
  'US Bank',
];

export function SearchableSelectUseCase() {
  const [bank, setBank] = useState('Chase Bank');

  return (
    <form className="flex max-w-sm flex-col gap-4 p-6">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="funding-bank">Funding Bank</Label>
        <SearchableSelect
          id="funding-bank"
          value={bank}
          onValueChange={setBank}
          options={BANKS}
          placeholder="Select a bank"
          searchPlaceholder="Search banks"
        />
      </div>
    </form>
  );
}

export default SearchableSelectUseCase;
