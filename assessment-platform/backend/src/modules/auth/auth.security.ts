import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { CookieOptions, Response } from 'express';
import type { Environment } from '../../config/environment';
import type { AuthRequest } from './auth.types';
import { ApiException } from '../../common/http/api-error';
import { PrismaService } from '../../database/prisma.service';
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const equal = (a: string, b: string) => { const left = Buffer.from(a); const right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); };
@Injectable()
export class AuthSecurity {
  private readonly key: string;
  constructor(private readonly config: ConfigService<Environment, true>, private readonly db: PrismaService) {
    this.key = config.get('CSRF_SIGNING_KEY', { infer: true }) ?? randomBytes(32).toString('hex');
  }
  digest(value: string): string { return createHmac('sha256', this.key).update(value).digest('hex'); }
  private sign(value: string): string { return createHmac('sha256', this.key).update(value).digest('base64url'); }
  get cookieName(): string { return this.config.get('SESSION_COOKIE_NAME', { infer: true }); }
  get csrfCookieName(): string { return this.config.get('SESSION_SECURE', { infer: true }) ? '__Host-assessment_csrf' : 'assessment_csrf_dev'; }
  private cookieOptions(): CookieOptions { return { httpOnly: true, secure: this.config.get('SESSION_SECURE', { infer: true }), sameSite: 'lax', path: '/' }; }
  readToken(req: AuthRequest): string | null {
    const value: unknown = req.cookies?.[this.cookieName];
    return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
  }
  csrfForSession(token: string): string { return this.sign(`session:${token}`); }
  async issueCsrf(req: AuthRequest, res: Response) {
    const now = await this.db.now(); req.serverNow = now;
    const raw = this.readToken(req);
    if (req.identity && raw) return { csrfToken: this.csrfForSession(raw), expiresAt: req.identity.expiresAt.toISOString() };
    const expires = new Date(now.getTime() + 600000);
    const payload = `${randomBytes(32).toString('base64url')}.${expires.getTime()}`;
    const token = `${payload}.${this.sign(`preauth:${payload}`)}`;
    res.cookie(this.csrfCookieName, token, { ...this.cookieOptions(), maxAge: 600000 });
    return { csrfToken: token, expiresAt: expires.toISOString() };
  }
  async assertCsrf(req: AuthRequest): Promise<void> {
    const origin = req.get('origin');
    const token = req.get('x-csrf-token');
    if (!origin || !this.config.get('APP_ORIGINS', { infer: true }).includes(origin) || !token || token.length > 256) this.invalid();
    if (req.identity) {
      if (!equal(tokenHash(token!), req.identity.csrfTokenHash)) this.invalid();
      return;
    }
    const cookie: unknown = req.cookies?.[this.csrfCookieName];
    if (typeof cookie !== 'string' || !equal(cookie, token!)) this.invalid();
    const parts = token!.split('.');
    if (parts.length !== 3 || !equal(parts[2]!, this.sign(`preauth:${parts[0]}.${parts[1]}`))) this.invalid();
    const now = await this.db.now(); req.serverNow = now;
    const expires = Number(parts[1]);
    if (!Number.isSafeInteger(expires) || expires <= now.getTime() || expires > now.getTime() + 600000) this.invalid();
  }
  setSession(res: Response, token: string, ttl: number, remember: boolean): void {
    res.cookie(this.cookieName, token, { ...this.cookieOptions(), ...(remember ? { maxAge: ttl * 1000 } : {}) });
    res.clearCookie(this.csrfCookieName, this.cookieOptions());
  }
  clear(res: Response): void { res.clearCookie(this.cookieName, this.cookieOptions()); res.clearCookie(this.csrfCookieName, this.cookieOptions()); }
  private invalid(): never { throw new ApiException(403, 'CSRF_INVALID', 'Your security token expired. Refresh and try again.'); }
}
