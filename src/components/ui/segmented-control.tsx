import { useRef, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';

// SegmentedControl — the design system's `.jf-seg` component (a pill/rect row
// of mutually-exclusive segments). Selected segment = cream primary-50 fill +
// primary-300 gold border + weight 600; neighbors keep neutral borders with a
// single shared edge (no double hairlines). Sizes sm/md/lg = 13/15/17px text
// per the DS component spec. Use it for enum choices, Yes/No questions, and
// view switches — never hand-roll a pill radio row in page code.
//
// A11y: role="radiogroup"/"radio" with arrow-key navigation (Left/Up = prev,
// Right/Down = next, wrapping, skipping disabled segments).

export interface SegmentedControlOption {
  value: string;
  /** Display label — defaults to `value`. */
  label?: string;
  /** Optional leading Nucleo glyph class (e.g. `icon_-Tb_list`). */
  icon?: string;
  disabled?: boolean;
  /** Accessible name for an icon-only segment. */
  'aria-label'?: string;
}

/** Normalize `string | SegmentedControlOption` inputs. Pure → testable. */
export function normalizeSegOptions(
  options: readonly (string | SegmentedControlOption)[],
): SegmentedControlOption[] {
  return options.map((o) =>
    typeof o === 'string' ? { value: o, label: o } : { ...o, label: o.label ?? o.value },
  );
}

/**
 * Index of the next enabled option stepping `dir` from `current`, wrapping.
 * Returns `current` when every other option is disabled. Pure → testable.
 */
export function nextSegIndex(
  current: number,
  dir: 1 | -1,
  options: readonly { disabled?: boolean }[],
): number {
  const n = options.length;
  if (n === 0) return current;
  let i = current;
  for (let step = 0; step < n; step++) {
    i = (i + dir + n) % n;
    if (!options[i]?.disabled) return i;
  }
  return current;
}

const TEXT_SIZE = {
  sm: 'px-[0.75rem] py-[0.375rem] text-[0.8125rem]',
  md: 'px-[1.125rem] py-[0.625rem] text-[0.9375rem]',
  lg: 'px-[1.375rem] py-[0.8125rem] text-[1.0625rem]',
} as const;
const ICONS_SIZE = {
  sm: 'px-[0.625rem] py-[0.5rem]',
  md: 'px-[0.875rem] py-[0.625rem]',
  lg: 'px-[1rem] py-[0.875rem]',
} as const;
const ICON_GLYPH = { sm: 'text-[1rem]', md: 'text-[1.25rem]', lg: 'text-[1.25rem]' } as const;

export function SegmentedControl({
  id,
  value,
  options,
  onValueChange,
  size = 'md',
  variant = 'text',
  disabled = false,
  className,
  'aria-label': ariaLabel,
}: {
  id?: string;
  value: string;
  options: readonly (string | SegmentedControlOption)[];
  onValueChange: (v: string) => void;
  /** 13px / 15px / 17px text per the DS spec. */
  size?: 'sm' | 'md' | 'lg';
  /** `text` = pill (999 radius); `icons` = rounded rect (10px radius). */
  variant?: 'text' | 'icons';
  /** Disables the whole control (per-option via option.disabled). */
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}) {
  const opts = normalizeSegOptions(options);
  const selectedIndex = opts.findIndex((o) => o.value === value);
  const rootRef = useRef<HTMLDivElement>(null);
  const pill = variant === 'text';

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    let dir: 1 | -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') dir = 1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') dir = -1;
    else return;
    e.preventDefault();
    const next = nextSegIndex(index, dir, opts);
    if (next === index) return;
    onValueChange(opts[next].value);
    rootRef.current
      ?.querySelector<HTMLButtonElement>(`[data-seg-index="${next}"]`)
      ?.focus();
  }

  return (
    <div
      ref={rootRef}
      id={id}
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex w-fit bg-card',
        pill ? 'rounded-full' : 'rounded-[0.625rem]',
        className,
      )}
    >
      {opts.map((o, i) => {
        const selected = i === selectedIndex;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={o['aria-label']}
            data-seg-index={i}
            disabled={disabled || o.disabled}
            onClick={() => onValueChange(o.value)}
            onKeyDown={(e) => handleKeyDown(e, i)}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 leading-[1.2] tracking-[0.01em]',
              variant === 'text' ? TEXT_SIZE[size] : ICONS_SIZE[size],
              // Single shared edge: every segment draws top/bottom/right; only
              // the first also draws its left. The segment BEFORE the selected
              // one paints the shared edge gold (`border-r-primary-300`).
              'border-y border-r',
              i === 0 && 'border-l',
              pill
                ? 'first:rounded-l-full last:rounded-r-full'
                : 'first:rounded-l-[0.625rem] last:rounded-r-[0.625rem]',
              // Dark mode mirrors the sibling segment pattern (GridViewSwitcher's
              // ViewSegment): selected = primary-500/20 tint + foreground ink
              // (grayscale-900 would vanish on the flipped primary-50).
              selected
                ? 'z-[1] border-primary-300 bg-primary-50 font-semibold text-grayscale-900 dark:bg-primary-500/20 dark:text-foreground'
                : 'border-grayscale-300 bg-card font-normal text-foreground hover:bg-grayscale-50 dark:border-grayscale-700 dark:hover:bg-grayscale-800',
              // The segment BEFORE the selected one owns their shared edge —
              // paint it gold so the selected segment reads fully gold-bordered.
              !selected && i + 1 === selectedIndex && 'border-r-primary-300',
              'focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-300',
              'disabled:cursor-not-allowed disabled:bg-grayscale-100 disabled:text-grayscale-400 dark:disabled:bg-grayscale-800',
              'transition-colors',
            )}
          >
            {o.icon && (
              <i
                className={cn(
                  'icon',
                  o.icon,
                  ICON_GLYPH[size],
                  'leading-none',
                  selected ? 'text-grayscale-900 dark:text-foreground' : 'text-grayscale-500',
                )}
                aria-hidden="true"
              />
            )}
            {variant === 'text' && o.label}
          </button>
        );
      })}
    </div>
  );
}
