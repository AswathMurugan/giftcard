/**
 * USE CASE — SegmentedControl (the DS `.jf-seg` pill / rect segment row)
 *
 * Reference only. Read before building any mutually-exclusive choice row.
 *
 * When to use:
 * - A small set (2–5) of mutually-exclusive choices shown side-by-side:
 *   enum answers ("Full / Partial"), Yes/No questions, view switches
 *   (list / grid), request method pickers, priority pickers.
 * - For longer lists use `Select`/`SearchableSelect`; for multi-select use
 *   checkboxes or `ToggleGroup type="multiple"`.
 *
 * DS rules shown here:
 * - It IS the styled component — never hand-roll a pill radio row from
 *   buttons + borders in page code (that's how the three drifted copies in
 *   the servicing app happened).
 * - Selected segment = cream `primary-50` fill + `primary-300` gold border +
 *   weight 600 — never a gray fill. Only one segment reads as gold.
 * - Sizes: `sm` 13px, `md` 15px (default), `lg` 17px — per the DS component
 *   spec (component-pinned sizes, not the page type scale).
 * - `variant="text"` = pill (999 radius); `variant="icons"` = rounded rect
 *   (10px) with 20px Nucleo glyphs — give icon-only segments an `aria-label`.
 * - Arrow keys move the selection (radiogroup semantics) — built in.
 */
import { useState } from 'react';
import { Label } from '@/components/ui/label';
import { SegmentedControl } from '@/components/ui/segmented-control';

export function SegmentedControlUseCases() {
  const [scope, setScope] = useState('Full');
  const [confirm, setConfirm] = useState('Yes');
  const [view, setView] = useState('list');

  return (
    <div className="flex flex-col gap-6">
      {/* Enum choice (text pill, default md/15px) */}
      <div className="flex flex-col gap-2">
        <Label htmlFor="scope">Withdrawal type</Label>
        <SegmentedControl
          id="scope"
          aria-label="Withdrawal type"
          value={scope}
          options={['Full', 'Partial']}
          onValueChange={setScope}
        />
      </div>

      {/* Yes/No question — SegmentedControl or a RadioGroup pair, app's choice */}
      <div className="flex flex-col gap-2">
        <Label htmlFor="confirm">Is this account jointly owned?</Label>
        <SegmentedControl
          id="confirm"
          aria-label="Jointly owned"
          value={confirm}
          options={['Yes', 'No']}
          onValueChange={setConfirm}
        />
      </div>

      {/* Icon view switch (rounded rect, 20px Nucleo glyphs) */}
      <SegmentedControl
        aria-label="View"
        variant="icons"
        value={view}
        options={[
          { value: 'list', icon: 'icon_-Tb_list', 'aria-label': 'List view' },
          { value: 'grid', icon: 'icon_-Tb_layout_grid', 'aria-label': 'Grid view' },
        ]}
        onValueChange={setView}
      />
    </div>
  );
}
