import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Roles } from '../../common/guards/session.guard';
import type { AuthRequest } from '../auth/auth.types';
import { AssessmentManagementService } from './assessment-management.service';
import { QuestionManagementService } from './question-management.service';
import { AdminReportingService } from './admin-reporting.service';
import {
  parseInput,
  pageInput,
  assessmentInput,
  questionInput,
  studentInput,
  assignmentInput,
  revisionInput,
} from './dto/management-input';
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly assessments: AssessmentManagementService,
    private readonly questions: QuestionManagementService,
    private readonly reports: AdminReportingService,
  ) {}
  @Get('dashboard') dashboard() {
    return this.reports.dashboard();
  }
  @Get('settings') settings() {
    return this.reports.settings();
  }
  @Get('students') students(@Query() q: unknown) {
    return this.reports.students(parseInput(pageInput, q));
  }
  @Patch('students/:id') studentUpdate(
    @Req() r: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown,
  ) {
    return this.reports.studentUpdate(r.identity!, id, key, parseInput(studentInput, body));
  }
  @Get('assessments') assessmentList(@Query() q: unknown) {
    return this.assessments.list(parseInput(pageInput, q));
  }
  @Get('assessments/:id') assessmentDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.assessments.detail(id);
  }
  @Post('assessments') @HttpCode(200) assessmentCreate(
    @Req() r: AuthRequest,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown,
  ) {
    return this.assessments.create(r.identity!, key, parseInput(assessmentInput, body));
  }
  @Patch('assessments/:id') assessmentUpdate(
    @Req() r: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown,
  ) {
    return this.assessments.update(r.identity!, id, key, parseInput(assessmentInput, body));
  }
  @Post('assessments/:id/publish') @HttpCode(200) assessmentPublish(
    @Req() r: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown,
  ) {
    return this.assessments.publish(r.identity!, id, key, parseInput(revisionInput, body).revision);
  }
  @Post('assessments/:id/cancel') @HttpCode(200) assessmentCancel(
    @Req() r: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown,
  ) {
    return this.assessments.cancel(r.identity!, id, key, parseInput(revisionInput, body).revision);
  }
  @Post('assessments/:id/assignments') @HttpCode(200) assign(
    @Req() r: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown,
  ) {
    return this.assessments.assign(r.identity!, id, key, parseInput(assignmentInput, body));
  }
  @Get('assessments/:id/monitor') monitor(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: unknown,
  ) {
    return this.assessments.monitor(id, parseInput(pageInput, q));
  }
  @Get('questions') questionList(@Query() q: unknown) {
    return this.questions.list(parseInput(pageInput, q));
  }
  @Get('questions/:id') questionDetail(
    @Req() r: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.questions.detail(r.identity!, id);
  }
  @Post('questions') @HttpCode(200) questionCreate(
    @Req() r: AuthRequest,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown,
  ) {
    return this.questions.create(r.identity!, key, parseInput(questionInput, body));
  }
  @Patch('questions/:id') questionUpdate(
    @Req() r: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown,
  ) {
    return this.questions.update(r.identity!, id, key, parseInput(questionInput, body));
  }
  @Post('questions/:id/draft') @HttpCode(200) questionDraft(
    @Req() r: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown,
  ) {
    return this.questions.draft(r.identity!, id, key, parseInput(revisionInput, body).revision);
  }
  @Post('questions/:id/validate') @HttpCode(200) questionValidate(
    @Req() r: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.questions.validate(r.identity!, id, parseInput(revisionInput, body).revision);
  }
  @Post('questions/:id/publish') @HttpCode(200) questionPublish(
    @Req() r: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown,
  ) {
    return this.questions.publish(r.identity!, id, key, parseInput(revisionInput, body).revision);
  }
  @Post('questions/:id/archive') @HttpCode(200) questionArchive(
    @Req() r: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown,
  ) {
    return this.questions.archive(r.identity!, id, key, parseInput(revisionInput, body).revision);
  }
  @Get('submissions') submissions(@Query() q: unknown) {
    return this.reports.submissions(parseInput(pageInput, q));
  }
  @Get('results/export') async export(
    @Req() r: AuthRequest,
    @Query() q: unknown,
    @Res() response: Response,
  ) {
    const csv = await this.reports.export(r.identity!, parseInput(pageInput, q));
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', 'attachment; filename="assessment-results.csv"');
    response.setHeader('Cache-Control', 'no-store');
    response.status(200).send(csv);
  }
  @Get('results') results(@Query() q: unknown) {
    return this.reports.results(parseInput(pageInput, q));
  }
  @Get('audit-logs') audit(@Query() q: unknown) {
    return this.reports.audit(parseInput(pageInput, q));
  }
}
