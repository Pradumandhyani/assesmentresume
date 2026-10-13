import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { ExecutionPanel } from '@/features/attempts/execution-panel';
import { executionState, useExecution } from '@/features/attempts/use-execution';
import { attemptApi, type Submission } from '@/services/attempt-api';
vi.mock('@/services/attempt-api', () => ({
  attemptApi: { execute: vi.fn(), submission: vi.fn() },
}));
const attemptId = 'a2400000-0000-4000-8000-000000000001',
  questionId = 'a2400000-0000-4000-8000-000000000002',
  submissionId = 'a2400000-0000-4000-8000-000000000003';
const submission = (overrides: Partial<Submission> = {}): Submission => ({
  id: submissionId,
  attemptId,
  attemptQuestionId: questionId,
  questionVersionId: questionId,
  purpose: 'RUN_PUBLIC',
  language: 'PYTHON',
  status: 'QUEUED',
  acceptedAt: '2026-10-12T10:00:00Z',
  completedAt: null,
  feedbackReleased: true,
  result: null,
  ...overrides,
});
const response = (data: Submission) => ({
  data,
  meta: { serverNow: '2026-10-12T10:00:00Z', requestId: 'execution-test-request' },
});
const clients: QueryClient[] = [];
function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  vi.mocked(attemptApi.submission).mockResolvedValue(response(submission()));
});
afterEach(() => {
  for (const client of clients) client.clear();
  clients.length = 0;
});
describe('asynchronous execution integration', () => {
  it('reuses the same idempotency key after an unconfirmed request and creates a new key for an intentional resubmission', async () => {
    vi.mocked(attemptApi.execute)
      .mockRejectedValueOnce(new Error('Connection interrupted'))
      .mockResolvedValue(response(submission()));
    const { result } = renderHook(() => useExecution(attemptId, questionId, 'PYTHON', vi.fn()), {
      wrapper: wrapper(),
    });
    await act(() => result.current.execute('RUN_PUBLIC', 'print(42)'));
    expect(result.current.error).toBe('Connection interrupted');
    expect(result.current.publicSubmission).toBeUndefined();
    await act(() => result.current.execute('RUN_PUBLIC', 'print(42)'));
    expect(vi.mocked(attemptApi.execute).mock.calls[0]![4]).toBe(
      vi.mocked(attemptApi.execute).mock.calls[1]![4],
    );
    expect(result.current.publicSubmission?.status).toBe('QUEUED');
    await act(() => result.current.execute('RUN_PUBLIC', 'print(42)'));
    expect(vi.mocked(attemptApi.execute).mock.calls[2]![4]).not.toBe(
      vi.mocked(attemptApi.execute).mock.calls[1]![4],
    );
  });
  it('does not announce a queued result before the backend confirms acceptance', async () => {
    let accept!: (value: ReturnType<typeof response>) => void;
    vi.mocked(attemptApi.execute).mockImplementation(
      () =>
        new Promise((resolve) => {
          accept = resolve;
        }),
    );
    const { result } = renderHook(() => useExecution(attemptId, questionId, 'PYTHON', vi.fn()), {
      wrapper: wrapper(),
    });
    let request!: Promise<void>;
    act(() => {
      request = result.current.execute('RUN_PUBLIC', 'source');
    });
    expect(result.current.posting).toBe('RUN_PUBLIC');
    expect(result.current.publicSubmission).toBeUndefined();
    await act(async () => {
      accept(response(submission()));
      await request;
    });
    expect(result.current.publicSubmission?.id).toBe(submissionId);
    expect(result.current.posting).toBeNull();
  });
  it('restores durable status after refresh and keeps question and language results separate', async () => {
    sessionStorage.setItem(
      `assessment-execution:${attemptId}`,
      JSON.stringify({ [`${questionId}:PYTHON:RUN_PUBLIC`]: submissionId }),
    );
    const { result, rerender } = renderHook(
      ({ language }: { language: 'PYTHON' | 'JAVA' }) =>
        useExecution(attemptId, questionId, language, vi.fn()),
      { initialProps: { language: 'PYTHON' }, wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.publicSubmission?.id).toBe(submissionId));
    rerender({ language: 'JAVA' });
    expect(result.current.publicSubmission).toBeUndefined();
    rerender({ language: 'PYTHON' });
    await waitFor(() => expect(result.current.publicSubmission?.id).toBe(submissionId));
  });
  it.each([
    'PENDING',
    'QUEUED',
    'RUNNING',
    'COMPLETED',
    'INFRASTRUCTURE_FAILED',
    'CANCELLED',
  ] as const)('maps persisted %s to an honest UI state', (status) => {
    const expected =
      status === 'PENDING'
        ? 'QUEUED'
        : status === 'INFRASTRUCTURE_FAILED' || status === 'CANCELLED'
          ? 'SYSTEM_ERROR'
          : status;
    expect(executionState(submission({ status }), true)).toBe(expected);
  });
  it('renders actual public input/output and permitted hidden aggregates without hidden logs', () => {
    const { rerender } = render(
      <ExecutionPanel
        state="COMPLETED"
        tab="public"
        onTab={vi.fn()}
        cases={[
          {
            ordinal: 1,
            verdict: 'ACCEPTED',
            input: '17 25',
            expectedOutput: '42',
            stdout: '42',
            stderr: '',
            cpuTimeMs: 10,
            wallTimeMs: 20,
            memoryKiB: 1000,
          },
        ]}
      />,
    );
    expect(screen.getByText('17 25')).toBeInTheDocument();
    expect(screen.getByText('CPU: 10 ms')).toBeInTheDocument();
    rerender(
      <ExecutionPanel
        state="COMPLETED"
        tab="hidden"
        onTab={vi.fn()}
        hiddenVerdict="WRONG_ANSWER"
        hiddenCounts={{ passed: 2, total: 4 }}
        hiddenScore="7.00"
        feedbackReleased
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('2 / 4 hidden cases passed');
    expect(screen.queryByText('17 25')).toBeNull();
  });
});
