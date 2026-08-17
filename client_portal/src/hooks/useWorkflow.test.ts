import { describe, it, expect } from 'vitest';
import { normaliseWorkflowInput } from './useWorkflow';

describe(
  'useWorkflow',
  { tags: ['workflow', 'logic'] },
  () => {
    describe(
      'normaliseWorkflowInput',
      { tags: ['important'] },
      () => {
        it('returns {} for null/undefined', { tags: ['edge-case'] }, () => {
          expect(normaliseWorkflowInput(null)).toEqual({});
          expect(normaliseWorkflowInput(undefined)).toEqual({});
        });

        it('returns {} for non-object primitives', { tags: ['edge-case'] }, () => {
          expect(normaliseWorkflowInput('string')).toEqual({});
          expect(normaliseWorkflowInput(42)).toEqual({});
          expect(normaliseWorkflowInput(true)).toEqual({});
        });

        it('returns {} for arrays (workflows always take an object body)', { tags: ['edge-case'] }, () => {
          // Defensive: a caller using `as any` might pass an array.
          // Workflow execute endpoint expects a JSON object, so we
          // never put an array on the wire.
          expect(normaliseWorkflowInput([1, 2, 3])).toEqual({});
          expect(normaliseWorkflowInput([])).toEqual({});
        });

        it(
          'preserves a real input object by reference',
          { tags: ['smoke'] },
          () => {
            // Mirrors the `create_user` example: nested entity refs +
            // array of entity refs + scalars all flow through unchanged.
            const input = {
              orgId: { id: 'f91ac114' },
              roleIds: [{ id: '788011f1' }, { id: '3d1901d3' }],
              userId: 'd35094fc',
              email: 'ops+9879@jiffy.ai',
              firstName: 'Firm3',
              lastName: 'Founder',
              user_type: 'human',
            };
            const normalised = normaliseWorkflowInput(input);
            // Reference identity preserved (React Query relies on this
            // for the mutation `variables` parameter).
            expect(normalised).toBe(input);
            expect(normalised).toEqual(input);
          },
        );

        it('returns empty object for empty object input', { tags: ['edge-case'] }, () => {
          const input = {};
          expect(normaliseWorkflowInput(input)).toBe(input);
        });
      },
    );
  },
);
