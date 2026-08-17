import { Input } from '@/components/ui/input';
import type { Slot } from '@/config/customization/types';
import { formatEin } from '@/lib/field-format';

/**
 * US EIN input, live-formatted to `XX-XXXXXXX`. RHF-agnostic: plain
 * `value`/`onChange` — wrap in a `Controller` if needed. Validate
 * completeness with `isCompleteEin` from `@/lib/field-format`.
 */
export function EinInput({
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
      inputMode="numeric"
      autoComplete="off"
      maxLength={10}
      placeholder={placeholder ?? 'XX-XXXXXXX'}
      required={required}
      aria-invalid={hasError || undefined}
      className={`h-[2.5rem] font-normal aria-invalid:ring-0${hasError ? ' pr-9' : ''}`}
      value={value ?? ''}
      onBlur={onBlur}
      onChange={(e) => onChange(formatEin(e.target.value))}
    />
  );
}
