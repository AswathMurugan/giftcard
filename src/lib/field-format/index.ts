// Barrel for the shared field format/validation helpers. Import from
// `@/lib/field-format` — never re-implement phone/SSN/EIN/email/money/date/
// postal formatting in page code.
export { formatPhone, isCompletePhone } from './phone';
export { SSN_RE, formatSsn, isCompleteSsn, maskSsn, maskSsnInput } from './ssn';
export { EIN_RE, formatEin, isCompleteEin } from './ein';
export { EMAIL_RE, isValidEmail } from './email';
export { MONEY_RE, sanitizeMoney, formatMoneyDisplay, formatUsd } from './currency';
export type { FormatUsdOptions } from './currency';
export { parseDateOnly, toDateOnlyString, formatDate, formatDateTime } from './date';
export { POSTAL_FORMATS, validatePostalForFormat, postalPlaceholder, postalComplete } from './postal';
export type { PostalFormat } from './postal';
export {
  STATE_MODES,
  ADDRESS_SUBFIELDS,
  POSTAL_FORMAT_LABELS,
  STATE_MODE_LABELS,
  defaultAddressConfig,
  emptyAddress,
  toCountryOptions,
  toStateOptions,
  formatAddress,
  addressZod,
  addressMissingFieldsFor,
  isAddressCompleteFor,
} from './address';
export type { StateMode, AddressSubKey, SubConfig, AddressConfig, AddressErrors } from './address';
