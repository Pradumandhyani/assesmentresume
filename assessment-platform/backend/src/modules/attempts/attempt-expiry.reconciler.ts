import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { AttemptsService } from './attempts.service';
/** Lifecycle reconciliation only. No queue dispatch, execution or grading in Step 3. */
@Injectable()
export class AttemptExpiryReconciler implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly logger = new Logger(AttemptExpiryReconciler.name);
  constructor(private readonly attempts: AttemptsService) {}
  onModuleInit() {
    this.timer = setInterval(() => {
      void this.tick();
    }, 5000);
    this.timer.unref();
  }
  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.attempts.reconcile();
    } catch {
      this.logger.error('Attempt expiry reconciliation failed; will retry.');
    } finally {
      this.running = false;
    }
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
