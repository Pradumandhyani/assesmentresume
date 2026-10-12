import type { OperationHandler } from '../../common/contracts/operation-handler';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { Language } from '../../database/generated/client';
import { Roles } from '../../common/guards/session.guard';
import { ApiException } from '../../common/http/api-error';
import type { AuthRequest } from '../auth/auth.types';
import { AttemptsService } from './attempts.service';
import { FinalizeAttemptDto, SaveDraftDto, SelectLanguageDto } from './dto/attempt-input.dto';
// Original Step 1 controller type is retained alongside registered Step 3 routes.
export interface AttemptsControllerContract {
  readonly handle: OperationHandler;
}
const key = (value: string | undefined) => {
  if (!value || !/^[a-zA-Z0-9_-]{16,128}$/.test(value))
    throw new ApiException(400, 'VALIDATION_FAILED', 'A valid Idempotency-Key header is required.');
  return value;
};
@Roles('STUDENT')
@Controller()
export class AttemptsController {
  constructor(private readonly service: AttemptsService) {}
  private respond<T>(req: AuthRequest, result: { data: T; now: Date }) {
    req.serverNow = result.now;
    return result.data;
  }
  @Post(['assessments/:assessmentId/start', 'student/assessments/:assessmentId/attempts'])
  @HttpCode(200)
  async start(
    @Req() req: AuthRequest,
    @Param('assessmentId', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') idempotency?: string,
  ) {
    return this.respond(req, await this.service.start(req.identity!, id, key(idempotency)));
  }
  @Get(['attempts/:attemptId', 'student/attempts/:attemptId'])
  async get(@Req() req: AuthRequest, @Param('attemptId', ParseUUIDPipe) id: string) {
    return this.respond(req, await this.service.get(req.identity!.student!.id, id));
  }
  @Get([
    'attempts/:attemptId/questions/:attemptQuestionId',
    'student/attempts/:attemptId/questions/:attemptQuestionId',
  ])
  async question(
    @Req() req: AuthRequest,
    @Param('attemptId', ParseUUIDPipe) id: string,
    @Param('attemptQuestionId', ParseUUIDPipe) q: string,
  ) {
    return this.respond(req, await this.service.question(req.identity!.student!.id, id, q));
  }
  @Get(['attempts/:attemptId/drafts', 'student/attempts/:attemptId/drafts'])
  async drafts(@Req() req: AuthRequest, @Param('attemptId', ParseUUIDPipe) id: string) {
    const result = await this.service.get(req.identity!.student!.id, id);
    return this.respond(req, { data: { items: result.data.drafts }, now: result.now });
  }
  @Put([
    'attempts/:attemptId/drafts/:attemptQuestionId/:language',
    'student/attempts/:attemptId/questions/:attemptQuestionId/drafts/:language',
  ])
  async save(
    @Req() req: AuthRequest,
    @Param('attemptId', ParseUUIDPipe) id: string,
    @Param('attemptQuestionId', ParseUUIDPipe) q: string,
    @Param('language', new ParseEnumPipe(Language)) language: Language,
    @Body() input: SaveDraftDto,
  ) {
    return this.respond(
      req,
      await this.service.save(req.identity!.student!.id, id, q, language, input),
    );
  }
  @Patch([
    'attempts/:attemptId/questions/:attemptQuestionId/language',
    'student/attempts/:attemptId/questions/:attemptQuestionId/language',
  ])
  async language(
    @Req() req: AuthRequest,
    @Param('attemptId', ParseUUIDPipe) id: string,
    @Param('attemptQuestionId', ParseUUIDPipe) q: string,
    @Body() input: SelectLanguageDto,
  ) {
    return this.respond(
      req,
      await this.service.select(
        req.identity!.student!.id,
        id,
        q,
        input.language,
        input.expectedStateVersion,
      ),
    );
  }
  @Post(['attempts/:attemptId/finalization', 'attempts/:attemptId/finalize', 'student/attempts/:attemptId/finalization'])
  @HttpCode(202)
  async finalize(
    @Req() req: AuthRequest,
    @Param('attemptId', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') idempotency: string | undefined,
    @Body() input: FinalizeAttemptDto,
  ) {
    return this.respond(
      req,
      await this.service.finalize(req.identity!, id, key(idempotency), input.expectedStateVersion),
    );
  }
  @Get('attempts/:attemptId/history')
  async history(@Req() req: AuthRequest, @Param('attemptId', ParseUUIDPipe) id: string) {
    return this.respond(req, await this.service.history(req.identity!.student!.id, id));
  }
}
