import { describe, it, expect } from 'vitest';
import { getSsoButtonLabel } from './sso-buttons';

describe('getSsoButtonLabel', { tags: ['login', 'sso', 'logic'] }, () => {
  it('capitalizes a built-in provider type', () => {
    expect(getSsoButtonLabel({ provider_type: 'google' })).toBe('Google');
    expect(getSsoButtonLabel({ provider_type: 'APPLE' })).toBe('Apple');
  });

  it('uses provider_name for custom providers', () => {
    expect(
      getSsoButtonLabel({ provider_type: 'SAML', provider_name: 'Okta' }),
    ).toBe('Okta');
  });

  it('falls back to provider_type when no name', { tags: ['edge-case'] }, () => {
    expect(getSsoButtonLabel({ provider_type: 'AzureAD' })).toBe('AzureAD');
  });

  it('falls back to "SSO" when nothing is set', { tags: ['edge-case'] }, () => {
    expect(getSsoButtonLabel({})).toBe('SSO');
  });
});
