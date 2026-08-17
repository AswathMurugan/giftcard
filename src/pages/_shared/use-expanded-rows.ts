/**
 * Expand/collapse state for a table whose rows have detail rows beneath them.
 *
 * Shared because two tables need the identical behaviour — the quote
 * comparison and the deal breakdown both list a card and then the materials
 * it is priced from — and the two must not drift apart: an operator reading
 * one and then the other should not meet two different expanders.
 *
 * Rows are keyed by a stable id, never an index: the deal re-sorts when a
 * supplier pick changes, and index keys would silently move the open row.
 */
import { useCallback, useMemo, useState } from 'react';

export interface ExpandedRows {
  /** Whether one row currently shows its detail. */
  isOpen: (id: string) => boolean;
  /**
   * Click handler for a row's expander. The row id is read from the button's
   * `data-row` attribute rather than captured in a closure, so every row can
   * share ONE stable handler instead of allocating a fresh one per render.
   */
  toggle: (event: React.MouseEvent<HTMLButtonElement>) => void;
  /** True when every row is open — drives the Collapse-all label. */
  allOpen: boolean;
  toggleAll: () => void;
}

export function useExpandedRows(ids: readonly string[]): ExpandedRows {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const toggle = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    const id = event.currentTarget.dataset.row;
    if (!id) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      // delete returns false when it wasn't there — one lookup, not two.
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const allOpen = ids.length > 0 && ids.every((id) => expanded.has(id));

  const toggleAll = useCallback(() => {
    // Read `ids` through the updater rather than closing over `expanded`, so
    // the callback stays stable across renders.
    setExpanded((prev) => (ids.every((id) => prev.has(id)) ? new Set() : new Set(ids)));
  }, [ids]);

  const isOpen = useCallback((id: string) => expanded.has(id), [expanded]);

  return useMemo(
    () => ({ isOpen, toggle, allOpen, toggleAll }),
    [isOpen, toggle, allOpen, toggleAll],
  );
}
