import { Controller, Get, Req } from '@nestjs/common';
import { Roles } from '../../common/guards/session.guard';
import type { AuthRequest } from '../auth/auth.types';
@Roles('STUDENT') @Controller('student')
export class StudentsController {
  @Get('me') me(@Req() req: AuthRequest) { return req.identity!.student!; }
}
