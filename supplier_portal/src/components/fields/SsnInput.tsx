import { useState } from 'react';
import { Input } from '@/components/ui/input';
import type { Slot } from '@/config/customization/types';
import { formatSsn, isCompleteSsn, maskSsnInput } from '@/lib/field-format';

/**
 * What the SSN input should currently display: masked (`***-**-6789`) when a
 * complete value is neither revealed nor being edited; the real value
 * otherwise. Pure → unit-testable.
 */
export function ssnDisplay(value: string, revealed: boolean, focused: boolean): string {
  const masked = !revealed && !focused && isCompleteSsn(value);
  return masked ? maskSsnInput(value) : (value ?? '');
}

/**
 * SSN input that masks all but the last 4 digits (`***-**-6789`) by default and
 * reveals the full value on the eye toggle. While focused (entering), the real
 * value is shown so it stays editable; on blur a complete value re-masks.
 * RHF-agnostic: plain `value`/`onChange` — wrap in a `Controller` if needed.
 */
export function SsnInput({
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
  /** Red border + "!" indicator (left of the eye toggle). */
  hasError?: boolean;
  /** Accessible name when no visible label is associated. */
  'aria-label'?: string;
}) {
  const [revealed, setRevealed] = useState(false);
  const [focused, setFocused] = useState(false);

  return (
    <div className="relative">
      <Input
        id={id}
        aria-label={ariaLabel}
        config={config}
        required={required}
        aria-invalid={hasError || undefined}
        inputMode="numeric"
        autoComplete="off"
        placeholder={placeholder ?? 'XXX-XX-XXXX'}
        className={`h-[2.5rem] font-normal aria-invalid:ring-0 ${hasError ? 'pr-16' : 'pr-10'}`}
        value={ssnDisplay(value, revealed, focused)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          onBlur?.();
        }}
        onChange={(e) => onChange(formatSsn(e.target.value))}
      />
      {/* Error "!" indicator — placed LEFT of the eye toggle so both fit. */}
      {hasError && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-[2.5rem] top-1/2 z-10 grid size-[1.125rem] -translate-y-1/2 place-content-center rounded-full bg-danger-600 text-[0.6875rem] font-bold leading-none text-white"
        >
          !
        </span>
      )}
      {/* Deliberately out of the tab order (tabIndex={-1}): keyboard users
          already see the full value the moment the input itself is focused
          (the `focused` state unmasks it), so a tab stop here would only add
          friction between form fields. The toggle is a pointer affordance. */}
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setRevealed((r) => !r)}
        aria-label={revealed ? 'Hide SSN' : 'Show SSN'}
        aria-pressed={revealed}
        className="absolute inset-y-0 right-0 grid w-[2.5rem] place-content-center rounded-r-lg text-muted-foreground hover:text-foreground"
      >
        <i className={`icon ${revealed ? 'icon_-Tb_eye' : 'icon_-Tb_eye_off'} text-[1.125rem]`} aria-hidden="true" />
      </button>
    </div>
  );
}
