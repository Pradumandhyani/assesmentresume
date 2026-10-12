import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../common/guards/session.guard';
import { AuthService } from './auth.service';
import { AuthSecurity } from './auth.security';
import type { AuthRequest } from './auth.types';
import { LoginDto } from './dto/login.dto';
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly security: AuthSecurity,
  ) {}
  @Public()
  @Get('csrf')
  async csrf(@Req() req: AuthRequest, @Res({ passthrough: true }) res: Response) {
    const identity = await this.auth.identify(req);
    if (identity) req.identity = identity;
    return this.security.issueCsrf(req, res);
  }
  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(dto, req);
    this.security.setSession(res, result.token, result.ttl, result.remember);
    return result.response;
  }
  @Get(['me', 'session']) me(@Req() req: AuthRequest) {
    return this.auth.profile(req.identity!);
  }
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: AuthRequest, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req);
    this.security.clear(res);
    return { revoked: true };
  }
}
