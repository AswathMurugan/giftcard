// Barrel for the shared atomic field components. Import from
// `@/components/fields` — NEVER hand-roll a phone/SSN/EIN/currency/email/date
// input or a field error treatment in page code; these encode the design
// system's masking, formatting, and error affordances once.
//
// All controls are RHF-agnostic (plain `value`/`onChange`): wrap in a
// react-hook-form `Controller` when used inside a form. Pair validation with
// the pure helpers in `@/lib/field-format` (isCompletePhone, isCompleteSsn,
// isValidEmail, MONEY_RE, …).
export { ErrorIcon, ErrorBox, RequiredMark } from './field-error';
export { SsnInput, ssnDisplay } from './SsnInput';
export { PhoneInput, nextPhoneValue } from './PhoneInput';
export { EinInput } from './EinInput';
export { CurrencyInput } from './CurrencyInput';
export { EmailInput } from './EmailInput';
export { DateInput } from './DateInput';
