import { describe, expect, it } from 'vitest';
import { isNearScrollEnd, scrollPinAfterScroll } from './scroll-position';

describe('agent chat scroll position', { tags: ['agent-chat', 'logic'] }, () => {
  it('keeps a viewport pinned while it is near the bottom', { tags: ['important'] }, () => {
    expect(isNearScrollEnd({ scrollHeight: 500, scrollTop: 270, clientHeight: 200 })).toBe(true);
    expect(isNearScrollEnd({ scrollHeight: 500, scrollTop: 268, clientHeight: 200 })).toBe(true);
  });

  it('allows a user who scrolled up to keep their position', { tags: ['edge-case'] }, () => {
    expect(isNearScrollEnd({ scrollHeight: 500, scrollTop: 200, clientHeight: 200 })).toBe(false);
  });

  it('does not unpin on an intermediate smooth-scroll event', { tags: ['important'] }, () => {
    expect(scrollPinAfterScroll(
      { scrollHeight: 900, scrollTop: 300, clientHeight: 400 },
      true,
    )).toEqual({ pinned: true, programmatic: true });
    expect(scrollPinAfterScroll(
      { scrollHeight: 900, scrollTop: 500, clientHeight: 400 },
      true,
    )).toEqual({ pinned: true, programmatic: false });
  });

  it('unpins a user-driven scroll away from the end', { tags: ['edge-case'] }, () => {
    expect(scrollPinAfterScroll(
      { scrollHeight: 900, scrollTop: 300, clientHeight: 400 },
      false,
    )).toEqual({ pinned: false, programmatic: false });
  });
});
