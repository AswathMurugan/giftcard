import { describe, it, expect } from 'vitest';
import {
  createSessionToken,
  isUsCountryCode,
  isUsCountry,
  findCountryByCode2,
  findCountryByName,
  resolveStateOption,
  sortCountriesUsFirst,
  validatePostalCode,
  formatSuggestionLabel,
  mapSuggestion,
  mapRetrievalToAddress,
  type CountryOption,
  type StateOption,
} from './useAddressAutofill';

const COUNTRIES: CountryOption[] = [
  { id: 'c-ca', name: 'Canada', code_2_letters: 'CA' },
  { id: 'c-us', name: 'United States', code_2_letters: 'US' },
  { id: 'c-gb', name: 'United Kingdom', code_2_letters: 'GB' },
];

const STATES: StateOption[] = [
  { id: 's-ca', name: 'California', code: 'CA' },
  { id: 's-ny', name: 'New York', code: 'NY' },
];

describe('useAddressAutofill helpers', { tags: ['address', 'logic'] }, () => {
  describe('createSessionToken', { tags: ['important'] }, () => {
    it('uses randomUUID when available', () => {
      const expected = '123e4567-e89b-42d3-a456-426614174000';
      const cryptoSource = {
        randomUUID: () => expected,
      } as unknown as Crypto;

      expect(createSessionToken(cryptoSource)).toBe(expected);
    });

    it('builds a UUID v4 with getRandomValues as the secure fallback', () => {
      const cryptoSource = {
        getRandomValues: (bytes: Uint8Array) => {
          bytes.set(Array.from({ length: 16 }, (_, index) => index));
          return bytes;
        },
      } as unknown as Crypto;

      expect(createSessionToken(cryptoSource)).toBe(
        '00010203-0405-4607-8809-0a0b0c0d0e0f',
      );
    });

    it('rejects insecure token generation when Web Crypto is unavailable', () => {
      expect(() => createSessionToken(null)).toThrow('Web Crypto is required');
    });
  });

  describe('isUsCountryCode', { tags: ['important'] }, () => {
    it('matches US case-insensitively', () => {
      expect(isUsCountryCode('US')).toBe(true);
      expect(isUsCountryCode('us')).toBe(true);
      expect(isUsCountryCode('CA')).toBe(false);
    });
    it('is false for empty/undefined', { tags: ['edge-case'] }, () => {
      expect(isUsCountryCode(undefined)).toBe(false);
      expect(isUsCountryCode('')).toBe(false);
    });
  });

  describe('isUsCountry (multi-signal, entity-derived)', { tags: ['important'] }, () => {
    it('matches on code_2_letters, code_3_letters, or name', () => {
      expect(isUsCountry({ code_2_letters: 'US' })).toBe(true);
      expect(isUsCountry({ code_3_letters: 'USA' })).toBe(true);
      expect(isUsCountry({ name: 'United States of America' })).toBe(true);
      expect(isUsCountry({ full_name: 'United States of America (The)' })).toBe(true);
    });
    it('detects US when code_2_letters is missing/blank but the name says so (the real tenant bug)', () => {
      // This tenant does NOT store code_2_letters as "US"; name is the reliable signal.
      expect(isUsCountry({ code_2_letters: '', full_name: 'United States of America (The)' })).toBe(true);
    });
    it('is false for non-US and empty', { tags: ['edge-case'] }, () => {
      expect(isUsCountry({ code_2_letters: 'CA', name: 'Canada' })).toBe(false);
      expect(isUsCountry(null)).toBe(false);
      expect(isUsCountry(undefined)).toBe(false);
      expect(isUsCountry({})).toBe(false);
    });
    it('uses fallbackName when the country object lacks a name', () => {
      expect(isUsCountry({}, 'United States')).toBe(true);
    });
  });

  describe('findCountryByCode2', { tags: ['important'] }, () => {
    it('finds by 2-letter code, case-insensitive', () => {
      expect(findCountryByCode2(COUNTRIES, 'us')?.id).toBe('c-us');
    });
    it('returns undefined when not found or empty', { tags: ['edge-case'] }, () => {
      expect(findCountryByCode2(COUNTRIES, 'ZZ')).toBeUndefined();
      expect(findCountryByCode2(COUNTRIES, '')).toBeUndefined();
    });
  });

  describe('findCountryByName', () => {
    it('matches exact, prefix, and substring', () => {
      expect(findCountryByName(COUNTRIES, 'United States')?.id).toBe('c-us');
      expect(findCountryByName(COUNTRIES, 'United Kin')?.id).toBe('c-gb');
      expect(findCountryByName(COUNTRIES, 'Canada')?.id).toBe('c-ca');
    });
  });

  describe('resolveStateOption', () => {
    it('resolves by id first (prefilled link UUID in state_or_province)', { tags: ['important'] }, () => {
      // A prefilled US address stores the state as its link id in the
      // free-text slot; resolveStateOption must map that id back to the option.
      expect(resolveStateOption('s-ny', STATES)?.id).toBe('s-ny');
    });
    it('resolves by name then by code', () => {
      expect(resolveStateOption('California', STATES)?.id).toBe('s-ca');
      expect(resolveStateOption('NY', STATES)?.id).toBe('s-ny');
    });
    it('returns undefined for unknown / empty list', { tags: ['edge-case'] }, () => {
      expect(resolveStateOption('Ontario', STATES)).toBeUndefined();
      expect(resolveStateOption('California', [])).toBeUndefined();
    });
  });

  describe('sortCountriesUsFirst', { tags: ['important'] }, () => {
    it('puts US first, then alphabetical', () => {
      const sorted = sortCountriesUsFirst(COUNTRIES).map((c) => c.id);
      expect(sorted[0]).toBe('c-us');
      expect(sorted).toEqual(['c-us', 'c-ca', 'c-gb']);
    });
    it('does not mutate the input', { tags: ['edge-case'] }, () => {
      const input = [...COUNTRIES];
      sortCountriesUsFirst(input);
      expect(input[0].id).toBe('c-ca');
    });
  });

  describe('validatePostalCode', { tags: ['important'] }, () => {
    it('US: digits only, max 5', () => {
      expect(validatePostalCode('90210', true)).toBe('90210');
      expect(validatePostalCode('9021o-1234', true)).toBe('90211');
      expect(validatePostalCode('abcde', true)).toBe('');
    });
    it('non-US: alphanumeric + space/dash, max 10', () => {
      expect(validatePostalCode('K1A 0B1', false)).toBe('K1A 0B1');
      expect(validatePostalCode('SW1A!1AA', false)).toBe('SW1A1AA');
      expect(validatePostalCode('ABCDEFGHIJKLMNOP', false)).toBe('ABCDEFGHIJ');
    });
  });

  describe('formatSuggestionLabel', () => {
    it('prefers full_address', () => {
      expect(formatSuggestionLabel({ full_address: '1 Main St, Anytown' })).toBe('1 Main St, Anytown');
    });
    it('combines name + place_formatted', () => {
      expect(
        formatSuggestionLabel({ name: '1 Main St', place_formatted: 'Anytown, CA' }),
      ).toBe('1 Main St, Anytown, CA');
    });
    it('falls back to context parts', { tags: ['edge-case'] }, () => {
      expect(
        formatSuggestionLabel({
          name: '1 Main St',
          context: { place: { name: 'Anytown' }, region: { name: 'CA' } },
        }),
      ).toBe('1 Main St, Anytown, CA');
    });
  });

  describe('mapSuggestion', () => {
    it('maps Mapbox suggestion to the entity-shaped suggestion', () => {
      const s = mapSuggestion({
        name: '1 Main St',
        mapbox_id: 'abc',
        full_address: '1 Main St, Anytown, CA 90210',
        address: '1 Main St',
        context: {
          place: { name: 'Anytown' },
          region: { name: 'California' },
          postcode: { name: '90210' },
          country: { country_code: 'US' },
        },
      });
      expect(s).toMatchObject({
        line_1: '1 Main St',
        city: 'Anytown',
        state: 'California',
        postal_code: '90210',
        country_code: 'US',
        mapbox_id: 'abc',
      });
    });
  });

  describe('mapRetrievalToAddress', { tags: ['important'] }, () => {
    it('US address → state link + is_us_address true', () => {
      const v = mapRetrievalToAddress(
        {
          address: '1 Main St',
          context: {
            place: { name: 'Anytown' },
            region: { name: 'California' },
            postcode: { name: '90210' },
            country: { name: 'United States', country_code: 'US' },
          },
        },
        COUNTRIES,
        STATES,
      );
      expect(v).toMatchObject({
        line_1: '1 Main St',
        city: 'Anytown',
        postal_code: '90210',
        country: { id: 'c-us' },
        state: { id: 's-ca' },
        is_us_address: true,
        state_or_province: '',
      });
    });

    it('non-US address → free-text province, null state', () => {
      const v = mapRetrievalToAddress(
        {
          address: '10 King St',
          context: {
            place: { name: 'Toronto' },
            region: { name: 'Ontario' },
            postcode: { name: 'M5H 1A1' },
            country: { name: 'Canada', country_code: 'CA' },
          },
        },
        COUNTRIES,
        STATES,
      );
      expect(v).toMatchObject({
        country: { id: 'c-ca' },
        state: null,
        state_or_province: 'Ontario',
        is_us_address: false,
      });
    });

    it('unknown country → null country link', { tags: ['edge-case'] }, () => {
      const v = mapRetrievalToAddress(
        { address: 'X', context: { country: { name: 'Atlantis', country_code: 'ZZ' } } },
        COUNTRIES,
        STATES,
      );
      expect(v.country).toBeNull();
    });
  });
});
