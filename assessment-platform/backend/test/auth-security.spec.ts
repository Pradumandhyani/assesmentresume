import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'dotenv';
import type { PrismaService } from '../src/database/prisma.service';
import { AuthSecurity, tokenHash } from '../src/modules/auth/auth.security';
import type { AuthRequest } from '../src/modules/auth/auth.types';
import { validateEnvironment, type Environment } from '../src/config/environment';

describe('administrator mutation origin and CSRF boundaries', () => {
  const token = 'test-session-csrf-token';
  const request = (origin: string): AuthRequest =>
    ({
      get: (name: string) =>
        name === 'origin' ? origin : name === 'x-csrf-token' ? token : undefined,
      is: () => 'application/json',
      identity: {
        user: { id: 'b5500000-0000-4000-8000-000000000001', role: 'ADMIN', authVersion: 1 },
        csrfTokenHash: tokenHash(token),
      },
    }) as unknown as AuthRequest;
  const security = (extra: Record<string, string | undefined> = {}) => {
    const env = validateEnvironment({
      ...parse(readFileSync(resolve(__dirname, '../.env.example'))),
      ADMIN_ORIGINS: 'http://localhost:3001',
      ...extra,
    });
    return new AuthSecurity(new ConfigService<Environment, true>(env), {} as PrismaService);
  };
  it('rejects a student application origin for an administrator mutation', async () => {
    await expect(security().assertCsrf(request('http://localhost:3000'))).rejects.toMatchObject({
      status: 403,
    });
    await expect(security().assertCsrf(request('http://localhost:3001'))).resolves.toBeUndefined();
  });
  it('binds administrator login to its trusted origin even before authentication', async () => {
    const req = request('http://localhost:3000');
    delete req.identity;
    await expect(security().assertCsrf(req, 'ADMIN')).rejects.toMatchObject({ status: 403 });
  });
  it('restricts production administrator mutations to the administrator HTTPS origin', async () => {
    const service = security({
      NODE_ENV: 'production',
      SESSION_SECURE: 'true',
      SESSION_COOKIE_NAME: '__Host-assessment_session',
      APP_ORIGINS: 'https://students.example.com',
      ADMIN_ORIGINS: 'https://admin.example.com',
      CSRF_SIGNING_KEY: 'test-only-signing-key-with-at-least-32-characters',
    });
    await expect(service.assertCsrf(request('https://students.example.com'))).rejects.toMatchObject(
      { status: 403 },
    );
    await expect(service.assertCsrf(request('https://admin.example.com'))).resolves.toBeUndefined();
  });
  it('fails closed for production administrator mutations without an explicit administrator origin', async () => {
    const service = security({
      NODE_ENV: 'production',
      SESSION_SECURE: 'true',
      SESSION_COOKIE_NAME: '__Host-assessment_session',
      APP_ORIGINS: 'https://students.example.com',
      ADMIN_ORIGINS: undefined,
      CSRF_SIGNING_KEY: 'test-only-signing-key-with-at-least-32-characters',
    });
    await expect(service.assertCsrf(request('https://students.example.com'))).rejects.toMatchObject(
      { status: 403 },
    );
  });
});
