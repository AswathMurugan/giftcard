import { describe, it, expect } from 'vitest';
import {
  emptyAddress,
  toCountryOptions,
  toStateOptions,
  formatAddress,
  defaultAddressConfig,
  addressZod,
  addressMissingFieldsFor,
  isAddressCompleteFor,
} from './address';

const US = { id: 'us-1' };

function fullUsAddress() {
  return {
    line_1: '1 Main St',
    city: 'Springfield',
    postal_code: '12345',
    country: US,
    country_name: 'United States of America',
    state: { id: 'st-1' },
    state_name: 'California',
    is_us_address: true,
  };
}

describe('address', { tags: ['field-format', 'address', 'logic'] }, () => {
  describe('emptyAddress', { tags: ['smoke'] }, () => {
    it('defaults to a US address so State + ZIP show first', () => {
      expect(emptyAddress()).toEqual({ is_us_address: true });
    });
  });

  describe('toCountryOptions', { tags: ['important'] }, () => {
    it('maps rows and de-duplicates by display name (first wins)', () => {
      const rows = [
        { id: '1', full_name: 'United States of America (The)', code_2_letters: 'US' },
        { id: '2', full_name: 'United States of America (The)', code_2_letters: 'US' },
        { id: '3', short_name: 'Canada', code_2_letters: 'CA' },
      ];
      const out = toCountryOptions(rows);
      expect(out).toHaveLength(2);
      expect(out[0]).toMatchObject({ id: '1', name: 'United States of America (The)' });
      expect(out[1]).toMatchObject({ id: '3', name: 'Canada' });
    });

    it('drops blank names and tolerates empty input', { tags: ['edge-case'] }, () => {
      expect(toCountryOptions([{ id: 'x' }])).toEqual([]);
      expect(toCountryOptions([])).toEqual([]);
    });
  });

  describe('toStateOptions', { tags: ['smoke'] }, () => {
    it('maps id/name/code', () => {
      expect(toStateOptions([{ id: 's1', name: 'California', code: 'CA' }])).toEqual([
        { id: 's1', name: 'California', code: 'CA' },
      ]);
    });
  });

  describe('formatAddress', { tags: ['important'] }, () => {
    it('joins parts with commas, abbreviating the US state', () => {
      expect(formatAddress(fullUsAddress())).toBe(
        '1 Main St, Springfield, CA, 12345, United States of America',
      );
    });

    it('uses the raw province for non-US addresses', () => {
      expect(
        formatAddress({
          line_1: '10 Downing St',
          city: 'London',
          postal_code: 'SW1A 2AA',
          country_name: 'United Kingdom',
          state_or_province: 'Greater London',
          is_us_address: false,
        }),
      ).toBe('10 Downing St, London, Greater London, SW1A 2AA, United Kingdom');
    });

    it("returns '—' for empty / non-object values", { tags: ['edge-case'] }, () => {
      expect(formatAddress(undefined)).toBe('—');
      expect(formatAddress(null)).toBe('—');
      expect(formatAddress({})).toBe('—');
      expect(formatAddress('str')).toBe('—');
    });
  });

  describe('addressZod', { tags: ['important'] }, () => {
    it('passes a complete US address and keeps display-only keys', () => {
      const r = addressZod(true).safeParse(fullUsAddress());
      expect(r.success).toBe(true);
      if (r.success) expect((r.data as Record<string, unknown>).state_name).toBe('California');
    });

    it('is fully optional when not required', () => {
      expect(addressZod(false).safeParse(undefined).success).toBe(true);
    });

    it('requires state for US, province for non-US (auto mode)', { tags: ['edge-case'] }, () => {
      const noState = { ...fullUsAddress(), state: null };
      const r1 = addressZod(true).safeParse(noState);
      expect(r1.success).toBe(false);

      const intl = {
        line_1: '10 Downing St',
        city: 'London',
        postal_code: 'SW1A 2AA',
        country: { id: 'gb-1' },
        is_us_address: false,
        state_or_province: 'Greater London',
      };
      expect(addressZod(true).safeParse(intl).success).toBe(true);
      expect(addressZod(true).safeParse({ ...intl, state_or_province: '' }).success).toBe(false);
    });

    it('honours config: hidden/optional sub-fields skip their rules, labels feed messages', () => {
      const cfg = defaultAddressConfig();
      cfg.city.required = false;
      cfg.state.visible = false;
      cfg.postal_code.format = 'zip9';
      cfg.line_1.label = 'Street';
      const v = { ...fullUsAddress(), city: '', state: null, postal_code: '12345-6789' };
      expect(addressZod(true, cfg).safeParse(v).success).toBe(true);

      const bad = addressZod(true, cfg).safeParse({ ...v, line_1: '' });
      expect(bad.success).toBe(false);
      if (!bad.success) {
        expect(bad.error.issues.some((i) => i.message === 'Street is required')).toBe(true);
      }
    });

    it('validates postal per configured format', { tags: ['edge-case'] }, () => {
      const cfg = defaultAddressConfig();
      cfg.postal_code.format = 'zip5';
      expect(addressZod(true, cfg).safeParse({ ...fullUsAddress(), postal_code: '1234' }).success).toBe(false);
      expect(addressZod(true, cfg).safeParse({ ...fullUsAddress(), postal_code: '12345' }).success).toBe(true);
    });
  });

  describe('addressMissingFieldsFor / isAddressCompleteFor', { tags: ['important'] }, () => {
    it('reports nothing missing for a complete US address', () => {
      expect(addressMissingFieldsFor(fullUsAddress(), defaultAddressConfig())).toEqual([]);
      expect(isAddressCompleteFor(fullUsAddress(), defaultAddressConfig())).toBe(true);
    });

    it('always requires the structural line_1 + country', { tags: ['edge-case'] }, () => {
      const cfg = defaultAddressConfig();
      const missing = addressMissingFieldsFor({}, cfg);
      expect(missing).toContain('line_1');
      expect(missing).toContain('country');
    });

    it('skips hidden / optional sub-fields', () => {
      const cfg = defaultAddressConfig();
      cfg.city.required = false;
      cfg.state.visible = false;
      cfg.postal_code.visible = false;
      const v = { line_1: '1 Main St', country: US };
      expect(addressMissingFieldsFor(v, cfg)).toEqual([]);
    });

    it('is state-mode aware', { tags: ['edge-case'] }, () => {
      const cfg = defaultAddressConfig();
      cfg.state.mode = 'stateOrProvince';
      const v = { ...fullUsAddress(), state: null, state_or_province: 'Ontario' };
      expect(addressMissingFieldsFor(v, cfg)).toEqual([]);

      cfg.state.mode = 'stateOnly';
      expect(addressMissingFieldsFor(v, cfg)).toContain('state');
    });

    it('checks postal completeness per format', { tags: ['edge-case'] }, () => {
      const cfg = defaultAddressConfig();
      cfg.postal_code.format = 'zip5';
      expect(addressMissingFieldsFor({ ...fullUsAddress(), postal_code: '123' }, cfg)).toContain(
        'postal_code',
      );
    });
  });
});
