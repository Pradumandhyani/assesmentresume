import { Controller, Get, Param, ParseUUIDPipe, Query, Req } from '@nestjs/common';
import { Roles } from '../../common/guards/session.guard';
import type { AuthRequest } from '../auth/auth.types';
import { AssessmentsService } from './assessments.service';
import { ListAssessmentsDto } from './dto/list-assessments.dto';
@Roles('STUDENT')
@Controller()
export class AssessmentsController {
  constructor(private readonly service: AssessmentsService) {}
  @Get('assessments') async list(@Req() req: AuthRequest, @Query() query: ListAssessmentsDto) {
    const result = await this.service.list(req.identity!.student!.id, query);
    req.serverNow = result.now;
    return result.data;
  }
  @Get('assessments/upcoming') async upcoming(
    @Req() req: AuthRequest,
    @Query() query: ListAssessmentsDto,
  ) {
    const result = await this.service.list(req.identity!.student!.id, query, 'upcoming');
    req.serverNow = result.now;
    return result.data;
  }
  @Get('student/assessments') async legacy(
    @Req() req: AuthRequest,
    @Query() query: ListAssessmentsDto,
  ) {
    const result = await this.service.list(req.identity!.student!.id, query, 'legacy');
    req.serverNow = result.now;
    return result.data;
  }
  @Get('assessments/:id/eligibility') async eligibility(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.service.own(req.identity!.student!.id, id);
    req.serverNow = result.now;
    return result.item.eligibility;
  }
  @Get('student/assessments/:id') async detail(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.service.own(req.identity!.student!.id, id);
    req.serverNow = result.now;
    return {
      assessment: result.item.assessment,
      rules: result.item.rules,
      resultsReleaseAt: result.row.assessment.resultsReleaseAt?.toISOString() ?? null,
    };
  }
}
