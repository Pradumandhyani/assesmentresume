import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssessmentCard } from '@/features/assessments/assessment-card';
import { studentApi } from '@/services/api-client';
import type { components } from '@/types/api';
const open = '2026-10-11T10:00:00Z';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
function item(
  canStart: boolean,
  reason: 'READY' | 'NOT_OPEN' | 'CANCELLED' = canStart ? 'READY' : 'NOT_OPEN',
): components['schemas']['DashboardAssessment'] {
  return {
    assessment: {
      id: 'test-assessment',
      title: 'Test assessment',
      status: reason === 'CANCELLED' ? 'CANCELLED' : 'SCHEDULED',
      opensAt: open,
      latestStartAt: '2026-10-11T10:30:00Z',
      closesAt: '2026-10-11T13:30:00Z',
      attemptId: null,
      attemptStatus: null,
    },
    description: 'Test database projection',
    rules: {
      durationSeconds: 10800,
      easyCount: 2,
      mediumCount: 1,
      hardCount: 1,
      allowedLanguages: ['PYTHON', 'JAVA', 'CPP'],
      maxSourceBytes: 65536,
      gradingPolicyVersion: 'v1-final-snapshot',
      allocationPolicyVersion: 'v1-uniform-stratified',
    },
    category: reason === 'CANCELLED' ? 'CANCELLED' : canStart ? 'ACTIVE' : 'UPCOMING',
    eligibility: {
      assessmentId: 'test-assessment',
      canStart,
      canResume: false,
      reason,
      message: 'Availability comes from the server.',
      checkedAt: open,
    },
    result: null,
  };
}
function setup(value: components['schemas']['DashboardAssessment'], serverNow = open) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AssessmentCard item={value} serverNow={serverNow} onRefresh={vi.fn()} />
    </QueryClientProvider>,
  );
}
describe('start button server eligibility', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  it('stays disabled when local time reaches zero without backend confirmation', () => {
    setup(item(false));
    expect(screen.getByRole('button', { name: 'Start Assessment' })).toBeDisabled();
  });
  it('stays disabled before the schedule', () => {
    setup(item(true), '2026-10-11T09:59:59Z');
    expect(screen.getByRole('button', { name: 'Start Assessment' })).toBeDisabled();
  });
  it('rechecks the server when an eligible student clicks Start', async () => {
    const check = vi
      .spyOn(studentApi, 'eligibility')
      .mockImplementation(() => new Promise(() => {}));
    setup(item(true));
    const button = screen.getByRole('button', { name: 'Start Assessment' });
    expect(button).toBeEnabled();
    await userEvent.setup().click(button);
    expect(check).toHaveBeenCalledWith('test-assessment');
    expect(button).toBeDisabled();
  });
  it('disables stale eligibility after tab suspension', () => {
    setup(item(true));
    expect(screen.getByRole('button', { name: 'Start Assessment' })).toBeEnabled();
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(screen.getByRole('button', { name: 'Start Assessment' })).toBeDisabled();
  });
  it('does not start a cancelled assessment', () => {
    setup(item(false, 'CANCELLED'));
    expect(screen.getByRole('button', { name: 'Start Assessment' })).toBeDisabled();
  });
});
