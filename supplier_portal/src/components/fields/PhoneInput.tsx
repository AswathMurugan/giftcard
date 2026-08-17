import { Input } from '@/components/ui/input';
import type { Slot } from '@/config/customization/types';
import { formatPhone } from '@/lib/field-format';

/**
 * Next stored value for a phone input given the raw DOM value and the current
 * stored value. Live-formats to `+1 (XXX) XXX-XXXX` and fixes the backspace
 * trap: deleting trailing punctuation (e.g. the ")" after the area code) just
 * gets re-added by the formatter — detect that (shorter input, same formatted
 * result) and drop the last DIGIT instead so delete works. Pure → testable.
 */
export function nextPhoneValue(raw: string, current: string): string {
  let next = formatPhone(raw);
  if (raw.length < current.length && next === current) {
    next = formatPhone(raw.replace(/\d(?=[^\d]*$)/, ''));
  }
  return next;
}

/**
 * US phone input, live-formatted to `+1 (XXX) XXX-XXXX`. RHF-agnostic:
 * plain `value`/`onChange` — wrap in a `Controller` if needed. Validate
 * completeness with `isCompletePhone` from `@/lib/field-format`.
 */
export function PhoneInput({
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
    <Input
      id={id}
      aria-label={ariaLabel}
      config={config}
      inputMode="tel"
      autoComplete="tel"
      maxLength={17}
      placeholder={placeholder ?? '+1 (___) ___-____'}
      required={required}
      aria-invalid={hasError || undefined}
      className={`h-[2.5rem] font-normal aria-invalid:ring-0${hasError ? ' pr-9' : ''}`}
      value={value ?? ''}
      onBlur={onBlur}
      onChange={(e) => onChange(nextPhoneValue(e.target.value, value ?? ''))}
    />
  );
}
