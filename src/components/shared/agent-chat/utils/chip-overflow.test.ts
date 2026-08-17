import { describe, expect, it } from 'vitest';
import { chipListMaxHeight, collapsedChipLayout } from './chip-overflow';

describe('collapsedChipLayout', { tags: ['agent-chat', 'chip-overflow', 'logic'] }, () => {
  it('defaults to three rows and counts every chip in hidden rows', { tags: ['important'] }, () => {
    expect(collapsedChipLayout([
      { top: 0, bottom: 20 },
      { top: 0, bottom: 20 },
      { top: 28, bottom: 48 },
      { top: 28, bottom: 48 },
      { top: 56, bottom: 76 },
      { top: 56, bottom: 76 },
      { top: 84, bottom: 104 },
      { top: 84, bottom: 104 },
    ])).toEqual({ maxHeight: 76, hiddenCount: 2 });
  });

  it('buckets chips into flex rows and uses the tallest chip bottom', { tags: ['important'] }, () => {
    const layout = collapsedChipLayout([
      { top: 0, bottom: 20 },
      { top: 0.7, bottom: 32 },
      { top: 40, bottom: 60 },
      { top: 40.4, bottom: 64 },
      { top: 80, bottom: 100 },
      { top: 80.2, bottom: 104 },
    ], 2);

    expect(layout).toEqual({ maxHeight: 64, hiddenCount: 2 });
  });

  it('groups tops at the tolerance boundary but not beyond it', { tags: ['edge-case'] }, () => {
    const items = [
      { top: 10, bottom: 30 },
      { top: 11, bottom: 31 },
      { top: 11.01, bottom: 32 },
    ];
    expect(collapsedChipLayout(items, 1, 1)).toEqual({ maxHeight: 31, hiddenCount: 1 });
    expect(collapsedChipLayout(items, 1, 1.01)).toEqual({ maxHeight: 32, hiddenCount: 0 });
  });

  it('hides every chip when maxRows is zero or negative', { tags: ['important', 'edge-case'] }, () => {
    const items = [
      { top: 0, bottom: 20 },
      { top: 0, bottom: 20 },
      { top: 30, bottom: 50 },
    ];
    expect(collapsedChipLayout(items, 0)).toEqual({ maxHeight: 0, hiddenCount: 3 });
    expect(collapsedChipLayout(items, -2)).toEqual({ maxHeight: 0, hiddenCount: 3 });
  });

  it('returns an empty layout for no chips and shows all rows by default', { tags: ['smoke'] }, () => {
    expect(collapsedChipLayout([])).toEqual({ maxHeight: 0, hiddenCount: 0 });
    expect(collapsedChipLayout([
      { top: 0, bottom: 20 },
      { top: 30, bottom: 50 },
      { top: 60, bottom: 80 },
    ])).toEqual({ maxHeight: 80, hiddenCount: 0 });
  });
});

describe('chipListMaxHeight', { tags: ['agent-chat', 'chip-overflow', 'logic'] }, () => {
  it('uses the measured height for wrapped chips even when none are hidden', { tags: ['important'] }, () => {
    const layout = collapsedChipLayout([
      { top: 0, bottom: 32 },
      { top: 40, bottom: 60 },
      { top: 68, bottom: 108 },
    ]);

    expect(layout.hiddenCount).toBe(0);
    expect(chipListMaxHeight(false, layout, 'nominal-height')).toBe(108);
  });

  it('uses the fallback before measurement and removes the cap while expanded', { tags: ['smoke'] }, () => {
    const layout = { maxHeight: 76, hiddenCount: 2 };

    expect(chipListMaxHeight(false, null, 'nominal-height')).toBe('nominal-height');
    expect(chipListMaxHeight(false, layout, 'nominal-height')).toBe(76);
    expect(chipListMaxHeight(true, layout, 'nominal-height')).toBeUndefined();
    expect(chipListMaxHeight(false, layout, 'nominal-height')).toBe(76);
  });
});
