import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { QuestionList } from '@/features/questions/question-list';
import { useBulkPublish } from '@/features/questions/use-bulk-publish';
import type { QuestionSummary } from '@/types/questions';

const ok = (data: unknown) =>
  new Response(JSON.stringify({ data, meta: { serverNow: '2026-11-23T10:00:00Z' } }), {
    status: 200,
  });
const question = (id: string, status = 'DRAFT'): QuestionSummary => ({
  id,
  title: `Question ${id}`,
  slug: `question-${id}`,
  version: 1,
  versionId: `version-${id}`,
  revision: 2,
  status,
  archivedAt: null,
  difficulty: 'EASY',
  topics: ['Arrays'],
  maxScore: '10',
});
function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      {children}
    </QueryClientProvider>
  );
}

describe('question bank bulk publication', () => {
  it('selects only drafts, retains selection across pages and reports individual validation failures', async () => {
    const posts: { id: string; revision: number; key: string }[] = [];
    const published = new Set<string>();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, options?: RequestInit) => {
        if (path.endsWith('/settings'))
          return ok({ questionAuthoringAvailable: true, toolchains: [] });
        if (path.endsWith('/csrf')) return ok({ csrfToken: 'token' });
        if (path.includes('/publish')) {
          const id = path.split('/').at(-2)!;
          posts.push({
            id,
            revision: JSON.parse(String(options?.body)).revision,
            key: String((options?.headers as Record<string, string>)['Idempotency-Key']),
          });
          if (id === '2')
            return new Response(
              JSON.stringify({
                error: {
                  code: 'VALIDATION_FAILED',
                  message: 'Public examples must match the public test cases.',
                },
              }),
              { status: 422 },
            );
          published.add(id);
          return ok({ id, status: 'PUBLISHED' });
        }
        const page = new URL(path, 'https://admin.test').searchParams.get('page');
        const rows =
          page === '2'
            ? [question('3')]
            : [
                question('1', published.has('1') ? 'PUBLISHED' : 'DRAFT'),
                question('2'),
                question('old', 'PUBLISHED'),
              ];
        return ok({ items: rows, page: Number(page), pageSize: 20, total: 21 });
      }),
    );
    render(<QuestionList />, { wrapper });
    expect(await screen.findByLabelText('Select Question old')).toBeDisabled();
    await userEvent.click(screen.getByLabelText('Select all drafts on this page'));
    expect(screen.getByText('2 drafts selected')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await userEvent.click(await screen.findByLabelText('Select Question 3'));
    expect(screen.getByText('3 drafts selected')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Publish selected' }));
    expect(posts).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Publish selected drafts' }));
    expect(await screen.findByText('2 published; 1 need attention.')).toBeVisible();
    expect(screen.getByText('1 draft selected')).toBeVisible();
    expect(screen.getByText(/Public examples must match/)).toBeVisible();
    expect(posts.map((post) => post.id)).toEqual(['1', '2', '3']);
    expect(posts.every((post) => post.revision === 2 && post.key.length > 16)).toBe(true);
  });
  it('reuses a question operation key after a lost response and stops on service errors', async () => {
    const keys: string[] = [];
    let attempt = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, options?: RequestInit) => {
        if (path.endsWith('/csrf')) return ok({ csrfToken: 'token' });
        keys.push(String((options?.headers as Record<string, string>)['Idempotency-Key']));
        if (++attempt === 1) throw new TypeError('connection lost');
        if (attempt === 3)
          return new Response(
            JSON.stringify({
              error: { code: 'SERVICE_UNAVAILABLE', message: 'Catalog unavailable' },
            }),
            { status: 503 },
          );
        return ok({ id: '1', status: 'PUBLISHED' });
      }),
    );
    const { result } = renderHook(() => useBulkPublish(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync([question('1')]);
    });
    await act(async () => {
      await result.current.mutateAsync([question('1')]);
    });
    expect(keys[0]).toBe(keys[1]);
    await act(async () => {
      await result.current.mutateAsync([question('2'), question('3')]);
    });
    await waitFor(() => expect(result.current.data?.failed).toHaveLength(2));
    expect(keys).toHaveLength(3);
    expect(result.current.data?.failed[1]?.message).toMatch(/Not attempted/);
  });
});
