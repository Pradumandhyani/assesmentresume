import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from '../../modules/auth/auth.service';
import { AuthSecurity } from '../../modules/auth/auth.security';
import type { AuthRequest } from '../../modules/auth/auth.types';
import { ApiException } from '../http/api-error';
export const Public = () => SetMetadata('public', true);
export const Roles = (...roles: Array<'STUDENT' | 'ADMIN'>) => SetMetadata('roles', roles);
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    private readonly security: AuthSecurity,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    if (
      this.reflector.getAllAndOverride<boolean>('public', [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const identity = await this.auth.identify(req);
    if (!identity) throw new ApiException(401, 'UNAUTHENTICATED', 'Please sign in to continue.');
    req.identity = identity;
    const roles = this.reflector.getAllAndOverride<string[]>('roles', [
      context.getHandler(),
      context.getClass(),
    ]);
    if (
      (req.path.startsWith('/api/v1/admin') &&
        (identity.user.role !== 'ADMIN' || !identity.admin)) ||
      (roles && !roles.includes(identity.user.role))
    )
      throw new ApiException(
        403,
        'FORBIDDEN',
        'You do not have permission to access this resource.',
      );
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) await this.security.assertCsrf(req);
    return true;
  }
}
