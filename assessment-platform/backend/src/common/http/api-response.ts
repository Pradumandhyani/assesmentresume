import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { map } from 'rxjs/operators';
import { ApiException } from './api-error';

export type ApiRequest = Request & { id?: string; serverNow?: Date };
export function requestMeta(req: ApiRequest) {
  return {
    requestId: (req.id ??= randomUUID()),
    serverNow: (req.serverNow ?? new Date()).toISOString(),
  };
}
@Injectable()
export class ApiResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const req = context.switchToHttp().getRequest<ApiRequest>();
    const res = context.switchToHttp().getResponse<Response>();
    res.setHeader('Cache-Control', 'no-store');
    return next.handle().pipe(
      map((data: unknown) => {
        if (res.headersSent) return data; // Explicit CSV response owns its headers and body.
        const meta = requestMeta(req);
        res.setHeader('X-Request-Id', meta.requestId);
        res.setHeader('X-Server-Time', meta.serverNow);
        return { data, meta };
      }),
    );
  }
}
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const req = host.switchToHttp().getRequest<ApiRequest>();
    const res = host.switchToHttp().getResponse<Response>();
    const parserType = exception instanceof Error && 'type' in exception ? exception.type : null;
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : parserType === 'entity.too.large'
          ? 413
          : parserType === 'entity.parse.failed'
            ? 400
            : 503;
    const payload =
      exception instanceof ApiException
        ? (exception.getResponse() as { code: string; message: string })
        : null;
    const meta = requestMeta(req);
    const code =
      payload?.code ??
      {
        400: 'VALIDATION_FAILED',
        413: 'VALIDATION_FAILED',
        401: 'UNAUTHENTICATED',
        403: 'FORBIDDEN',
        404: 'NOT_FOUND',
        429: 'RATE_LIMITED',
      }[status] ??
      'SERVICE_UNAVAILABLE';
    // Never serialize exception messages, database errors, rejected values or stack traces.
    const message =
      payload?.message ??
      (status === 413
        ? 'The request body exceeds the allowed size.'
        : status === 400
          ? 'Check the supplied fields.'
          : status === 404
            ? 'Resource not found.'
            : 'The service is temporarily unavailable. Please retry.');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Request-Id', meta.requestId);
    if (status === 429 || status === 503)
      res.setHeader(
        'Retry-After',
        String(exception instanceof ApiException ? exception.retryAfterSeconds : 5),
      );
    res.status(status).json({ error: { code, message, ...meta, details: [] } });
  }
}
