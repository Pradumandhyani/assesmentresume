import { Module } from '@nestjs/common';
import { AttemptsController } from './attempts.controller';
import { AttemptsService } from './attempts.service';
import { AttemptsRepository } from './repositories/attempts.repository';
import { AttemptExpiryReconciler } from './attempt-expiry.reconciler';
import { ExecutionAvailability } from '../execution/execution-availability';
@Module({
  controllers: [AttemptsController],
  providers: [AttemptsService, AttemptsRepository, AttemptExpiryReconciler, ExecutionAvailability],
  exports: [AttemptsService],
})
export class AttemptsModule {}
