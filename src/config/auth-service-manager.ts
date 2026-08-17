import { AmplifyAuthService } from '@/services/auth-service';
import { LOCAL_DEV_DERIVED } from './local-dev';

let authServiceInstance: AmplifyAuthService | null = null;

export function getAuthService(): AmplifyAuthService {
  if (!authServiceInstance) {
    authServiceInstance = new AmplifyAuthService();
  }
  return authServiceInstance;
}

function getApiUrl(): string {
  if (typeof window === 'undefined') return '';
  const hostname = window.location.hostname;
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.localhost')) {
    return '/api';
  }
  return `${window.location.origin}/api`;
}

function getHost(): string {
  const host = window.location.host;
  const hostname = window.location.hostname;
  if (!host || host.startsWith('localhost:') || host === 'localhost') {
    return LOCAL_DEV_DERIVED.host;
  }
  if (hostname.endsWith('.localhost')) {
    const match3 = hostname.match(/^([^-]+)-([^-]+)-([^.]+)\.localhost$/);
    if (match3) {
      const [, appName, tenant, env] = match3;
      return `${appName}-${tenant}.us.${env}.phoenix.jiffy.ai`;
    }
    const match2 = hostname.match(/^([^-]+)-([^.]+)\.localhost$/);
    if (match2) {
      const [, appName, tenant] = match2;
      return `${appName}-${tenant}.us.sandbox.phoenix.jiffy.ai`;
    }
    return LOCAL_DEV_DERIVED.host;
  }
  return host;
}

export async function ensureAuthConfigured(): Promise<void> {
  const authService = getAuthService();
  const apiUrl = getApiUrl();
  if (!apiUrl) throw new Error('API_URL is not configured');
  await authService.fetchConfigFromAPI(apiUrl, getHost());
}
