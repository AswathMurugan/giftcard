import { Input } from '@/components/ui/input';
import type { Slot } from '@/config/customization/types';
import { formatMoneyDisplay, sanitizeMoney } from '@/lib/field-format';

/**
 * USD money input with a `$` prefix. Stores a sanitized plain string (digits +
 * one dot, max 2 decimals — validate with `MONEY_RE`) while DISPLAYING
 * thousands separators. RHF-agnostic: plain `value`/`onChange` — wrap in a
 * `Controller` if needed.
 */
export function CurrencyInput({
  id,
  config,
  value,
  onChange,
  onBlur,
  placeholder,
  required,
  hasError,
  'aria-label': ariaLabel,
}: {
  id?: string;
  /** Admin-customization slot (see `buildSchema`). */
  config?: Slot;
  /** Stored money string, e.g. `"1234.50"`. */
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  /** Draws the gold required left-bar marker on the input. */
  required?: boolean;
  /** Red border + room for the shared ErrorIcon overlay. */
  hasError?: boolean;
  /** Accessible name when no visible label is associated. */
  'aria-label'?: string;
}) {
  return (
    <div className="relative">
      {/* z-10: a required Input renders inside its own `relative` wrapper
          (overlay-bar), which would otherwise paint its opaque bg over this
          absolutely-positioned prefix — keep the $ on top. */}
      <span className="pointer-events-none absolute left-[0.75rem] top-1/2 z-10 -translate-y-1/2 text-[1rem] text-muted-foreground">
        $
      </span>
      <Input
        id={id}
        aria-label={ariaLabel}
        config={config}
        inputMode="decimal"
        placeholder={placeholder ?? '0.00'}
        required={required}
        aria-invalid={hasError || undefined}
        className={`h-[2.5rem] pl-[1.625rem] font-normal aria-invalid:ring-0${hasError ? ' pr-9' : ''}`}
        value={formatMoneyDisplay(value)}
        onBlur={onBlur}
        onChange={(e) => onChange(sanitizeMoney(e.target.value))}
      />
    </div>
  );
}
