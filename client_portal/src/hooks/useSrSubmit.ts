/**
 * Hook for SUBMITTING a Service Request (SR).
 *
 * This is the second of the two SR runtime calls (the first is
 * `useSrCreate`). It replaces the old named `sr_submit` workflow —
 * `POST /workflow/v1/signals/{srInstanceId}/trigger` fires the SR's submit
 * signal with the form values as the body.
 *
 * The submit is keyed by `srInstanceId` (returned from `useSrCreate`) — it
 * is MANDATORY; there is no submit without it, and no workflow name is
 * involved (so this call is not covered by `useWorkflow` or the generated
 * `WorkflowName` registry).
 *
 * Like `useWorkflow`, this does NO error normalization — the SR workflow
 * may return field-level validation errors embedded in a success response
 * or as a rejected error. Inspect the result yourself (see
 * `mapWorkflowErrors` in `src/queries/SERVICE-REQUEST.md` §9).
 *
 * Call on the user's Submit click only, never on mount, and only after the
 * local (zod) validation passes.
 *
 * @example
 *   const submit = useSrSubmit(srInstanceId, {
 *     onSuccess: (data) => applyErrors(mapWorkflowErrors(data)),
 *     onError:   (err)  => applyErrors(mapWorkflowErrors(err)),
 *   });
 *
 *   await submit.mutateAsync(formValues);
 */
import { useMutation } from '@tanstack/react-query';
import { apiManager } from '@/services/api-manager';
import { getDataHeadersWithUser } from '@/config/api-config';
import { logger } from '@/utils/logger';
import { buildSrSignalUrl } from '@/lib/workflows-codegen';

/** Form values submitted to the SR signal trigger. */
export type SrSubmitInput = Record<string, unknown>;

export interface UseSrSubmitOptions {
  /**
   * Override the target app definition key. Defaults to the user-stamped
   * data headers (`X-Jiffy-User-Id` is always included).
   */
  appDefinitionKey?: string;
  onSuccess?: (data: unknown, input: SrSubmitInput) => void;
  onError?: (error: unknown, input: SrSubmitInput) => void;
}

export interface UseSrSubmitResult {
  mutate: (input: SrSubmitInput) => void;
  mutateAsync: (input: SrSubmitInput) => Promise<unknown>;
  data: unknown;
  error: unknown;
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
  reset: () => void;
}

/**
 * Normalise an SR submit body into a plain object for the
 * `POST /v1/signals/{srInstanceId}/trigger` request.
 *
 * - `null` / `undefined` → `{}` (no values).
 * - non-object / array → `{}` (defensive).
 * - object → returned as-is.
 *
 * Exported for unit tests.
 */
export function normaliseSrSubmitInput(
  input: unknown,
): Record<string, unknown> {
  if (input == null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) return {};
  return input as Record<string, unknown>;
}

export function useSrSubmit(
  srInstanceId: string,
  options: UseSrSubmitOptions = {},
): UseSrSubmitResult {
  const url = buildSrSignalUrl(srInstanceId);
  const headers = getDataHeadersWithUser(options.appDefinitionKey);

  const mutation = useMutation<unknown, unknown, SrSubmitInput>({
    mutationFn: async (input) => {
      const body = normaliseSrSubmitInput(input);
      logger.log('sr:submit:request', { srInstanceId, url });
      try {
        // `workflow` apiManager service (base `{origin}/workflow`).
        const response = await apiManager.post('workflow', url, body, headers);
        logger.log('sr:submit:success', { srInstanceId });
        return response.data;
      } catch (error) {
        logger.error('sr:submit:error', {
          srInstanceId,
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
