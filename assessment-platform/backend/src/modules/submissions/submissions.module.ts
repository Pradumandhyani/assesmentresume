import { Module } from '@nestjs/common';
import { AttemptsModule } from '../attempts/attempts.module';
import { SubmissionsController } from './submissions.controller';
import { SubmissionsService } from './submissions.service';
import { SubmissionsRepository } from './repositories/submissions.repository';
import { ExecutionAvailability } from '../execution/execution-availability';
// Register concrete controllers/providers only when this feature is implemented.
@Module({ imports: [AttemptsModule], controllers: [SubmissionsController], providers: [SubmissionsService, SubmissionsRepository, ExecutionAvailability] })
export class SubmissionsModule {}
