import { Input } from '@/components/ui/input';
import type { Slot } from '@/config/customization/types';

/**
 * Email input with the right keyboard/autocomplete hints. Format validation
 * belongs in the form's schema via `isValidEmail` from `@/lib/field-format`
 * (this control doesn't block typing). RHF-agnostic: plain `value`/`onChange`
 * — wrap in a `Controller`, or use RHF `register` on a bare `Input` instead.
 */
export function EmailInput({
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
      type="email"
      inputMode="email"
      autoComplete="email"
      placeholder={placeholder ?? 'name@example.com'}
      required={required}
      aria-invalid={hasError || undefined}
      className={`h-[2.5rem] font-normal aria-invalid:ring-0${hasError ? ' pr-9' : ''}`}
      value={value ?? ''}
      onBlur={onBlur}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
