/**
 * Hook for CREATING a Service Request (SR) instance.
 *
 * This is the first of the two SR runtime calls (the second is
 * `useSrSubmit`). It replaces the old `insert_sr_instance` saved-query
 * draft creation — `POST /workflow/v1/sr/execute/{sr_workflow_name}`
 * creates the SR instance server-side and returns its `srInstanceId`.
 *
 * Three inputs are MANDATORY for the SR create flow:
 *   - `entityReferenceId` (the boInstanceId — the business object the SR
 *     acts on).
 *   - `entityType` (the SR's root business object name, from
 *     `sr_definition.root_business_object`).
 *   - `payload` (the SR's dynamic form-context object — e.g. `client_id`,
 *     `account_id`, initial form values). It persists to
 *     `sr_instance.payload`, so a later SR table row (holding only the
 *     `srInstanceId`) can read it back to restore context.
 *   - the returned `srInstanceId` is then required for every downstream
 *     step (patch/update and submit via `useSrSubmit`).
 *
 * `srWorkflowName` is a plain string read from `workflows.catalog.md` — it
 * is intentionally NOT typed against `WorkflowName`, because SR workflows
 * may be async and excluded from the generated registry, and because this
 * endpoint (`/v1/sr/execute/{name}`) is not the generic
 * `/v1/execute/sync/{name}` path that `useWorkflow` covers.
 *
 * Call on user action (e.g. the dashboard "Create SR" popup), never on
 * mount.
 *
 * @example
 *   const createSr = useSrCreate('address_change', {
 *     onSuccess: ({ srInstanceId }) => openSrForm(srInstanceId),
 *   });
 *
 *   await createSr.mutateAsync({
 *     entityReferenceId: accountId,  // boInstanceId — mandatory
 *     entityType: 'account',         // root BO name — mandatory
 *     payload: {                     // dynamic form-context — mandatory
 *       client_id: selectedClientId,
 *       account_id: selectedAccountId,
 *       // …any initial form values to persist on sr_instance.payload
 *     },
 *   });
 */
import { useMutation } from '@tanstack/react-query';
import { apiManager } from '@/services/api-manager';
import { getDataHeadersWithUser } from '@/config/api-config';
import { logger } from '@/utils/logger';
import {
  buildSrExecuteUrl,
  buildSrExecuteBody,
  type SrExecuteBodyInput,
} from '@/lib/workflows-codegen';

/** Output of a successful SR create (`/v1/sr/execute/{name}`). */
export interface SrCreateResult {
  srInstanceId: string;
  workflowId?: string;
  [key: string]: unknown;
}

export interface UseSrCreateOptions {
  /**
   * Override the target app definition key. Defaults to the user-stamped
   * data headers (`X-Jiffy-User-Id` is always included).
   */
  appDefinitionKey?: string;
  onSuccess?: (data: SrCreateResult, input: SrExecuteBodyInput) => void;
  onError?: (error: unknown, input: SrExecuteBodyInput) => void;
}

export interface UseSrCreateResult {
  mutate: (input: SrExecuteBodyInput) => void;
  mutateAsync: (input: SrExecuteBodyInput) => Promise<SrCreateResult>;
  data: SrCreateResult | undefined;
  error: unknown;
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
  reset: () => void;
}

export function useSrCreate(
  srWorkflowName: string,
  options: UseSrCreateOptions = {},
): UseSrCreateResult {
  const url = buildSrExecuteUrl(srWorkflowName);
  const headers = getDataHeadersWithUser(options.appDefinitionKey);

  const mutation = useMutation<SrCreateResult, unknown, SrExecuteBodyInput>({
    mutationFn: async (input) => {
      // Throws if entityReferenceId / entityType are missing — both mandatory.
      const body = buildSrExecuteBody(input);
      logger.log('sr:create:request', { srWorkflowName, url });
      try {
        // `workflow` apiManager service (base `{origin}/workflow`).
        const response = await apiManager.post('workflow', url, body, headers);
        logger.log('sr:create:success', { srWorkflowName });
        return response.data as SrCreateResult;
      } catch (error) {
        logger.error('sr:create:error', {
          srWorkflowName,
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
