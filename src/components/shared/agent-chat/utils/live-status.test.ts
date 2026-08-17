import { describe, it, expect } from 'vitest';
import { deriveStatusLabel, IDLE_STATUS_LABEL } from './live-status';
import type { ProgressTodo } from './humanize';

const step = (content: string, status: ProgressTodo['status']): ProgressTodo => ({
  content,
  status,
});

describe('deriveStatusLabel', { tags: ['agent-chat', 'important'] }, () => {
  it('falls back to the idle label with no steps and no status', () => {
    expect(deriveStatusLabel('', [])).toBe(IDLE_STATUS_LABEL);
  });

  it('uses the backend status text when no tool is running', () => {
    expect(deriveStatusLabel('Planning', [])).toBe('Planning');
  });

  it('prefers a running tool over the status text', () => {
    const steps = [step('Reading file', 'in_progress')];
    expect(deriveStatusLabel('Planning', steps)).toBe('Reading file');
  });

  it('takes the LATEST running tool when several are in flight', () => {
    const steps = [
      step('List Tools', 'in_progress'),
      step('Reading file', 'in_progress'),
    ];
    expect(deriveStatusLabel('', steps)).toBe('Reading file');
  });

  it(
    'ignores completed steps — a finished tool must not read as live',
    { tags: ['important'] },
    () => {
      // The reported bug: every tool done, but the label still said "List Tools".
      const steps = [step('List Tools', 'completed'), step('Reading file', 'completed')];
      expect(deriveStatusLabel('', steps)).toBe(IDLE_STATUS_LABEL);
    },
  );

  it('skips past completed steps to the running one', () => {
    const steps = [
      step('List Tools', 'completed'),
      step('Reading file', 'in_progress'),
    ];
    expect(deriveStatusLabel('', steps)).toBe('Reading file');
  });

  it('ignores a trailing completed step after a running one', { tags: ['edge-case'] }, () => {
    const steps = [
      step('Reading file', 'in_progress'),
      step('List Tools', 'completed'),
    ];
    expect(deriveStatusLabel('', steps)).toBe('Reading file');
  });

  it('ignores pending steps', { tags: ['edge-case'] }, () => {
    const steps = [step('Queued work', 'pending')];
    expect(deriveStatusLabel('', steps)).toBe(IDLE_STATUS_LABEL);
    expect(deriveStatusLabel('Planning', steps)).toBe('Planning');
  });

  it('treats an all-pending list as idle, not as the first pending item', { tags: ['edge-case'] }, () => {
    const steps = [step('A', 'pending'), step('B', 'pending')];
    expect(deriveStatusLabel('', steps)).toBe(IDLE_STATUS_LABEL);
  });
});
