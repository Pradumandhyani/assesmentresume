import type { Response, NextFunction } from 'express';
import type { AuthRequest } from '../../modules/auth/auth.types';
import type { AuthService } from '../../modules/auth/auth.service';
import type { AuthSecurity } from '../../modules/auth/auth.security';
import { ApiException } from './api-error';
import { requestMeta } from './api-response';

/** Authenticate/authorize/CSRF-check before accepting a larger confidential authoring body. */
export function protectAdminBody(auth: AuthService, security: AuthSecurity) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      next();
      return;
    }
    try {
      const identity = await auth.identify(req);
      if (!identity) throw new ApiException(401, 'UNAUTHENTICATED', 'Please sign in to continue.');
      if (identity.user.role !== 'ADMIN')
        throw new ApiException(403, 'FORBIDDEN', 'Administrator access is required.');
      req.identity = identity;
      await security.assertCsrf(req);
      next();
    } catch (error) {
      const known = error instanceof ApiException;
      const value = known ? (error.getResponse() as { code: string; message: string }) : null;
      const meta = requestMeta(req);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Request-Id', meta.requestId);
      res
        .status(known ? error.getStatus() : 503)
        .json({
          error: {
            code: value?.code ?? 'SERVICE_UNAVAILABLE',
            message: value?.message ?? 'The service is temporarily unavailable.',
            ...meta,
            details: [],
          },
        });
    }
  };
}
