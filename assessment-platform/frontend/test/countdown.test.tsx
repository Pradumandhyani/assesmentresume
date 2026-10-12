import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssessmentCountdown, useServerClock } from '@/features/assessments/assessment-countdown';
import {
  canStartAssessment,
  countdownParts,
  remainingSeconds,
} from '@/features/assessments/countdown';
const opensAt = '2026-10-11T10:00:00.000Z';
const open = Date.parse(opensAt);
describe('assessment countdown and eligibility', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  it('handles the millisecond before opening, exact opening and elapsed targets', () => {
    expect(remainingSeconds(opensAt, open - 1)).toBe(1);
    expect(remainingSeconds(opensAt, open)).toBe(0);
    expect(remainingSeconds(opensAt, open + 1000)).toBe(0);
    expect(countdownParts(10801)).toEqual({ hours: '03', minutes: '00', seconds: '01' });
  });
  it('does not enable start from countdown alone and closes at the admission boundary', () => {
    const input = {
      confirmed: true,
      synchronized: true,
      opensAt,
      latestStartAt: '2026-10-11T10:30:00Z',
      closesAt: '2026-10-11T13:30:00Z',
      serverNowMs: open,
    };
    expect(canStartAssessment({ ...input, serverNowMs: open - 1 })).toBe(false);
    expect(canStartAssessment(input)).toBe(true);
    expect(canStartAssessment({ ...input, confirmed: false })).toBe(false);
    expect(canStartAssessment({ ...input, synchronized: false })).toBe(false);
    expect(canStartAssessment({ ...input, serverNowMs: Date.parse(input.latestStartAt) + 1 })).toBe(
      false,
    );
  });
  it('displays accessible hours, minutes and seconds', () => {
    render(<AssessmentCountdown target={opensAt} serverNowMs={open - 3661000} synchronized />);
    expect(screen.getByRole('timer')).toHaveAccessibleName(
      'Starts in 01 hours, 01 minutes and 01 seconds',
    );
  });
  it('ignores a manipulated wall clock and invalidates synchronization after suspension', () => {
    let monotonic = 100;
    vi.spyOn(performance, 'now').mockImplementation(() => monotonic);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    function ClockProbe({ serverNow }: { serverNow: string }) {
      const clock = useServerClock(serverNow);
      return (
        <output data-testid="clock">
          {clock.nowMs}:{String(clock.synchronized)}
        </output>
      );
    }
    const view = render(<ClockProbe serverNow={opensAt} />);
    vi.spyOn(Date, 'now').mockReturnValue(open + 100000000);
    monotonic += 1000;
    act(() => vi.advanceTimersByTime(250));
    expect(screen.getByTestId('clock')).toHaveTextContent(`${open + 1000}:true`);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(screen.getByTestId('clock')).toHaveTextContent('false');
    view.rerender(<ClockProbe serverNow="2026-10-11T10:00:02.000Z" />);
    expect(screen.getByTestId('clock')).toHaveTextContent(`${open + 2000}:true`);
    monotonic += 21000;
    act(() => vi.advanceTimersByTime(250));
    expect(screen.getByTestId('clock')).toHaveTextContent('false');
  });
});
