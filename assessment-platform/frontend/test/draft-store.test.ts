import { afterEach, describe, expect, it, vi } from 'vitest';
import { DraftStore, draftKey } from '@/features/attempts/draft-store';
import { ApiError } from '@/services/api-client';
import type { Draft } from '@/services/attempt-api';
import { act, renderHook } from '@testing-library/react';
import { useDraftAutosave } from '@/features/attempts/use-draft-autosave';
const result = (
  q: string,
  language: Draft['language'],
  sourceCode: string,
  revision: number,
): Draft => ({
  attemptQuestionId: q,
  language,
  sourceCode,
  revision,
  savedAt: '2026-10-12T10:00:00Z',
});
describe('per-question autosave serialization and recovery', () => {
  afterEach(() => vi.useRealTimers());
  it('persists continuous typing within five seconds without waiting for an idle pause', async () => {
    vi.useFakeTimers();
    const save = vi.fn(async (q, l, code, rev) => result(q, l, code, rev + 1));
    const store = new DraftStore(save);
    store.ensure('q1', 'PYTHON', 'starter');
    const { unmount } = renderHook(() => useDraftAutosave(store, false));
    for (let i = 0; i < 10; i++) {
      act(() => store.edit('q1', 'PYTHON', `continuous ${i}`));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
    }
    expect(save).toHaveBeenCalledWith('q1', 'PYTHON', 'continuous 9', 0);
    expect(store.hasUnsaved()).toBe(false);
    unmount();
    store.dispose();
  });
  it('preserves separate buffers when switching questions and languages', async () => {
    const save = vi.fn(async (q, l, code, rev) => result(q, l, code, rev + 1));
    const store = new DraftStore(save);
    for (const q of ['q1', 'q4'])
      for (const l of ['PYTHON', 'JAVA', 'CPP'] as const) store.ensure(q, l, `starter ${l}`);
    store.edit('q1', 'PYTHON', 'python answer');
    store.edit('q1', 'JAVA', 'java answer');
    store.edit('q4', 'CPP', 'cpp answer');
    await store.flushAll();
    expect(store.snapshot()[draftKey('q1', 'PYTHON')]?.source).toBe('python answer');
    expect(store.snapshot()[draftKey('q1', 'JAVA')]?.source).toBe('java answer');
    expect(store.snapshot()[draftKey('q4', 'CPP')]?.source).toBe('cpp answer');
    expect(save).toHaveBeenCalledTimes(3);
    store.dispose();
  });
  it('does not report saved until the backend acknowledges; edits made in flight follow the acknowledged revision', async () => {
    let resolve!: (draft: Draft) => void;
    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Draft>((r) => {
            resolve = r;
          }),
      )
      .mockImplementationOnce(async (q, l, code, rev) => result(q, l, code, rev + 1));
    const store = new DraftStore(save);
    store.ensure('q1', 'PYTHON', 'starter');
    store.edit('q1', 'PYTHON', 'first');
    const flush = store.flush('q1', 'PYTHON');
    expect(store.snapshot()[draftKey('q1', 'PYTHON')]?.state).toBe('saving');
    store.edit('q1', 'PYTHON', 'latest');
    expect(save).toHaveBeenCalledTimes(1);
    resolve(result('q1', 'PYTHON', 'first', 1));
    await flush;
    expect(save.mock.calls.map((c) => [c[2], c[3]])).toEqual([
      ['first', 0],
      ['latest', 1],
    ]);
    expect(store.snapshot()[draftKey('q1', 'PYTHON')]?.state).toBe('saved');
    store.dispose();
  });
  it('debounces bursts and saves only the last edit', async () => {
    vi.useFakeTimers();
    const save = vi.fn(async (q, l, code, rev) => result(q, l, code, rev + 1));
    const store = new DraftStore(save);
    store.ensure('q1', 'CPP', 'starter');
    store.edit('q1', 'CPP', 'a');
    await vi.advanceTimersByTimeAsync(500);
    store.edit('q1', 'CPP', 'b');
    await vi.advanceTimersByTimeAsync(799);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledWith('q1', 'CPP', 'b', 0);
    store.dispose();
  });
  it('retains code through network interruption and retries the exact payload and revision', async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'Offline'))
      .mockResolvedValueOnce(result('q1', 'JAVA', 'local', 1));
    const store = new DraftStore(save, undefined, async () => undefined);
    store.ensure('q1', 'JAVA', 'starter');
    store.edit('q1', 'JAVA', 'local');
    await store.flushAll();
    expect(save).toHaveBeenNthCalledWith(1, 'q1', 'JAVA', 'local', 0);
    expect(save).toHaveBeenNthCalledWith(2, 'q1', 'JAVA', 'local', 0);
    expect(store.hasUnsaved()).toBe(false);
    store.dispose();
  });
  it('bounds retries, retains offline changes and supports reconnect', async () => {
    const save = vi.fn().mockRejectedValue(new ApiError(503, 'SERVICE_UNAVAILABLE', 'Unavailable'));
    const store = new DraftStore(save, undefined, async () => undefined);
    store.ensure('q1', 'PYTHON', 'starter');
    store.edit('q1', 'PYTHON', 'offline');
    await expect(store.flushAll()).rejects.toThrow('Unavailable');
    expect(save).toHaveBeenCalledTimes(3);
    expect(store.snapshot()[draftKey('q1', 'PYTHON')]?.state).toBe('offline');
    expect(store.hasUnsaved()).toBe(true);
    save.mockResolvedValue(result('q1', 'PYTHON', 'offline', 1));
    await store.flushAll();
    expect(store.hasUnsaved()).toBe(false);
    store.dispose();
  });
  it('retains a conflicting local draft without retrying or silently overwriting a newer server version', async () => {
    const save = vi.fn().mockRejectedValue(new ApiError(409, 'REVISION_CONFLICT', 'Conflict'));
    const store = new DraftStore(save);
    store.ensure('q1', 'PYTHON', 'starter');
    store.edit('q1', 'PYTHON', 'my code');
    await expect(store.flushAll()).rejects.toThrow('Conflict');
    await expect(store.flushAll()).rejects.toThrow('Resolve');
    expect(save).toHaveBeenCalledTimes(1);
    expect(store.snapshot()[draftKey('q1', 'PYTHON')]?.source).toBe('my code');
    store.dispose();
  });
  it('requires explicit conflict resolution before using the latest revision', async () => {
    const save = vi.fn(async (q, l, code, rev) => result(q, l, code, rev + 1));
    const store = new DraftStore(save);
    store.ensure('q1', 'CPP', 'starter', result('q1', 'CPP', 'server', 3), {
      source: 'mine',
      revision: 1,
    });
    expect(store.snapshot()[draftKey('q1', 'CPP')]?.state).toBe('conflict');
    store.resolve('q1', 'CPP', result('q1', 'CPP', 'server', 3), true, 'starter');
    await store.flushAll();
    expect(save).toHaveBeenCalledWith('q1', 'CPP', 'mine', 3);
    store.dispose();
  });
  it('restores persisted drafts on refresh and loads a starter only for a missing draft', () => {
    const store = new DraftStore(vi.fn());
    store.ensure('q1', 'PYTHON', 'starter', result('q1', 'PYTHON', '', 5));
    store.ensure('q1', 'JAVA', 'java starter');
    expect(store.snapshot()[draftKey('q1', 'PYTHON')]?.source).toBe('');
    expect(store.snapshot()[draftKey('q1', 'PYTHON')]?.revision).toBe(5);
    expect(store.snapshot()[draftKey('q1', 'JAVA')]?.state).toBe('starter');
    store.dispose();
  });
  it('preserves recoverable unsent edits without claiming server persistence', () => {
    const persist = vi.fn();
    const store = new DraftStore(vi.fn(), persist);
    store.ensure('q1', 'PYTHON', 'starter', undefined, { source: 'recovered', revision: 0 });
    expect(store.snapshot()[draftKey('q1', 'PYTHON')]?.state).toBe('dirty');
    store.edit('q1', 'PYTHON', 'new');
    expect(persist.mock.calls.at(-1)?.[0][0].source).toBe('new');
    store.dispose();
  });
  it('detects another tab’s newer revision while retaining unsent code', () => {
    const store = new DraftStore(vi.fn());
    store.ensure('q1', 'PYTHON', 'starter', result('q1', 'PYTHON', 'old', 1));
    store.edit('q1', 'PYTHON', 'mine');
    store.merge([result('q1', 'PYTHON', 'remote', 2)]);
    expect(store.snapshot()[draftKey('q1', 'PYTHON')]?.state).toBe('conflict');
    expect(store.snapshot()[draftKey('q1', 'PYTHON')]?.source).toBe('mine');
    store.dispose();
  });
  it('blocks edits and saves when the authoritative attempt state is not editable', async () => {
    const save = vi.fn();
    const store = new DraftStore(save);
    store.ensure('q1', 'PYTHON', 'starter');
    store.edit('q1', 'PYTHON', 'before expiry');
    store.setEnabled(false);
    store.edit('q1', 'PYTHON', 'after expiry');
    await expect(store.flushAll()).rejects.toThrow('disabled');
    expect(save).not.toHaveBeenCalled();
    expect(store.snapshot()[draftKey('q1', 'PYTHON')]?.source).toBe('before expiry');
    store.dispose();
  });
});
