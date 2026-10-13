import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AdminLogin } from '@/features/auth/admin-login';
import { QuestionPreview } from '@/features/questions/question-form';
import { AssessmentForm, toLocalInput, toUtc } from '@/features/assessments/assessment-form';
import type { QuestionInput } from '@/types/questions';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));
const ok = (data: unknown) =>
  new Response(JSON.stringify({ data, meta: { serverNow: '2026-10-13T10:00:00.000Z' } }), {
    status: 200,
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
describe('administration forms and protected previews', () => {
  it('validates login accessibly before contacting the backend', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    render(<AdminLogin />, { wrapper });
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByLabelText('Administrator email')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Enter your password.')).toBeVisible();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('supports keyboard-safe password visibility', async () => {
    render(<AdminLogin />, { wrapper });
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
  it('shows invalid credentials from the real error contract', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(ok({ csrfToken: 'token' }))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              error: { code: 'UNAUTHENTICATED', message: 'Credentials are incorrect.' },
            }),
            { status: 401 },
          ),
        ),
    );
    render(<AdminLogin />, { wrapper });
    await userEvent.type(screen.getByLabelText('Administrator email'), 'staff@example.test');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Credentials are incorrect.');
  });
  it('defaults to four questions and the supported three-hour assessment', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(ok({ items: [], page: 1, pageSize: 20, total: 0 })),
    );
    render(<AssessmentForm />, { wrapper });
    expect(screen.getByLabelText('Duration (minutes)')).toHaveValue(180);
    expect(screen.getByLabelText('easy questions')).toHaveValue(2);
    expect(screen.getByLabelText('medium questions')).toHaveValue(1);
    expect(screen.getByLabelText('hard questions')).toHaveValue(1);
    expect(screen.getByLabelText('Python')).toBeChecked();
    expect(screen.getByLabelText('Java')).toBeChecked();
    expect(screen.getByLabelText('C++')).toBeChecked();
  });
  it('converts local schedule input to persisted UTC without changing the instant', () => {
    const stamp = '2026-10-13T09:00:00.000Z';
    expect(toUtc(toLocalInput(stamp))).toBe(stamp);
    expect(toUtc('')).toBeNull();
  });
  it('previews public problem content while excluding all hidden cases', () => {
    const question: QuestionInput = {
      slug: 'sum',
      title: 'Sum two numbers',
      difficulty: 'EASY',
      topics: ['arrays'],
      tags: [],
      statement: 'Read two numbers and add them.',
      inputFormat: 'Two integers',
      outputFormat: 'One integer',
      constraints: '0 <= n <= 100',
      explanation: 'Add the values.',
      publicExamples: [{ ordinal: 1, input: '2 3', expectedOutput: '5' }],
      maxScore: '10',
      cpuTimeMs: 2000,
      wallTimeMs: 5000,
      memoryLimitKiB: 262144,
      outputLimitBytes: 65536,
      processLimit: 32,
      outputComparison: 'TOKENS',
      templates: [],
      testCases: [
        {
          ordinal: 2,
          visibility: 'HIDDEN',
          input: 'PRIVATE INPUT 8732',
          expectedOutput: 'PRIVATE EXPECTED 9932',
          weight: '2',
        },
      ],
    };
    render(<QuestionPreview open question={question} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog')).toHaveTextContent('Read two numbers and add them.');
    expect(screen.getByText('2 3')).toBeVisible();
    expect(screen.queryByText('PRIVATE INPUT 8732')).not.toBeInTheDocument();
    expect(screen.queryByText('PRIVATE EXPECTED 9932')).not.toBeInTheDocument();
  });
});
