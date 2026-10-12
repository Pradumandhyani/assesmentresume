export function remainingSeconds(target: string, serverNowMs: number): number {
  const targetMs = Date.parse(target);
  return Number.isFinite(targetMs) && Number.isFinite(serverNowMs)
    ? Math.max(0, Math.ceil((targetMs - serverNowMs) / 1000))
    : 0;
}
export function countdownParts(seconds: number) {
  return {
    hours: String(Math.floor(seconds / 3600)).padStart(2, '0'),
    minutes: String(Math.floor(seconds / 60) % 60).padStart(2, '0'),
    seconds: String(seconds % 60).padStart(2, '0'),
  };
}
export function canStartAssessment(input: {
  confirmed: boolean;
  synchronized: boolean;
  opensAt: string | null;
  latestStartAt: string | null;
  closesAt: string | null;
  serverNowMs: number;
}): boolean {
  if (
    !input.confirmed ||
    !input.synchronized ||
    !input.opensAt ||
    !input.latestStartAt ||
    !input.closesAt
  )
    return false;
  return (
    input.serverNowMs >= Date.parse(input.opensAt) &&
    input.serverNowMs <= Date.parse(input.latestStartAt) &&
    input.serverNowMs < Date.parse(input.closesAt)
  );
}
