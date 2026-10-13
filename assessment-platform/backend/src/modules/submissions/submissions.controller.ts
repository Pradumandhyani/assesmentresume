import type { OperationHandler } from '../../common/contracts/operation-handler';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { Roles } from '../../common/guards/session.guard';
import type { AuthRequest } from '../auth/auth.types';
import { idempotencyKey, SubmissionsService } from './submissions.service';
import { CreateSubmissionDto, QuestionSubmissionDto } from './dto/create-submission.dto';
import { ApiException } from '../../common/http/api-error';
// Contract only: no route decorators, registration or success responses in Step 1.
export interface SubmissionsControllerContract {
  readonly handle: OperationHandler;
}
@Roles('STUDENT')
@Controller()
export class SubmissionsController {
  constructor(private readonly service: SubmissionsService) {}
  private async create(
    req: AuthRequest,
    id: string,
    input: CreateSubmissionDto,
    key: string | undefined,
    purpose: 'RUN_PUBLIC' | 'SUBMIT',
  ) {
    const result = await this.service.create(
      req.identity!.student!.id,
      req.identity!.user.id,
      id,
      input,
      idempotencyKey(key),
      purpose,
    );
    req.serverNow = result.now;
    return result.data;
  }
  @Post('attempts/:attemptId/run')
  @HttpCode(202)
  run(
    @Req() req: AuthRequest,
    @Param('attemptId', ParseUUIDPipe) id: string,
    @Body() input: CreateSubmissionDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.create(req, id, input, key, 'RUN_PUBLIC');
  }
  @Post('attempts/:attemptId/submit-solution')
  @HttpCode(202)
  submit(
    @Req() req: AuthRequest,
    @Param('attemptId', ParseUUIDPipe) id: string,
    @Body() input: CreateSubmissionDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.create(req, id, input, key, 'SUBMIT');
  }
  @Post('student/attempts/:attemptId/questions/:attemptQuestionId/runs')
  @HttpCode(202)
  legacyRun(
    @Req() req: AuthRequest,
    @Param('attemptId', ParseUUIDPipe) id: string,
    @Param('attemptQuestionId', ParseUUIDPipe) q: string,
    @Body() input: QuestionSubmissionDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.create(req, id, { ...input, attemptQuestionId: q }, key, 'RUN_PUBLIC');
  }
  @Post('student/attempts/:attemptId/questions/:attemptQuestionId/submissions')
  @HttpCode(202)
  legacySubmit(
    @Req() req: AuthRequest,
    @Param('attemptId', ParseUUIDPipe) id: string,
    @Param('attemptQuestionId', ParseUUIDPipe) q: string,
    @Body() input: QuestionSubmissionDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.create(req, id, { ...input, attemptQuestionId: q }, key, 'SUBMIT');
  }
  @Get(['submissions/:submissionId', 'student/attempts/:attemptId/submissions/:submissionId'])
  async get(
    @Req() req: AuthRequest,
    @Param('submissionId', ParseUUIDPipe) id: string,
    @Param('attemptId') attemptId?: string,
  ) {
    const result = await this.service.get(req.identity!.student!.id, id);
    if (attemptId && result.data.attemptId !== attemptId) {
      // An alias must enforce both resource IDs, not just ownership.
      throw new ApiException(404, 'NOT_FOUND', 'Submission not found.');
    }
    req.serverNow = result.now;
    return result.data;
  }
}
