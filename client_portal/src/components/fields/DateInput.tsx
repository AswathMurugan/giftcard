import { DatePicker } from '@/components/ui/date-picker';
import { parseDateOnly, toDateOnlyString } from '@/lib/field-format';

/**
 * Date field storing a `yyyy-MM-dd` STRING (TZ-safe round-trip through the
 * DatePicker via `parseDateOnly`/`toDateOnlyString`). For a date of birth use
 * `noFuture` (caps selection at today). RHF-agnostic: plain `value`/`onChange`
 * — wrap in a `Controller` if needed.
 */
export function DateInput({
  id,
  value,
  onChange,
  placeholder,
  required,
  hasError,
  disabled,
  noFuture,
  minDate,
  maxDate,
}: {
  id?: string;
  /** Stored date string `yyyy-MM-dd` (or empty). */
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** Draws the gold required left-bar marker on the trigger. */
  required?: boolean;
  hasError?: boolean;
  disabled?: boolean;
  /** Disallow dates after today (e.g. date of birth). */
  noFuture?: boolean;
  /** Earliest selectable date (inclusive). */
  minDate?: Date;
  /** Latest selectable date (inclusive). Overridden by `noFuture`. */
  maxDate?: Date;
}) {
  return (
    <DatePicker
      id={id}
      required={required}
      className={`h-[2.5rem] font-normal${hasError ? ' border-destructive' : ''}`}
      placeholder={placeholder ?? 'Select date'}
      disabled={disabled ?? false}
      minDate={minDate}
      maxDate={noFuture ? new Date() : maxDate}
      value={parseDateOnly(value)}
      onChange={(d) => onChange(toDateOnlyString(d))}
    />
  );
}
