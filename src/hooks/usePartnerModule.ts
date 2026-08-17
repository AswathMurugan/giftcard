/**
 * Hooks for executing Phoenix partner-module requests.
 *
 * Two hooks, two URL patterns, one body envelope (`{ inputs: ... }`):
 *
 *   1. `usePartnerModule(name)` — direct proxy.
 *      `POST /api/proxy/{name}/{variant}` (variant defaults to `'default'`).
 *      Typed via `PartnerModuleName` from the auto-generated registry.
 *
 *   2. `usePartnerCategoryMethod(category, method)` — category-routed.
 *      `POST /api/proxy/execute-partner-category/{category}/{method}`.
 *      Untyped (category methods are looser-typed than direct modules);
 *      the caller supplies the input/output generics.
 *
 * Both invoke external systems with **side effects** — call them via
 * `mutate(input)` or `mutateAsync(input)` on user action. They are NOT
 * auto-fired.
 *
 * @example Direct module
 *   const addUser = usePartnerModule('addausertoagroup');
 *   <Button onClick={() => addUser.mutate({
 *     age: '36', amount: 349998, state: 'CA',
 *   })}>Add</Button>
 *
 * @example Category-routed method
 *   const fetchSummary = usePartnerCategoryMethod<
 *     { accountId: string },
 *     { totalReturn: number }
 *   >('portfolio-management', 'getPerformanceSummary');
 *   <Button onClick={() => fetchSummary.mutate({ accountId })}>
 *     Refresh
 *   </Button>
 */
import { useMutation } from '@tanstack/react-query';
import { apiManager } from '@/services/api-manager';
import { getDataHeadersWithUser } from '@/config/api-config';
import { logger } from '@/utils/logger';
import {
  buildPartnerCategoryMethodUrl,
  buildPartnerModuleBody,
  buildPartnerModuleUrl,
} from '@/lib/partner-modules-codegen';
import type {
  PartnerModuleName,
  PartnerModuleInputOf,
  PartnerModuleOutputOf,
} from '@/types/partner-modules.generated';

// ── usePartnerModule (direct proxy) ─────────────────────────────────────

export interface UsePartnerModuleOptions<N extends PartnerModuleName> {
  /**
   * Variant slot in the proxy URL. Defaults to `'default'`. Some
   * modules expose `'sandbox'` / `'production'` etc. — refer to
   * `src/types/catalogs/partner-modules.catalog.md`.
   */
  variant?: string;
  /** Override the partner-module's target app definition key. */
  appDefinitionKey?: string;
  /** Fires on a successful proxy response. */
  onSuccess?: (
    data: PartnerModuleOutputOf<N>,
    input: PartnerModuleInputOf<N>,
  ) => void;
  /** Fires on failure (network / 4xx / 5xx / proxy error). */
  onError?: (error: unknown, input: PartnerModuleInputOf<N>) => void;
}

export interface UsePartnerModuleResult<N extends PartnerModuleName> {
  mutate: (input: PartnerModuleInputOf<N>) => void;
  mutateAsync: (
    input: PartnerModuleInputOf<N>,
  ) => Promise<PartnerModuleOutputOf<N>>;
  data: PartnerModuleOutputOf<N> | undefined;
  error: unknown;
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
  reset: () => void;
}

export function usePartnerModule<N extends PartnerModuleName>(
  name: N,
  options: UsePartnerModuleOptions<N> = {},
): UsePartnerModuleResult<N> {
  const { variant, appDefinitionKey } = options;
  const url = buildPartnerModuleUrl(name, variant);
  const headers = getDataHeadersWithUser(appDefinitionKey);

  const mutation = useMutation<
    PartnerModuleOutputOf<N>,
    unknown,
    PartnerModuleInputOf<N>
  >({
    mutationFn: async (input) => {
      const body = buildPartnerModuleBody(input);
      logger.log('partner-module:execute:request', { name, url });
      try {
        // Use the `proxy` apiManager service (base URL = origin, no
        // prefix). NOT the `data` service — that would prefix `/data`
        // and the server 404s on `/data/api/proxy/...`.
        const response = await apiManager.post('proxy', url, body, headers);
        logger.log('partner-module:execute:success', { name });
        return response.data as PartnerModuleOutputOf<N>;
      } catch (error) {
        logger.error('partner-module:execute:error', {
          name,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
    onSuccess: options.onSuccess
      ? (data, variables) => options.onSuccess?.(data, variables)
      : undefined,
    onError: options.onError
      ? (error, variables) => options.onError?.(error, variables)
      : undefined,
  });

  return {
    mutate: mutation.mutate,
    mutateAsync: mutation.mutateAsync,
    data: mutation.data,
    error: mutation.error,
    isPending: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    reset: mutation.reset,
  };
}

// ── usePartnerCategoryMethod (category-routed) ──────────────────────────

export interface UsePartnerCategoryMethodOptions<TInput, TOutput> {
  /** Override the category's target app definition key. */
  appDefinitionKey?: string;
  /** Fires on a successful proxy response. */
  onSuccess?: (data: TOutput, input: TInput) => void;
  /** Fires on failure (network / 4xx / 5xx / proxy error). */
  onError?: (error: unknown, input: TInput) => void;
}

export interface UsePartnerCategoryMethodResult<TInput, TOutput> {
  mutate: (input: TInput) => void;
  mutateAsync: (input: TInput) => Promise<TOutput>;
  data: TOutput | undefined;
  error: unknown;
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
  reset: () => void;
}

/**
 * Invoke a method on a partner category via
 * `POST /api/proxy/execute-partner-category/{category}/{method}`.
 *
 * Category methods are looser-typed than direct modules — there's no
 * generated registry binding inputs and outputs to method names. The
 * caller declares the generics explicitly. When the same method is
 * used in multiple call sites, extract a typed wrapper.
 */
export function usePartnerCategoryMethod<TInput = unknown, TOutput = unknown>(
  category: string,
  method: string,
  options: UsePartnerCategoryMethodOptions<TInput, TOutput> = {},
): UsePartnerCategoryMethodResult<TInput, TOutput> {
  const { appDefinitionKey } = options;
  const url = buildPartnerCategoryMethodUrl(category, method);
  const headers = getDataHeadersWithUser(appDefinitionKey);

  const mutation = useMutation<TOutput, unknown, TInput>({
    mutationFn: async (input) => {
      const body = buildPartnerModuleBody(input);
      logger.log('partner-category:execute:request', { category, method, url });
      try {
        // Use the `proxy` apiManager service (no `/data` prefix).
        const response = await apiManager.post('proxy', url, body, headers);
        logger.log('partner-category:execute:success', { category, method });
        return response.data as TOutput;
      } catch (error) {
        logger.error('partner-category:execute:error', {
          category,
          method,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
    onSuccess: options.onSuccess
      ? (data, variables) => options.onSuccess?.(data, variables)
      : undefined,
    onError: options.onError
      ? (error, variables) => options.onError?.(error, variables)
      : undefined,
  });

  return {
    mutate: mutation.mutate,
    mutateAsync: mutation.mutateAsync,
    data: mutation.data,
    error: mutation.error,
    isPending: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    reset: mutation.reset,
  };
}
