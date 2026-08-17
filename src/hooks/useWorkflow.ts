/**
 * Hook for executing a Phoenix workflow.
 *
 * Workflows are server-side actions with side effects (`create_user`,
 * `approve_account`, `send_notification`, …). They are NOT auto-fired on
 * mount like saved queries — call them on user action via
 * `mutate(input)` or `mutateAsync(input)`.
 *
 * Generic `N extends WorkflowName` ties the call site to the registry at
 * `src/types/workflows.generated.ts` so the input + output shapes are
 * inferred from the workflow name; passing the wrong field is a
 * compile-time error.
 *
 * Execute contract (V1, sync only): `POST /workflow/v1/execute/sync/{name}`
 * with the input as the JSON body; response is the workflow output
 * directly. Async workflows are skipped by the codegen and DO NOT
 * appear in `WorkflowName`.
 *
 * @example
 *   const createUser = useWorkflow('create_user', {
 *     onSuccess: (data) => toast.success(`User ${data.userId} created`),
 *   });
 *
 *   <Button onClick={() => createUser.mutate({
 *     orgId: { id: orgId },
 *     roleIds: [{ id: roleId }],
 *     email,
 *     firstName,
 *     lastName,
 *     user_type: 'human',
 *   })}>
 *     Create
 *   </Button>
 */
import { useMutation } from '@tanstack/react-query';
import { apiManager } from '@/services/api-manager';
import { getDataHeadersWithUser } from '@/config/api-config';
import { logger } from '@/utils/logger';
import { buildWorkflowExecuteUrl } from '@/lib/workflows-codegen';
import type {
  WorkflowName,
  WorkflowInputOf,
  WorkflowOutputOf,
} from '@/types/workflows.generated';

export interface UseWorkflowOptions<N extends WorkflowName> {
  /**
   * Override the workflow's target app definition key. Rarely needed —
   * the registry already encodes the right one. Passing `undefined`
   * (default) lets `getDataHeadersWithUser` use the codegen-derived appKey.
   * `X-Jiffy-User-Id` is stamped on every request automatically.
   */
  appDefinitionKey?: string;
  /** Fires on successful execution. */
  onSuccess?: (data: WorkflowOutputOf<N>, input: WorkflowInputOf<N>) => void;
  /** Fires on failure (network / 4xx / 5xx). */
  onError?: (error: unknown, input: WorkflowInputOf<N>) => void;
}

export interface UseWorkflowResult<N extends WorkflowName> {
  /** Fire-and-forget. React Query manages state via the returned fields. */
  mutate: (input: WorkflowInputOf<N>) => void;
  /** Promise-returning variant for await-style call sites. */
  mutateAsync: (input: WorkflowInputOf<N>) => Promise<WorkflowOutputOf<N>>;
  /** The output of the most recent successful execution. */
  data: WorkflowOutputOf<N> | undefined;
  error: unknown;
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
  /** Clear `data`/`error`/`isSuccess`/`isError` back to idle. */
  reset: () => void;
}

/**
 * Normalise a workflow input bag into a plain object body for the
 * `POST /workflow/v1/execute/sync/{name}` request.
 *
 * - `null` / `undefined` → `{}` (no inputs).
 * - non-object → `{}` (defensive; the typed signature prevents this, but
 *   callers using `as any` shouldn't be able to put a non-object on the
 *   wire).
 * - everything else → returned as-is (reference preserved so React Query
 *   can use it as a mutation variable).
 *
 * Exported for unit tests.
 */
export function normaliseWorkflowInput(
  input: unknown,
): Record<string, unknown> {
  if (input == null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) return {};
  return input as Record<string, unknown>;
}

export function useWorkflow<N extends WorkflowName>(
  name: N,
  options: UseWorkflowOptions<N> = {},
): UseWorkflowResult<N> {
  const url = buildWorkflowExecuteUrl(name);
  const { appDefinitionKey } = options;
  const headers = getDataHeadersWithUser(appDefinitionKey);

  const mutation = useMutation<
    WorkflowOutputOf<N>,
    unknown,
    WorkflowInputOf<N>
  >({
    mutationFn: async (input) => {
      const body = normaliseWorkflowInput(input);
      logger.log('workflow:execute:request', { name, url });
      try {
        // Use the `workflow` apiManager service (base URL
        // `{origin}/workflow`). NOT the `data` service — that would
        // prefix the wrong `/data` segment and the server 404s.
        const response = await apiManager.post('workflow', url, body, headers);
        logger.log('workflow:execute:success', { name });
        return response.data as WorkflowOutputOf<N>;
      } catch (error) {
        logger.error('workflow:execute:error', {
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
