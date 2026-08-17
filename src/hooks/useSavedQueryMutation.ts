/**
 * Hook for executing a WRITE (patch) saved query.
 *
 * Saved queries are normally read-only, but a query of `type: "patch"`
 * mutates a record: it POSTs a flat JSON body of the input params to
 * `/saved-queries/{name}/execute` (top-level `id` required) and returns the
 * patched row. See `src/queries/SAVED-QUERY.md` and the data-manager
 * handler (`handler/query_handler.go:executePatchSavedQuery`).
 *
 * The generic `N extends SavedQueryName` is the saved-query name from the
 * auto-generated registry; the input/row types are derived from it, so a
 * wrong field is a compile-time error. The hook only makes sense for patch
 * queries — in DEV it warns if the named query isn't `type: "patch"`.
 *
 * @example
 * const patchSr = useSavedQueryMutation('patch_sr_instance');
 * await patchSr.mutateAsync({ id, bo_instance_id: 'BO999', data: { foo: 1 } });
 *
 * On success the hook invalidates all `saved-query-*` react-query caches so
 * dependent reads (lists, singles, tables) refetch the updated data.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiManager } from '@/services/api-manager';
import { getDataHeaders } from '@/config/api-config';
import { logger } from '@/utils/logger';
import {
  buildSavedQueryWriteRequest,
  resolveAppDefinitionKey,
} from './saved-query-request';
import {
  SAVED_QUERY_APP_KEYS,
  SAVED_QUERY_TYPES,
  SAVED_QUERY_OPERATIONS,
  type SavedQueryName,
  type SavedQueryInputOf,
  type SavedQueryRowOf,
} from '@/types/saved-queries.generated';

export interface SavedQueryMutationOptions {
  /**
   * Override the saved query's target app-definition key. RARELY needed —
   * the hook auto-resolves it from the codegen registry. Only set for an
   * unusual cross-app override.
   */
  appDefinitionKey?: string;
  /** Callback on successful write (receives the patched row). */
  onSuccess?: (row: unknown) => void;
  /** Callback on write error. */
  onError?: (error: unknown) => void;
}

export function useSavedQueryMutation<N extends SavedQueryName>(
  name: N,
  options: SavedQueryMutationOptions = {},
) {
  const { appDefinitionKey, onSuccess, onError } = options;
  const queryClient = useQueryClient();

  // A write is either a `patch`-typed query OR one whose body carries an
  // insert/update/delete op (recorded in SAVED_QUERY_OPERATIONS). Only warn
  // when the query is neither — i.e. a read used with the mutation hook.
  const isWriteQuery =
    SAVED_QUERY_TYPES[name] === 'patch' || !!SAVED_QUERY_OPERATIONS[name];
  if (import.meta.env.DEV && SAVED_QUERY_TYPES[name] && !isWriteQuery) {
    logger.warn('saved-query:mutation:wrong-type', {
      name,
      type: SAVED_QUERY_TYPES[name],
      hint:
        `useSavedQueryMutation is for write saved queries (patch / insert / ` +
        `update / delete); "${name}" is type "${SAVED_QUERY_TYPES[name]}" ` +
        `with no write op. Use useSavedQueryTable/List/Single for reads.`,
    });
  }

  const resolvedAppKey = resolveAppDefinitionKey(
    name,
    SAVED_QUERY_APP_KEYS,
    appDefinitionKey,
  );

  const mutation = useMutation({
    mutationFn: async (
      input: SavedQueryInputOf<N>,
    ): Promise<SavedQueryRowOf<N>> => {
      // All writes (patch / insert / update / delete) send a flat JSON body.
      const { url, body } = buildSavedQueryWriteRequest(
        name,
        input as Record<string, unknown>,
      );
      const headers = getDataHeaders(resolvedAppKey);
      logger.log('saved-query:mutation:request', { name, appKey: resolvedAppKey });
      try {
        const response = await apiManager.post('data', url, body, headers);
        logger.log('saved-query:mutation:success', { name });
        return response.data as SavedQueryRowOf<N>;
      } catch (error) {
        logger.error('saved-query:mutation:error', {
          name,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
    onSuccess: (row) => {
      // A write may change any dependent read — refetch saved-query caches.
      // useSavedQueryTable reads through these two keys, so it's covered too.
      queryClient.invalidateQueries({ queryKey: ['saved-query-list'] });
      queryClient.invalidateQueries({ queryKey: ['saved-query-single'] });
      onSuccess?.(row);
    },
    onError,
  });

  return {
    /** Fire-and-forget mutate. */
    mutate: mutation.mutate,
    /** Promise-returning mutate; resolves to the patched row. */
    mutateAsync: mutation.mutateAsync,
    isLoading: mutation.isPending,
    error: mutation.error,
    /** The patched row from the last successful write. */
    data: mutation.data as SavedQueryRowOf<N> | undefined,
    reset: mutation.reset,
  };
}
