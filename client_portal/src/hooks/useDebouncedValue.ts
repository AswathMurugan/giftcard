import { useEffect, useState } from 'react';

/**
 * Returns a debounced copy of `value` that only updates after `delayMs` has
 * elapsed without a change. Use for search-as-you-type inputs that drive a
 * saved-query filter — never hand-roll the `term → setTimeout → debounced`
 * pattern in page code.
 *
 * The initial render returns `value` unchanged, each subsequent change
 * schedules a single trailing update, and an in-flight timer is cleared on
 * the next change / unmount.
 *
 * @param value    the fast-changing source value (e.g. a search term)
 * @param delayMs  debounce window in milliseconds (default 300)
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}
