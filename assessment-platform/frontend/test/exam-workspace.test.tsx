import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExecutionPanel, type ExecutionState } from '@/features/attempts/execution-panel';
import { useExamClock, timerWarning } from '@/features/attempts/exam-timer';
import { ResizablePanels } from '@/features/attempts/resizable-panels';
describe('server exam deadline and warnings', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  it.each([
    [901, null],
    [900, 'Fifteen'],
    [301, 'Fifteen'],
    [300, 'Five'],
    [61, 'Five'],
    [60, 'One'],
    [0, 'expired'],
  ] as const)('handles the %s-second boundary', (seconds, expected) => {
    if (expected === null) expect(timerWarning(seconds)).toBeNull();
    else expect(timerWarning(seconds)).toContain(expected);
  });
  it('expires from monotonic server time even when the local date is manipulated', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] });
    const { result } = renderHook(() =>
      useExamClock('2026-10-12T10:00:00Z', '2026-10-12T10:00:01Z'),
    );
    vi.spyOn(Date, 'now').mockReturnValue(0);
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.expired).toBe(true);
    expect(result.current.seconds).toBe(0);
  });
  it('requires synchronization after tab suspension and resumes from a new server timestamp', () => {
    const { result, rerender } = renderHook(
      ({ now }) => useExamClock(now, '2026-10-12T13:00:00Z'),
      { initialProps: { now: '2026-10-12T10:00:00Z' } },
    );
    expect(result.current.synchronized).toBe(true);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(result.current.synchronized).toBe(false);
    rerender({ now: '2026-10-12T12:59:00Z' });
    expect(result.current.seconds).toBeLessThanOrEqual(60);
  });
  it('accounts for a delayed response without extending the editing deadline', () => {
    const timing = { receivedAt: performance.now(), roundTripMs: 2000 };
    const { result } = renderHook(() =>
      useExamClock('2026-10-12T10:00:00Z', '2026-10-12T10:00:01Z', timing),
    );
    expect(result.current.expired).toBe(true);
  });
});
describe('coding workspace public feedback', () => {
  it.each([
    'UNAVAILABLE',
    'QUEUED',
    'RUNNING',
    'COMPLETED',
    'COMPILATION_ERROR',
    'RUNTIME_ERROR',
    'TIME_LIMIT_EXCEEDED',
    'MEMORY_LIMIT_EXCEEDED',
    'SYSTEM_ERROR',
  ] satisfies ExecutionState[])(
    'renders the honest %s state without invented pass counts',
    (state) => {
      render(<ExecutionPanel state={state} tab="public" onTab={vi.fn()} />);
      expect(screen.getByRole('status')).toBeVisible();
      expect(screen.queryByText(/\d+\s*\/\s*\d+.*pass/i)).toBeNull();
    },
  );
  it('keeps hidden test inputs, outputs and diagnostics absent', () => {
    render(<ExecutionPanel tab="hidden" onTab={vi.fn()} />);
    expect(screen.getByText('Hidden tests stay private')).toBeVisible();
    expect(screen.queryByText('EXPECTED OUTPUT')).toBeNull();
  });
  it('resizes panels through accessible keyboard controls', () => {
    render(<ResizablePanels left={<p>Problem</p>} right={<p>Editor</p>} mobileTab="problem" />);
    const separator = screen.getByRole('separator');
    act(() =>
      separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })),
    );
    expect(separator).toHaveAttribute('aria-valuenow', '45');
  });
});
