import { Controller, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { Roles } from '../../common/guards/session.guard';
import type { AuthRequest } from '../auth/auth.types';
import { AttemptHeartbeatService } from './attempt-heartbeat.service';

@Roles('STUDENT')
@Controller('attempts')
export class AttemptHeartbeatController {
  constructor(private readonly service: AttemptHeartbeatService) {}
  @Post(':attemptId/heartbeat')
  @HttpCode(200)
  async heartbeat(@Req() request: AuthRequest, @Param('attemptId', ParseUUIDPipe) id: string) {
    const response = await this.service.heartbeat(request.identity!.student!.id, id);
    request.serverNow = response.now;
    return response.data;
  }
}
