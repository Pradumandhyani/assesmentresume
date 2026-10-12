export type SelectionPolicy = 'FINAL_SNAPSHOT' | 'BEST_VALID' | 'LATEST_VALID';
export interface ExecutionRules {
  submissionSelection: SelectionPolicy;
  partialScoring: boolean;
  maxHiddenSubmissions: number;
  hiddenCooldownSeconds: number;
  maxPublicRuns: number;
  hiddenFeedbackImmediate: boolean;
}
export function executionRules(snapshot: unknown): ExecutionRules {
  const value = (snapshot ?? {}) as Partial<ExecutionRules>;
  return {
    submissionSelection: value.submissionSelection ?? 'FINAL_SNAPSHOT',
    partialScoring: value.partialScoring ?? true,
    maxHiddenSubmissions: value.maxHiddenSubmissions ?? 20,
    hiddenCooldownSeconds: value.hiddenCooldownSeconds ?? 15,
    maxPublicRuns: value.maxPublicRuns ?? 100,
    hiddenFeedbackImmediate: value.hiddenFeedbackImmediate ?? false,
  };
}
export function cents(value: string): bigint {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw new Error('Invalid fixed-point amount');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
}
export function decimal(value: bigint): string {
  return `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
}
/** Weighted partial scores round down to cents. User errors earn zero for the affected case. */
export function scoreCases(maximum: string, cases: { weight: string; passed: boolean }[], partial: boolean) {
  if (!cases.length) throw new Error('Cannot grade an empty hidden test set');
  const total = cases.reduce((n, c) => n + cents(c.weight), 0n);
  if (total <= 0n || cases.some((c) => cents(c.weight) <= 0n)) throw new Error('Invalid case weights');
  const passed = cases.reduce((n, c) => n + (c.passed ? cents(c.weight) : 0n), 0n);
  return decimal(partial ? (cents(maximum) * passed) / total : passed === total ? cents(maximum) : 0n);
}
export function outputMatches(actual: string, expected: string, policy: string): boolean {
  if (policy === 'EXACT') return actual === expected;
  if (policy !== 'TOKENS') throw new Error('Unknown output comparison policy');
  return actual.trim().split(/\s+/).join(' ') === expected.trim().split(/\s+/).join(' ');
}
