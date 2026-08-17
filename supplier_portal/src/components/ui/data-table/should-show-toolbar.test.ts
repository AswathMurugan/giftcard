import { describe, it, expect } from 'vitest';
import { shouldShowToolbar } from './DataTable';

describe('DataTable shouldShowToolbar', { tags: ['data-table', 'logic'] }, () => {
  it('hides when hideToolbar is set, regardless of slots', { tags: ['important'] }, () => {
    expect(
      shouldShowToolbar({
        hideToolbar: true,
        hasTitle: true,
        hideSearch: false,
        hideColumnsToggle: false,
      }),
    ).toBe(false);
  });

  it('shows when a title is present even if search + columns are hidden', () => {
    expect(
      shouldShowToolbar({
        hasTitle: true,
        hideSearch: true,
        hideColumnsToggle: true,
      }),
    ).toBe(true);
  });

  it('shows when search is available', () => {
    expect(
      shouldShowToolbar({ hasTitle: false, hideSearch: false, hideColumnsToggle: true }),
    ).toBe(true);
  });

  it('shows when the columns toggle is available', () => {
    expect(
      shouldShowToolbar({ hasTitle: false, hideSearch: true, hideColumnsToggle: false }),
    ).toBe(true);
  });

  it('shows when toolbarLeft content is present even if all else is hidden', () => {
    expect(
      shouldShowToolbar({
        hasTitle: false,
        hasToolbarLeft: true,
        hideSearch: true,
        hideColumnsToggle: true,
      }),
    ).toBe(true);
  });

  it('shows when toolbarRight content is present even if all else is hidden', () => {
    expect(
      shouldShowToolbar({
        hasTitle: false,
        hasToolbarRight: true,
        hideSearch: true,
        hideColumnsToggle: true,
      }),
    ).toBe(true);
  });

  it('hides when every slot is empty', { tags: ['edge-case'] }, () => {
    expect(
      shouldShowToolbar({
        hasTitle: false,
        hasToolbarLeft: false,
        hasToolbarRight: false,
        hideSearch: true,
        hideColumnsToggle: true,
      }),
    ).toBe(false);
  });
});
