import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../common/guards/session.guard';
import { HealthService } from './health.service';

@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly service: HealthService) {}
  @Get('live')
  live() {
    return { live: true };
  }
  @Get('ready')
  async ready(@Res({ passthrough: true }) response: Response) {
    const result = await this.service.ready();
    response.status(result.ready ? 200 : 503);
    return result;
  }
}
