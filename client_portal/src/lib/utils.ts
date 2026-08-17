import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Standard shadcn/ui className helper.
 *
 * Combines clsx (conditional class composition) with tailwind-merge
 * (resolves Tailwind conflicts so the last value wins, e.g.
 * `cn('px-2', 'px-4')` → `'px-4'`).
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
