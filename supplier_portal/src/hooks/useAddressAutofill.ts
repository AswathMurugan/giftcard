/**
 * useAddressAutofill — Mapbox-powered address autocomplete.
 *
 * Read `src/queries/ADDRESS.md` FIRST before building any address capture.
 *
 * This hook is the ONLY sanctioned way to capture a postal address. Do NOT
 * hand-roll line1/line2/city/state/country inputs — wire an autocomplete field
 * to this hook, then bind the selected `AddressValue` onto the `address`
 * entity. There is NO Address UI component in this starter (by design); you
 * compose `Input` + `Select` yourself and drive them from this hook.
 *
 * Mechanism: the starter has no Mapbox SDK and cannot `npm install`, so this
 * talks to the Mapbox Search Box API v2 over native `fetch`:
 *   - GET /search/searchbox/v1/suggest  (autocomplete; 400ms debounced)
 *   - GET /search/searchbox/v1/retrieve (full address on selection)
 * A session token (one UUID per hook instance) groups suggest+retrieve into a
 * single billable session, per Mapbox guidance.
 *
 * Graceful degradation: if no token is configured or any request fails,
 * `isAvailable` flips to `false` and `suggestions` stays empty — the caller
 * should fall back to plain manual entry (still fully usable).
 *
 * Country/state link resolution: Mapbox returns names/codes, but the `address`
 * entity stores `country` and `state` as ENTITY LINKS (`{ id }`). Pass the
 * tenant's country/state option lists (loaded via a saved query — see
 * ADDRESS.md) so the hook can resolve the right link id. Output is shaped to
 * the starter `address` entity (snake_case: `line_1`, `postal_code`,
 * `state_or_province`, `country: { id }`, `state: { id }`, `is_us_address`).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

// ── Constants ────────────────────────────────────────────────────────────────

/** Debounce before firing a `suggest` request, in ms. */
export const MAPBOX_DEBOUNCE_MS = 400;

/** ISO 3166-1 alpha-2 code that toggles US-specific behaviour. */
export const US_COUNTRY_CODE = 'US';

/**
 * No token is baked in. Set `VITE_MAPBOX_TOKEN` in `.env` (gitignored), or
 * pass the `token` option at call time.
 *
 * A Mapbox public (`pk.`) token IS designed to be embedded in client code, so
 * shipping one in a build is fine — but committing it to the repository is
 * not: GitHub push protection rejects it, and a token in git history outlives
 * whatever deployment it was scoped for. Keep it in the environment, where it
 * can be rotated and restricted per deployment.
 *
 * Empty means address autofill is inert rather than broken — the hook reports
 * a missing token instead of calling Mapbox unauthenticated.
 */
export const DEFAULT_MAPBOX_TOKEN = '';

const MAPBOX_SUGGEST_URL = 'https://api.mapbox.com/search/searchbox/v1/suggest';
const MAPBOX_RETRIEVE_URL = 'https://api.mapbox.com/search/searchbox/v1/retrieve';

/**
 * One session token per hook instance, grouping suggest+retrieve calls into a
 * single Mapbox billing session. Impure by nature, so it is produced in a
 * `useState` lazy initializer rather than during render.
 */
export function createSessionToken(
  cryptoSource: Crypto | null = globalThis.crypto,
): string {
  if (typeof cryptoSource?.randomUUID === 'function') {
    return cryptoSource.randomUUID();
  }
  if (typeof cryptoSource?.getRandomValues !== 'function') {
    throw new Error('Web Crypto is required to create a Mapbox session token');
  }

  const bytes = cryptoSource.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function resolveToken(explicit?: string): string {
  if (explicit) return explicit;
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_MAPBOX_TOKEN || DEFAULT_MAPBOX_TOKEN;
}

// ── Types ────────────────────────────────────────────────────────────────────

/** A country option for the country dropdown (from the wealthdomain `country` entity). */
export interface CountryOption {
  id: string;
  /** Display name. Maps to `full_name`/`short_name` on the entity. */
  name?: string;
  code_2_letters?: string;
  code_3_letters?: string;
}

/** A state/province option (from the wealthdomain `state_or_province` entity). */
export interface StateOption {
  id: string;
  name?: string;
  code?: string;
}

/** One autocomplete suggestion row. `raw` is passed back to `retrieve`. */
export interface AddressSuggestion {
  label: string;
  line_1: string;
  city: string;
  state: string;
  postal_code: string;
  country_code: string;
  /** Mapbox `mapbox_id` needed by the retrieve call. */
  mapbox_id: string;
  raw: unknown;
}

/**
 * Resolved address, shaped to the starter `address` entity. Bind these onto
 * your form/insert payload directly (country/state are entity links).
 */
export interface AddressValue {
  line_1?: string;
  line_2?: string;
  city?: string;
  postal_code?: string;
  /** Free-text state/province (used for non-US, and as a raw fallback). */
  state_or_province?: string;
  /** State entity link (US only, when resolvable from `stateList`). */
  state?: { id: string } | null;
  /** Country entity link (when resolvable from `countryList`). */
  country?: { id: string } | null;
  is_us_address?: boolean;
  /** Raw Mapbox names, kept for display / debugging (not persisted as links). */
  country_name?: string;
  state_name?: string;
}

// ── Mapbox response shape (Search Box API v2) ────────────────────────────────
// https://docs.mapbox.com/api/search/search-box/

interface MapboxContext {
  country?: { name?: string; country_code?: string; country_code_alpha_3?: string };
  region?: { name?: string; region_code?: string };
  place?: { name?: string };
  locality?: { name?: string };
  postcode?: { name?: string };
  address?: { name?: string; address_number?: string };
  street?: { name?: string };
}

interface MapboxSuggestion {
  name?: string;
  mapbox_id?: string;
  feature_type?: string;
  place_formatted?: string;
  full_address?: string;
  address?: string;
  context?: MapboxContext;
  [key: string]: unknown;
}

interface MapboxFeatureProperties {
  name?: string;
  full_address?: string;
  address?: string;
  context?: MapboxContext;
  [key: string]: unknown;
}

// ── Pure helpers (exported for testing) ──────────────────────────────────────

export function isUsCountryCode(code2: string | undefined): boolean {
  return !!code2 && code2.toUpperCase() === US_COUNTRY_CODE;
}

/**
 * Multi-signal US detection for an ENTITY-derived country (the `country` entity
 * / a prefilled address), where a single code field is unreliable.
 *
 * Do NOT key US-detection off `code_2_letters` alone: a tenant's US row may not
 * store it as "US" (or store it at all). Check the ISO-2 code, the ISO-3 code,
 * and the country name ("united states") — the name is the reliable fallback.
 *
 * (For the Mapbox autofill path use `isUsCountryCode(country_code)` — Mapbox
 * reliably returns an ISO-2 code there.)
 */
export function isUsCountry(
  country:
    | { code_2_letters?: string; code_3_letters?: string; name?: string; full_name?: string }
    | null
    | undefined,
  fallbackName?: string,
): boolean {
  const code2 = country?.code_2_letters?.toUpperCase();
  const code3 = country?.code_3_letters?.toUpperCase();
  const name = (country?.name ?? country?.full_name ?? fallbackName ?? '').toLowerCase();
  return code2 === 'US' || code3 === 'USA' || name.includes('united states');
}

export function findCountryByCode2(
  countryList: CountryOption[],
  code2: string,
): CountryOption | undefined {
  if (!code2) return undefined;
  return countryList.find((c) => c.code_2_letters?.toUpperCase() === code2.toUpperCase());
}

export function findCountryByName(
  countryList: CountryOption[],
  name: string,
): CountryOption | undefined {
  if (!name) return undefined;
  const search = name.toLowerCase();
  return countryList.find((c) => {
    const lower = (c.name ?? '').toLowerCase();
    return lower === search || lower.startsWith(search) || lower.includes(search);
  });
}

export function resolveStateOption(
  regionName: string,
  stateList: StateOption[],
): StateOption | undefined {
  if (!regionName || stateList.length === 0) return undefined;
  // Prefilled addresses often store the state as its link id (a UUID) in the
  // free-text `state_or_province` slot, so match by id first; then fall back to
  // the name/code match used when resolving a Mapbox-autocompleted address.
  const byId = stateList.find((s) => s.id === regionName);
  if (byId) return byId;
  const byName = stateList.find((s) => s.name?.toLowerCase() === regionName.toLowerCase());
  if (byName) return byName;
  return stateList.find((s) => s.code?.toUpperCase() === regionName.toUpperCase());
}

/** US-first then alphabetical, for the country dropdown. */
export function sortCountriesUsFirst(countries: CountryOption[]): CountryOption[] {
  return [...countries].sort((a, b) => {
    // Entity-derived rows — multi-signal (code_2_letters may not be "US").
    const aUs = isUsCountry(a);
    const bUs = isUsCountry(b);
    if (aUs && !bUs) return -1;
    if (!aUs && bUs) return 1;
    return (a.name ?? '').localeCompare(b.name ?? '');
  });
}

/** Validate + clamp a postal code. US: 5 digits; other: alphanumeric + space/dash, max 10. */
export function validatePostalCode(input: string, isUs: boolean): string {
  if (isUs) return input.replace(/\D/g, '').slice(0, 5);
  return input.replace(/[^A-Za-z0-9\s-]/g, '').slice(0, 10);
}

// US state / territory full-name → 2-letter postal code. Address DISPLAYS should
// show the code ("San Antonio, TX 78213"), which is the standard for US
// addresses. Keyed by lowercased full name; a value that is already a code, or a
// non-US region, is returned unchanged. Use when formatting an address for
// display (the state <Select> input still shows full names for selection).
const US_STATE_ABBREV: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
  wyoming: 'WY',
  'district of columbia': 'DC', 'washington dc': 'DC', 'washington d.c.': 'DC',
  'puerto rico': 'PR', guam: 'GU', 'u.s. virgin islands': 'VI',
  'virgin islands': 'VI', 'american samoa': 'AS', 'northern mariana islands': 'MP',
};

/**
 * Convert a US state's full name to its 2-letter postal code (case-insensitive).
 * Anything not a recognized US state — a code already, a non-US province, empty —
 * is returned trimmed and unchanged, so it's safe to call on any region string.
 */
export function usStateAbbrev(name: string): string {
  const trimmed = name.trim();
  return US_STATE_ABBREV[trimmed.toLowerCase()] ?? trimmed;
}

export function formatSuggestionLabel(s: MapboxSuggestion): string {
  if (s.full_address) return s.full_address;
  if (s.place_formatted) {
    return s.name ? `${s.name}, ${s.place_formatted}` : s.place_formatted;
  }
  const ctx = s.context;
  return [
    s.name,
    ctx?.place?.name ?? ctx?.locality?.name,
    ctx?.region?.name,
    ctx?.postcode?.name,
    ctx?.country?.country_code,
  ]
    .filter(Boolean)
    .join(', ');
}

export function mapSuggestion(s: MapboxSuggestion): AddressSuggestion {
  const ctx = s.context;
  return {
    label: formatSuggestionLabel(s),
    line_1: s.address ?? ctx?.address?.name ?? s.name ?? '',
    city: ctx?.place?.name ?? ctx?.locality?.name ?? '',
    state: ctx?.region?.name ?? '',
    postal_code: ctx?.postcode?.name ?? '',
    country_code: ctx?.country?.country_code ?? '',
    mapbox_id: s.mapbox_id ?? '',
    raw: s,
  };
}

/** Map a retrieved Mapbox feature's properties onto the `address` entity shape. */
export function mapRetrievalToAddress(
  props: MapboxFeatureProperties,
  countryList: CountryOption[],
  stateList: StateOption[],
): AddressValue {
  const ctx = props.context;
  const countryCode = ctx?.country?.country_code ?? '';
  const countryName = ctx?.country?.name ?? '';
  const regionName = ctx?.region?.name ?? '';
  const isUs = isUsCountryCode(countryCode);

  const country =
    findCountryByCode2(countryList, countryCode) ?? findCountryByName(countryList, countryName);
  const stateOption = resolveStateOption(regionName, stateList);

  const value: AddressValue = {
    line_1: props.address ?? ctx?.address?.name ?? props.name ?? '',
    line_2: '',
    city: ctx?.place?.name ?? ctx?.locality?.name ?? '',
    postal_code: ctx?.postcode?.name ?? '',
    country: country ? { id: country.id } : null,
    country_name: countryName,
    state_name: regionName,
    is_us_address: isUs,
  };

  if (isUs) {
    value.state = stateOption ? { id: stateOption.id } : null;
    value.state_or_province = '';
  } else {
    value.state = null;
    value.state_or_province = regionName;
  }

  return value;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export interface UseAddressAutofillOptions {
  /** Mapbox token override. Defaults to `VITE_MAPBOX_TOKEN` → built-in token. */
  token?: string;
  /** Country options (from the wealthdomain `country` saved query) for link resolution. */
  countryList?: CountryOption[];
  /** State options (from the wealthdomain `state_or_province` saved query). */
  stateList?: StateOption[];
  /** ISO alpha-2 code to bias suggestions (e.g. 'US'). */
  countryPreference?: string;
  /** Called with the resolved address when the user picks a suggestion. */
  onAddressSelected?: (address: AddressValue) => void;
}

export interface UseAddressAutofillResult {
  suggestions: AddressSuggestion[];
  /** True once a token is configured and no request has failed. */
  isAvailable: boolean;
  isLoading: boolean;
  /** Debounced autocomplete. Pass the user's typed query. */
  suggest: (query: string) => void;
  /** Retrieve the full address for a suggestion and emit `onAddressSelected`. */
  selectSuggestion: (s: AddressSuggestion) => Promise<void>;
  clearSuggestions: () => void;
}

export function useAddressAutofill(
  options: UseAddressAutofillOptions = {},
): UseAddressAutofillResult {
  const {
    token: tokenProp,
    countryList = [],
    stateList = [],
    countryPreference,
    onAddressSelected,
  } = options;

  const token = resolveToken(tokenProp);

  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [isAvailable, setIsAvailable] = useState<boolean>(!!token);
  const [isLoading, setIsLoading] = useState(false);

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Monotonic id for suggest requests. Debouncing narrows the window but does
  // not close it: a keystroke after the timer has already fired starts a second
  // fetch while the first is open, and Mapbox can answer them out of order.
  // Only the newest request may write to state.
  const suggestSeqRef = useRef(0);
  // Stable for the life of the hook instance; the initializer runs once.
  const [sessionToken] = useState(createSessionToken);

  // Keep the latest callback without rebuilding `selectSuggestion`.
  const onSelectedRef = useRef(onAddressSelected);
  useEffect(() => {
    onSelectedRef.current = onAddressSelected;
  }, [onAddressSelected]);

  useEffect(() => {
    setIsAvailable(!!token);
  }, [token]);

  const suggest = useCallback(
    (query: string) => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);

      if (!query || !token) {
        setSuggestions([]);
        return;
      }

      debounceTimerRef.current = setTimeout(async () => {
        const request = ++suggestSeqRef.current;
        const isCurrent = () => request === suggestSeqRef.current;

        setIsLoading(true);
        try {
          const url = new URL(MAPBOX_SUGGEST_URL);
          url.searchParams.set('q', query);
          url.searchParams.set('access_token', token);
          url.searchParams.set('session_token', sessionToken);
          url.searchParams.set('types', 'address');
          if (countryPreference) url.searchParams.set('country', countryPreference);

          const res = await fetch(url.toString());
          if (!res.ok) throw new Error(`Mapbox suggest ${res.status}`);
          const data = (await res.json()) as { suggestions?: MapboxSuggestion[] };
          if (!isCurrent()) return;
          setSuggestions((data.suggestions ?? []).map(mapSuggestion));
          setIsAvailable(true);
        } catch {
          if (!isCurrent()) return;
          // Degrade silently to manual entry.
          setSuggestions([]);
          setIsAvailable(false);
        } finally {
          if (isCurrent()) setIsLoading(false);
        }
      }, MAPBOX_DEBOUNCE_MS);
    },
    [token, countryPreference, sessionToken],
  );

  const selectSuggestion = useCallback(
    async (suggestion: AddressSuggestion) => {
      if (!token || !suggestion.mapbox_id) return;
      try {
        const url = new URL(`${MAPBOX_RETRIEVE_URL}/${encodeURIComponent(suggestion.mapbox_id)}`);
        url.searchParams.set('access_token', token);
        url.searchParams.set('session_token', sessionToken);

        const res = await fetch(url.toString());
        if (!res.ok) throw new Error(`Mapbox retrieve ${res.status}`);
        const data = (await res.json()) as {
          features?: { properties?: MapboxFeatureProperties }[];
        };
        const props = data.features?.[0]?.properties;
        if (props) {
          onSelectedRef.current?.(mapRetrievalToAddress(props, countryList, stateList));
        }
      } catch {
        // Selection failed — keep the user's current input.
      }
      setSuggestions([]);
    },
    [token, countryList, stateList, sessionToken],
  );

  const clearSuggestions = useCallback(() => setSuggestions([]), []);

  useEffect(() => {
    const timer = debounceTimerRef;
    const seq = suggestSeqRef;
    return () => {
      if (timer.current) clearTimeout(timer.current);
      // Invalidate any in-flight suggest so a late response can't write state
      // after unmount.
      seq.current++;
    };
  }, []);

  return {
    suggestions,
    isAvailable,
    isLoading,
    suggest,
    selectSuggestion,
    clearSuggestions,
  };
}
