'use client';
import { Clock3 } from 'lucide-react';
import { useServerClock } from '@/features/assessments/assessment-countdown';
import { countdownParts, remainingSeconds } from '@/features/assessments/countdown';
export function timerWarning(seconds: number): string | null {
  if (seconds <= 0) return 'Time has expired. The server is freezing your saved code.';
  if (seconds <= 60) return 'One minute remaining. Save your final changes now.';
  if (seconds <= 300) return 'Five minutes remaining. Review your answers.';
  if (seconds <= 900) return 'Fifteen minutes remaining.';
  return null;
}
export function useExamClock(
  serverNow: string,
  expiresAt: string,
  timing?: { receivedAt: number; roundTripMs: number },
) {
  const clock = useServerClock(serverNow, timing?.receivedAt, timing?.roundTripMs ?? 0);
  const seconds = remainingSeconds(expiresAt, clock.nowMs);
  return { ...clock, seconds, expired: seconds <= 0, warning: timerWarning(seconds) };
}
export function ExamTimer({ seconds, synchronized }: { seconds: number; synchronized: boolean }) {
  const p = countdownParts(seconds);
  return (
    <div
      className={`exam-timer ${seconds <= 900 ? 'exam-timer-warning' : ''}`}
      role="timer"
      aria-label={
        synchronized
          ? `${p.hours} hours ${p.minutes} minutes ${p.seconds} seconds remaining`
          : 'Synchronizing exam timer'
      }
    >
      <Clock3 size={16} />
      <span>{synchronized ? `${p.hours}:${p.minutes}:${p.seconds}` : 'Syncing…'}</span>
      <small>remaining</small>
    </div>
  );
}
