import type { FinalizeJob } from '../../queues/queue.contracts';
export interface FinalizationWorkerContract {
  process(job: FinalizeJob): Promise<void>;
  reconcileExpiredAttempts(): Promise<number>;
}
