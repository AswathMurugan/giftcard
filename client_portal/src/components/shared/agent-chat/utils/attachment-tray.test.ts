import { describe, it, expect } from 'vitest';
import { canSendWithTray, collectReady, type TrayItemState } from './attachment-tray';

const row = (status: TrayItemState['status'], id = 'x'): TrayItemState => ({
  key: `k-${id}`,
  filename: `${id}.csv`,
  status,
  attachment: status === 'ready' ? { id, filename: `${id}.csv` } : null,
});

describe('canSendWithTray', { tags: ['agent-chat', 'important'] }, () => {
  it('an empty tray is sendable — text-only turns', { tags: ['edge-case'] }, () => {
    expect(canSendWithTray([])).toBe(true);
  });

  it('all ready → sendable', () => {
    expect(canSendWithTray([row('ready', '1'), row('ready', '2')])).toBe(true);
  });

  it('blocks while ANY file is still uploading', { tags: ['important'] }, () => {
    // The core guard: sending mid-upload ships ids that do not exist yet.
    expect(canSendWithTray([row('ready', '1'), row('uploading', '2')])).toBe(false);
  });

  it('an errored row does NOT block — it just contributes nothing', () => {
    // Matches the platform: it blocks only on isUploading, not on error.
    expect(canSendWithTray([row('ready', '1'), row('error', '2')])).toBe(true);
  });
});

describe('collectReady', { tags: ['agent-chat', 'important'] }, () => {
  it('returns the resolved attachments of ready rows, in order', () => {
    expect(collectReady([row('ready', '1'), row('ready', '2')])).toEqual([
      { id: '1', filename: '1.csv' },
      { id: '2', filename: '2.csv' },
    ]);
  });

  it('skips uploading and errored rows', { tags: ['edge-case'] }, () => {
    expect(
      collectReady([row('ready', '1'), row('uploading', '2'), row('error', '3')]),
    ).toEqual([{ id: '1', filename: '1.csv' }]);
  });

  it('is empty for an empty tray', () => {
    expect(collectReady([])).toEqual([]);
  });
});
