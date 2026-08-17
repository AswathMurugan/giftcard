/**
 * Hook for creating, updating, and deleting entity records.
 *
 * The `entityKey` is the PascalCase schema key (e.g. `'Account'`) and
 * is used both as the body wrapper key and (snake-cased) as the URL
 * segment. The `data` payloads are constrained to `Partial<TSchema[K]>`
 * — typos are compile-time errors.
 *
 * @example
 * const { create, update, remove } = useEntityMutation<
 *   { Account: Account }
 * >('Account', { appDefinitionKey: 'wealthdomain_69c65d7d64bd0f04506bab2b' });
 *
 * await create({ name: 'New Account', is_active: true });
 * await update('some-uuid', { name: 'Updated' });
 * await remove('some-uuid');
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiManager } from '@/services/api-manager';
import { getDataHeaders } from '@/config/api-config';
import { logger } from '@/utils/logger';

export interface EntityMutationOptions {
  /** App definition key for cross-app mutations. */
  appDefinitionKey?: string;
  /** Callback on successful mutation. */
  onSuccess?: () => void;
  /** Callback on mutation error. */
  onError?: (error: unknown) => void;
}

function pascalToSnake(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

export function useEntityMutation<
  TSchema extends Record<string, object>,
  K extends keyof TSchema & string,
>(entityKey: K, options: EntityMutationOptions = {}) {
  const { appDefinitionKey, onSuccess, onError } = options;
  const queryClient = useQueryClient();
  const headers = getDataHeaders(appDefinitionKey);
  const entityPath = pascalToSnake(entityKey);

  const invalidateQueries = () => {
    queryClient.invalidateQueries({ queryKey: ['entity-list', entityPath] });
    queryClient.invalidateQueries({ queryKey: ['entity-detail', entityPath] });
  };

  const createMutation = useMutation({
    mutationFn: async (data: Partial<TSchema[K]>) => {
      logger.log('entity:mutation:create:request', {
        entity: entityKey,
        appDefinitionKey,
      });
      try {
        const response = await apiManager.post(
          'data',
          `/command/${entityPath}/create`,
          { [entityKey]: { data } },
          headers,
        );
        logger.log('entity:mutation:create:success', {
          entity: entityKey,
          appDefinitionKey,
        });
        return response.data;
      } catch (error) {
        logger.error('entity:mutation:create:error', {
          entity: entityKey,
          appDefinitionKey,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
    onSuccess: () => {
      invalidateQueries();
      onSuccess?.();
    },
    onError,
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<TSchema[K]>;
    }) => {
      logger.log('entity:mutation:update:request', {
        entity: entityKey,
        id,
        appDefinitionKey,
      });
      try {
        const response = await apiManager.post(
          'data',
          `/command/${entityPath}/update`,
          { [entityKey]: { where: { id: { equals: id } }, data } },
          headers,
        );
        logger.log('entity:mutation:update:success', {
          entity: entityKey,
          id,
          appDefinitionKey,
        });
        return response.data;
      } catch (error) {
        logger.error('entity:mutation:update:error', {
          entity: entityKey,
          id,
          appDefinitionKey,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
    onSuccess: () => {
      invalidateQueries();
      onSuccess?.();
    },
    onError,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      logger.log('entity:mutation:delete:request', {
        entity: entityKey,
        id,
        appDefinitionKey,
      });
      try {
        const response = await apiManager.post(
          'data',
          `/command/${entityPath}/delete`,
          { [entityKey]: { where: { id: { equals: id } } } },
          headers,
        );
        logger.log('entity:mutation:delete:success', {
          entity: entityKey,
          id,
          appDefinitionKey,
        });
        return response.data;
      } catch (error) {
        logger.error('entity:mutation:delete:error', {
          entity: entityKey,
          id,
          appDefinitionKey,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
    onSuccess: () => {
      invalidateQueries();
      onSuccess?.();
    },
    onError,
  });

  return {
    create: createMutation.mutateAsync,
    update: (id: string, data: Partial<TSchema[K]>) =>
      updateMutation.mutateAsync({ id, data }),
    remove: deleteMutation.mutateAsync,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}
