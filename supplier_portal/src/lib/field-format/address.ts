// Pure, DOM-free address helpers (node-testable). Shared by every app's
// address blocks — do NOT re-implement these in page code.
//
// The address value follows the `address` entity shape via the
// useAddressAutofill hook's AddressValue (snake_case + country/state link
// wrappers + is_us_address).
//
// WHAT STAYS APP-SIDE: the admin-preference layer that RESOLVES an
// AddressConfig for a page (pref names like `App.Screen.<page>.<slot>.…` and
// their parsers) is app identity — apps overlay prefs onto
// `defaultAddressConfig()` themselves. Likewise the country/state OPTION DATA
// comes from each app's own saved queries; the `toCountryOptions` /
// `toStateOptions` mappers here shape those rows for the shared dropdowns.
import { z } from 'zod';
import type { AddressValue, CountryOption, StateOption } from '@/hooks/useAddressAutofill';
import { usStateAbbrev } from '@/hooks/useAddressAutofill';
import { postalComplete, type PostalFormat } from './postal';

// ── config shape ─────────────────────────────────────────────────────────────

export const STATE_MODES = ['auto', 'stateOnly', 'stateOrProvince'] as const;
export type StateMode = (typeof STATE_MODES)[number];

export type AddressSubKey = 'line_1' | 'line_2' | 'city' | 'state' | 'postal_code' | 'country';

export interface SubConfig {
  visible: boolean;
  required: boolean;
  label: string;
  /** postal_code only. */
  format?: PostalFormat;
  /** state only. */
  mode?: StateMode;
}
export type AddressConfig = Record<AddressSubKey, SubConfig>;

/** Sub-field metadata for a Configure UI: which props apply to each.
 *  `line_1` (the autofill anchor) and `country` (drives US detection) are
 *  structural — always visible + required; only their label is configurable. */
export const ADDRESS_SUBFIELDS: {
  key: AddressSubKey;
  defaultLabel: string;
  structural: boolean;
  special?: 'format' | 'mode';
}[] = [
  { key: 'line_1', defaultLabel: 'Address line 1', structural: true },
  { key: 'line_2', defaultLabel: 'Address line 2', structural: false },
  { key: 'city', defaultLabel: 'City', structural: false },
  { key: 'state', defaultLabel: 'State / Province', structural: false, special: 'mode' },
  { key: 'postal_code', defaultLabel: 'Postal code', structural: false, special: 'format' },
  { key: 'country', defaultLabel: 'Country', structural: true },
];

export const POSTAL_FORMAT_LABELS: Record<PostalFormat, string> = {
  auto: 'Auto (US 5-digit / intl)',
  zip5: 'ZIP — 5 digits',
  zip9: 'ZIP+4 — 5 or 9 digits',
  zip6: '6 digits',
  alnum: 'Alphanumeric',
};
export const STATE_MODE_LABELS: Record<StateMode, string> = {
  auto: 'Auto (US dropdown / intl text)',
  stateOnly: 'State (dropdown)',
  stateOrProvince: 'State or province (text)',
};

export function defaultAddressConfig(): AddressConfig {
  return {
    line_1: { visible: true, required: true, label: 'Address line 1' },
    line_2: { visible: true, required: false, label: 'Address line 2' },
    city: { visible: true, required: true, label: 'City' },
    state: { visible: true, required: true, label: 'State / Province', mode: 'auto' },
    postal_code: { visible: true, required: true, label: 'Postal code', format: 'auto' },
    country: { visible: true, required: true, label: 'Country' },
  };
}

// ── value helpers ────────────────────────────────────────────────────────────

/** A brand-new address — defaults to US so the State dropdown + ZIP show first. */
export function emptyAddress(): AddressValue {
  return { is_us_address: true };
}

// Structural row shapes — apps pass their own saved-query rows; only these
// fields are read.
type CountryListRow = {
  id?: string;
  full_name?: string;
  short_name?: string;
  code?: string;
  code_2_letters?: string;
  code_3_letters?: string;
};
type StateOrProvinceListRow = { id?: string; name?: string; code?: string; country?: { id?: string } };

/**
 * Map country rows → the hook's CountryOption (name from full/short name).
 * De-duplicates by display name: country entities often carry repeated rows for
 * the same country, which otherwise show up twice in the dropdown. First
 * occurrence wins; blank names are dropped.
 */
export function toCountryOptions(rows: readonly CountryListRow[]): CountryOption[] {
  const seen = new Set<string>();
  const out: CountryOption[] = [];
  for (const r of rows) {
    const name = r.full_name ?? r.short_name;
    const key = (name ?? '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: r.id ?? '',
      name,
      code_2_letters: r.code_2_letters,
      code_3_letters: r.code_3_letters,
    });
  }
  return out;
}

/** Map state/province rows → the hook's StateOption. */
export function toStateOptions(rows: readonly StateOrProvinceListRow[]): StateOption[] {
  return rows.map((r) => ({ id: r.id ?? '', name: r.name, code: r.code }));
}

/** Sub-field keys an address can show an inline error against. */
export type AddressErrors = Partial<
  Record<'line_1' | 'city' | 'postal_code' | 'country' | 'state' | 'state_or_province', string>
>;

/** One-line, human-readable address for a Review step (or '—' when empty). */
export function formatAddress(value: unknown): string {
  if (!value || typeof value !== 'object') return '—';
  const v = value as AddressValue;
  const isUs = v.is_us_address ?? true;
  // US addresses show the 2-letter state code (standard); non-US use the raw
  // province. `usStateAbbrev` is a no-op for non-US / already-code values.
  const region = isUs
    ? typeof v.state_name === 'string'
      ? usStateAbbrev(v.state_name)
      : v.state_name
    : v.state_or_province;
  const parts = [v.line_1, v.line_2, v.city, region, v.postal_code, v.country_name]
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean);
  return parts.length ? parts.join(', ') : '—';
}

// ── validation ───────────────────────────────────────────────────────────────

/**
 * Zod schema for one address value. `required` builds the strict schema
 * (street, city, ZIP/postal, country, and US→state / non-US→state_or_province);
 * otherwise the whole address is optional.
 *
 * `cfg` (the app-resolved AddressConfig) tunes the configurable sub-fields:
 * labels feed the messages, a hidden/optional sub-field skips its required
 * rule, `postal_code.format` gates completeness, and `state.mode` picks
 * dropdown-id vs free-text vs the auto US-detection branch. `line_1` and
 * `country` are structural (always required). Absent cfg = defaults.
 */
export function addressZod(required: boolean, cfg?: AddressConfig): z.ZodTypeAny {
  if (!required) return z.any().optional();
  const c = cfg ?? defaultAddressConfig();
  const postalRequired = c.postal_code.visible && c.postal_code.required;
  const postalFormat = c.postal_code.format ?? 'auto';
  return (
    z
      // looseObject keeps the display-only country_name / state_name keys on the
      // validated value (z.object would strip them).
      .looseObject({
        line_1: z.string().trim().min(1, `${c.line_1.label} is required`),
        line_2:
          c.line_2.visible && c.line_2.required
            ? z.string().trim().min(1, `${c.line_2.label} is required`)
            : z.string().trim().optional(),
        city:
          c.city.visible && c.city.required
            ? z.string().trim().min(1, `${c.city.label} is required`)
            : z.string().trim().optional(),
        postal_code: postalRequired
          ? z
              .string()
              .trim()
              .refine(
                (v) => v !== '' && postalComplete(v, postalFormat),
                `Enter a valid ${c.postal_code.label.toLowerCase()}`,
              )
          : z.string().trim().optional(),
        country: z.object({ id: z.string() }).nullable().optional(),
        state: z.object({ id: z.string().min(1) }).nullable().optional(),
        state_or_province: z.string().trim().optional(),
        is_us_address: z.boolean().optional(),
      })
      .superRefine((v, ctx) => {
        // Country + conditional region run once the base text fields pass (an
        // object-level superRefine reads siblings but short-circuits on base fail).
        if (!v.country?.id) {
          ctx.addIssue({ code: 'custom', path: ['country'], message: 'Country is required' });
        }
        // State/region: skipped entirely when the admin hid it or made it
        // optional; otherwise mode-aware (dropdown id / free text / auto-US).
        if (!c.state.visible || !c.state.required) return;
        const mode = c.state.mode ?? 'auto';
        if (mode === 'stateOnly') {
          if (!v.state?.id) {
            ctx.addIssue({ code: 'custom', path: ['state'], message: `${c.state.label} is required` });
          }
          return;
        }
        if (mode === 'stateOrProvince') {
          if (!v.state_or_province?.trim()) {
            ctx.addIssue({
              code: 'custom',
              path: ['state_or_province'],
              message: `${c.state.label} is required`,
            });
          }
          return;
        }
        const isUs = v.is_us_address ?? true;
        if (isUs) {
          if (!v.state?.id) {
            ctx.addIssue({ code: 'custom', path: ['state'], message: `${c.state.label} is required` });
          }
        } else if (!v.state_or_province?.trim()) {
          ctx.addIssue({
            code: 'custom',
            path: ['state_or_province'],
            message: `${c.state.label} is required`,
          });
        }
      })
  );
}

// ── required completeness (config-aware) ─────────────────────────────────────
type AddressLike = {
  line_1?: unknown;
  line_2?: unknown;
  city?: unknown;
  postal_code?: unknown;
  state_or_province?: unknown;
  state?: { id?: unknown } | null;
  country?: { id?: unknown } | null;
  is_us_address?: unknown;
};
const filled = (v: unknown): boolean => v != null && String(v).trim() !== '';

/** Missing required sub-fields given the config (hidden + optional are skipped). */
export function addressMissingFieldsFor(value: unknown, cfg: AddressConfig): string[] {
  const a = (value && typeof value === 'object' ? value : {}) as AddressLike;
  const isUs = a.is_us_address ?? true;
  const missing: string[] = [];

  if (!filled(a.line_1)) missing.push('line_1'); // structural
  if (cfg.line_2.visible && cfg.line_2.required && !filled(a.line_2)) missing.push('line_2');
  if (cfg.city.visible && cfg.city.required && !filled(a.city)) missing.push('city');
  if (!filled(a.country?.id)) missing.push('country'); // structural

  if (cfg.state.visible && cfg.state.required) {
    const mode = cfg.state.mode ?? 'auto';
    const ok =
      mode === 'stateOrProvince'
        ? filled(a.state_or_province)
        : mode === 'stateOnly'
          ? filled(a.state?.id)
          : isUs
            ? filled(a.state?.id)
            : filled(a.state_or_province);
    if (!ok) missing.push('state');
  }

  if (cfg.postal_code.visible && cfg.postal_code.required) {
    if (!postalComplete(String(a.postal_code ?? ''), cfg.postal_code.format ?? 'auto')) {
      missing.push('postal_code');
    }
  }
  return missing;
}

export function isAddressCompleteFor(value: unknown, cfg: AddressConfig): boolean {
  return addressMissingFieldsFor(value, cfg).length === 0;
}
