import { Module } from '@nestjs/common';
import { ResultsController } from './results.controller';
import { ResultsService } from './results.service';
import { ResultsRepository } from './repositories/results.repository';
// Register concrete controllers/providers only when this feature is implemented.
@Module({ controllers: [ResultsController], providers: [ResultsService, ResultsRepository], exports: [ResultsService] })
export class ResultsModule {}
