export const QUEUE_NAMES = {
  publicRuns: 'judge-public-v1',
  submissions: 'judge-submissions-v1',
  finalization: 'attempt-finalize-v1',
  outbox: 'outbox-dispatch-v1',
} as const;
export interface JudgeJob {
  readonly submissionId: string;
  readonly generation: number;
  readonly requestId: string;
}
export interface FinalizeJob {
  readonly attemptId: string;
  readonly expectedExpiresAt: string;
}
export interface OutboxJob {
  readonly eventId: string;
}
// Queue payloads contain identifiers only; no code, test payloads, credentials or results.
export const QUEUE_DEFAULTS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
  removeOnComplete: { age: 86400, count: 100000 },
  removeOnFail: { age: 604800, count: 100000 },
} as const;
