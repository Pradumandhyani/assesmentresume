'use client';
import { useEffect, useState } from 'react';
import { countdownParts, remainingSeconds } from './countdown';
export function useServerClock(serverNow: string, receivedAt?: number, roundTripMs = 0) {
  const [clock, setClock] = useState({ nowMs: Date.parse(serverNow), synchronized: false });
  useEffect(() => {
    const monotonic = performance.now();
    // Conservatively include the measured transit time. Delayed responses never extend editing.
    const anchor = {
      server:
        Date.parse(serverNow) +
        Math.max(0, roundTripMs) +
        Math.max(0, monotonic - (receivedAt ?? monotonic)),
      monotonic,
    };
    let needsResync = false;
    const tick = () => {
      const elapsed = Math.max(0, performance.now() - anchor.monotonic);
      setClock({
        nowMs: anchor.server + elapsed,
        synchronized:
          Number.isFinite(anchor.server) &&
          !needsResync &&
          document.visibilityState !== 'hidden' &&
          elapsed + roundTripMs < 20000,
      });
    };
    const visibility = () => {
      needsResync = true;
      tick();
    };
    const interval = window.setInterval(tick, 250);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pageshow', visibility);
    tick();
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pageshow', visibility);
    };
  }, [serverNow, receivedAt, roundTripMs]);
  return clock;
}
export function AssessmentCountdown({
  target,
  serverNowMs,
  synchronized,
}: {
  target: string;
  serverNowMs: number;
  synchronized: boolean;
}) {
  const parts = countdownParts(remainingSeconds(target, serverNowMs));
  return (
    <div
      className="countdown"
      role="timer"
      aria-label={
        synchronized
          ? `Starts in ${parts.hours} hours, ${parts.minutes} minutes and ${parts.seconds} seconds`
          : 'Synchronizing assessment time'
      }
    >
      {(['hours', 'minutes', 'seconds'] as const).map((part, index) => (
        <span className="countdown-segment" key={part}>
          {index > 0 && (
            <span className="countdown-colon" aria-hidden="true">
              :
            </span>
          )}
          <span className="countdown-value">{synchronized ? parts[part] : '—'}</span>
          <span className="countdown-label">{part.slice(0, 3)}</span>
        </span>
      ))}
    </div>
  );
}
