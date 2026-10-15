import 'reflect-metadata';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import type { Environment } from './config/environment';
import { json } from 'express';
import { AuthService } from './modules/auth/auth.service';
import { AuthSecurity } from './modules/auth/auth.security';
import { protectAdminBody } from './common/http/admin-body-parser';
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });
  app.useLogger(app.get(Logger));
  const config = app.get(ConfigService<Environment, true>);
  app.setGlobalPrefix('api/v1');
  app.disable('x-powered-by');
  app.use(
    helmet({
      hsts:
        config.get('NODE_ENV', { infer: true }) === 'production'
          ? { maxAge: 31536000, includeSubDomains: true }
          : false,
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  app.use(cookieParser());
  app.use(
    '/api/v1/admin',
    protectAdminBody(app.get(AuthService), app.get(AuthSecurity)),
    json({ limit: '12mb' }),
  );
  // A 64 KiB source snapshot can expand to six bytes per character in JSON escaping.
  app.useBodyParser('json', { limit: '512kb' });
  app.useBodyParser('urlencoded', { extended: false, limit: '128kb' });
  app
    .getHttpAdapter()
    .getInstance()
    .set('trust proxy', config.get('TRUST_PROXY_HOPS', { infer: true }));
  app.enableCors({
    origin: config.get('APP_ORIGINS', { infer: true }),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'Idempotency-Key', 'X-Request-Id'],
  });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableShutdownHooks();
  await app.listen(config.get('PORT', { infer: true }), '0.0.0.0');
}
void bootstrap();
