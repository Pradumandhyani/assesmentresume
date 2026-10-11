import type { JudgeJob } from '../../queues/queue.contracts';
export interface JudgeWorkerContract {
  process(job: JudgeJob): Promise<void>;
}
// Deploy in a separate process and node pool. No worker is started from API bootstrap.
