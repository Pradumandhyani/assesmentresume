import { Module } from '@nestjs/common';
import { AssessmentsController } from './assessments.controller';
import { AssessmentsService } from './assessments.service';
import { AssessmentsRepository } from './repositories/assessments.repository';
@Module({
  controllers: [AssessmentsController],
  providers: [AssessmentsService, AssessmentsRepository],
})
export class AssessmentsModule {}
