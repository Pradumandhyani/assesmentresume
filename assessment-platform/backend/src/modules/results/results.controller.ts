import type { OperationHandler } from '../../common/contracts/operation-handler';
import { Controller, Get, Param, ParseUUIDPipe, Req } from '@nestjs/common';
import { Roles } from '../../common/guards/session.guard';
import type { AuthRequest } from '../auth/auth.types';
import { ResultsService } from './results.service';
// Contract only: no route decorators, registration or success responses in Step 1.
export interface ResultsControllerContract {
  readonly handle: OperationHandler;
}
@Roles('STUDENT')
@Controller()
export class ResultsController {
  constructor(private readonly service: ResultsService) {}
  @Get(['results/:attemptId', 'student/attempts/:attemptId/result'])
  async get(@Req() req: AuthRequest, @Param('attemptId', ParseUUIDPipe) id: string) {
    const result = await this.service.get(req.identity!.student!.id, id);
    req.serverNow = result.now;
    return result.data;
  }
}
