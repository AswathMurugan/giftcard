import { useState } from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { BUILTIN_SSO_PROVIDERS, type SsoProvider } from '@/services/auth-service';

interface SsoButtonsProps {
  providers: SsoProvider[];
  onProviderClick: (provider: SsoProvider) => Promise<void>;
  isDisabled: boolean;
}

/**
 * Label for an SSO button: built-in social providers → capitalized type;
 * custom providers → their `provider_name`; otherwise the type or "SSO".
 */
export function getSsoButtonLabel(provider: SsoProvider): string {
  const providerType = (provider.provider_type ?? '').toLowerCase();
  if (BUILTIN_SSO_PROVIDERS.has(providerType)) {
    return providerType.charAt(0).toUpperCase() + providerType.slice(1);
  }
  if (provider.provider_name) return provider.provider_name;
  return provider.provider_type || 'SSO';
}

/**
 * SSO provider buttons shown below the password form. Rendered as `outline`
 * buttons — gold stays the single primary on the screen (the Sign In button).
 * Returns null when the tenant has no SSO providers.
 */
export function SsoButtons({
  providers,
  onProviderClick,
  isDisabled,
}: SsoButtonsProps) {
  const [loadingProvider, setLoadingProvider] = useState<string | null>(null);

  if (providers.length === 0) return null;

  const handleClick = async (provider: SsoProvider) => {
    const key = provider.provider_name ?? provider.provider_type ?? '';
    setLoadingProvider(key);
    try {
      await onProviderClick(provider);
    } catch (error) {
      console.error('[SSO] Sign-in failed:', error);
    } finally {
      setLoadingProvider(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs font-normal uppercase text-muted-foreground">
          Or sign in with
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>
      <div className="flex flex-col gap-2">
        {providers.map((provider, index) => {
          const key =
            provider.provider_name ?? provider.provider_type ?? `sso-${index}`;
          const label = getSsoButtonLabel(provider);
          const isLoading = loadingProvider === key;
          return (
            <Button
              key={key}
              id={`sso-btn-${key.toLowerCase().replace(/\s+/g, '-')}`}
              type="button"
              variant="outline"
              className="h-[2.625rem] w-full rounded-[1.5rem]"
              disabled={isDisabled || (loadingProvider !== null && !isLoading)}
              onClick={() => {
                void handleClick(provider);
              }}
            >
              {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

export default SsoButtons;
