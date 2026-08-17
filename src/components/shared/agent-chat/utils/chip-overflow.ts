export interface ChipItemBounds {
  top: number;
  bottom: number;
}

export interface CollapsedChipLayout {
  maxHeight: number;
  hiddenCount: number;
}

export function chipListMaxHeight(
  expanded: boolean,
  layout: CollapsedChipLayout | null,
  fallback: string,
): number | string | undefined {
  if (expanded) return undefined;
  return layout?.maxHeight ?? fallback;
}

/** Collapse after whole flex rows, even when a wrapped chip makes one row tall. */
export function collapsedChipLayout(
  items: readonly ChipItemBounds[],
  maxRows = 3,
  tolerance = 1,
): CollapsedChipLayout {
  const rows: Array<{ top: number; bottom: number; count: number }> = [];
  for (const item of items) {
    const row = rows.find((candidate) => Math.abs(candidate.top - item.top) <= tolerance);
    if (row) {
      row.bottom = Math.max(row.bottom, item.bottom);
      row.count += 1;
    } else {
      rows.push({ top: item.top, bottom: item.bottom, count: 1 });
    }
  }
  const visibleRows = rows.slice(0, Math.max(0, maxRows));
  return {
    maxHeight: visibleRows.reduce((bottom, row) => Math.max(bottom, row.bottom), 0),
    hiddenCount: rows.slice(Math.max(0, maxRows)).reduce((count, row) => count + row.count, 0),
  };
}
