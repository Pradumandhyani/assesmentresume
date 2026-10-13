import { Module } from '@nestjs/common';
import { AttemptsController } from './attempts.controller';
import { AttemptsService } from './attempts.service';
import { AttemptsRepository } from './repositories/attempts.repository';
import { AttemptExpiryReconciler } from './attempt-expiry.reconciler';
import { ExecutionAvailability } from '../execution/execution-availability';
import { AttemptHeartbeatController } from './attempt-heartbeat.controller';
import { AttemptHeartbeatService } from './attempt-heartbeat.service';
@Module({
  controllers: [AttemptsController, AttemptHeartbeatController],
  providers: [
    AttemptsService,
    AttemptsRepository,
    AttemptExpiryReconciler,
    ExecutionAvailability,
    AttemptHeartbeatService,
  ],
  exports: [AttemptsService],
})
export class AttemptsModule {}
