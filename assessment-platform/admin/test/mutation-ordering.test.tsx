import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useAdminMutation } from '@/hooks/use-admin';
const ok = (data: unknown) =>
  new Response(JSON.stringify({ data, meta: { serverNow: '2026-10-13T10:00:00.000Z' } }), {
    status: 200,
  });
function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      {children}
    </QueryClientProvider>
  );
}
describe('critical administration operation replay', () => {
  it('retains the same key for unchanged retries after a lost response', async () => {
    let posts = 0;
    const keys: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, options?: RequestInit) => {
        if (path.endsWith('/csrf')) return ok({ csrfToken: 'token' });
        keys.push(String((options?.headers as Record<string, string>)['Idempotency-Key']));
        if (++posts === 1) throw new TypeError('connection lost');
        return ok({ id: 'created' });
      }),
    );
    const { result } = renderHook(
      () => useAdminMutation<{ id: string }, { title: string }>('/admin/assessments'),
      { wrapper },
    );
    await act(async () => {
      await result.current.mutateAsync({ title: 'Round 1' }).catch(() => undefined);
    });
    await act(async () => {
      await result.current.mutateAsync({ title: 'Round 1' });
    });
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });
  it('uses a new key if a failed request body changes', async () => {
    const keys: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, options?: RequestInit) => {
        if (path.endsWith('/csrf')) return ok({ csrfToken: 'token' });
        keys.push(String((options?.headers as Record<string, string>)['Idempotency-Key']));
        throw new TypeError('offline');
      }),
    );
    const { result } = renderHook(
      () => useAdminMutation<unknown, { title: string }>('/admin/assessments'),
      { wrapper },
    );
    await act(async () => {
      await result.current.mutateAsync({ title: 'Round 1' }).catch(() => undefined);
    });
    await act(async () => {
      await result.current.mutateAsync({ title: 'Round 2' }).catch(() => undefined);
    });
    expect(keys[0]).not.toBe(keys[1]);
  });
  it('clears the operation key only after persistence succeeds', async () => {
    const keys: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, options?: RequestInit) => {
        if (path.endsWith('/csrf')) return ok({ csrfToken: 'token' });
        keys.push(String((options?.headers as Record<string, string>)['Idempotency-Key']));
        return ok({ id: 'created' });
      }),
    );
    const { result } = renderHook(
      () => useAdminMutation<unknown, { title: string }>('/admin/assessments'),
      { wrapper },
    );
    await act(async () => {
      await result.current.mutateAsync({ title: 'Round 1' });
    });
    await act(async () => {
      await result.current.mutateAsync({ title: 'Round 1' });
    });
    expect(keys[0]).not.toBe(keys[1]);
  });
});
