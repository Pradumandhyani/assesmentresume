import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Environment } from '../../config/environment';
import { ApiException } from '../../common/http/api-error';
import { AuthRepository } from './repositories/auth.repository';
import { PrismaService } from '../../database/prisma.service';
import { PasswordService } from './password.service';
import { AuthSecurity, tokenHash } from './auth.security';
import type { AuthIdentity, AuthRequest } from './auth.types';
import type { LoginDto } from './dto/login.dto';
@Injectable()
export class AuthService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly passwords: PasswordService,
    private readonly security: AuthSecurity,
    private readonly config: ConfigService<Environment, true>,
    private readonly db: PrismaService,
  ) {}
  async identify(req: AuthRequest): Promise<AuthIdentity | null> {
    const raw = this.security.readToken(req);
    if (!raw) return null;
    const found = await this.repo.findSession(tokenHash(raw));
    if (!found) return null;
    req.serverNow = found.now;
    const { session } = found;
    return {
      sessionId: session.id,
      tokenHash: session.tokenHash,
      csrfTokenHash: session.csrfTokenHash,
      expiresAt: session.expiresAt,
      user: { id: session.user.id, role: session.user.role, authVersion: session.user.authVersion },
      student:
        session.user.role === 'STUDENT' && session.user.student
          ? {
              id: session.user.student.id,
              externalId: session.user.student.externalId,
              displayName: session.user.student.displayName,
            }
          : null,
      admin:
        session.user.role === 'ADMIN' && session.user.admin
          ? {
              id: session.user.admin.id,
              displayName: session.user.admin.displayName,
              email: session.user.email,
            }
          : null,
    };
  }
  async login(dto: LoginDto, req: AuthRequest) {
    const role = dto.role ?? 'STUDENT';
    const identity = await this.identify(req);
    if (identity) req.identity = identity;
    await this.security.assertCsrf(req, role);
    const identifier = dto.identifier.trim();
    const window = this.config.get('LOGIN_WINDOW_SECONDS', { infer: true });
    const ipCount = await this.repo.consumeRate(
      this.security.digest(`ip:${req.ip ?? 'unknown'}`),
      window,
    );
    if (ipCount > this.config.get('LOGIN_IP_LIMIT', { infer: true })) this.limited();
    const accountCount = await this.repo.consumeRate(
      this.security.digest(
        `${role.toLowerCase()}:${role === 'ADMIN' ? identifier.toLowerCase() : identifier}`,
      ),
      window,
    );
    if (accountCount > this.config.get('LOGIN_ACCOUNT_LIMIT', { infer: true })) this.limited();
    const student = role === 'STUDENT' ? await this.repo.findStudent(identifier) : null;
    const administrator = role === 'ADMIN' ? await this.repo.findAdmin(identifier) : null;
    const user = student?.user ?? administrator;
    const eligible = user?.isActive && user.role === role;
    const checked = await this.passwords.verify(eligible ? user.passwordHash : null, dto.password);
    if (!user || !eligible || !checked.valid || Buffer.byteLength(dto.password, 'utf8') > 1024)
      this.invalid(role);
    const replacementHash = checked.rehash
      ? await this.passwords.hash(dto.password, user.passwordHash)
      : null;
    const token = randomBytes(32).toString('base64url');
    const remember = dto.remember === true;
    const ttl = this.config.get(remember ? 'SESSION_REMEMBER_TTL_SECONDS' : 'SESSION_TTL_SECONDS', {
      infer: true,
    });
    const previous = this.security.readToken(req);
    const created = await this.db.$transaction((tx) =>
      this.repo.createSession(tx, {
        userId: user.id,
        passwordHash: user.passwordHash,
        replacementHash,
        authVersion: user.authVersion,
        tokenHash: tokenHash(token),
        csrfTokenHash: tokenHash(this.security.csrfForSession(token)),
        ttl,
        previousTokenHash: previous ? tokenHash(previous) : null,
        role,
        remember,
        requestId: req.id ?? randomUUID(),
      }),
    );
    if (!created) this.invalid(role);
    req.serverNow = created.now;
    return {
      token,
      ttl,
      remember,
      response: {
        user: {
          id: user.id,
          role,
          displayName: student?.displayName ?? administrator!.admin!.displayName,
        },
        student: student
          ? {
              id: student.id,
              externalId: student.externalId,
              displayName: student.displayName,
            }
          : null,
        admin: administrator
          ? {
              id: administrator.admin!.id,
              displayName: administrator.admin!.displayName,
              email: administrator.email,
            }
          : null,
        expiresAt: created.session.expiresAt.toISOString(),
      },
    };
  }
  profile(identity: AuthIdentity) {
    return {
      user: {
        id: identity.user.id,
        role: identity.user.role,
        displayName: identity.student?.displayName ?? identity.admin!.displayName,
      },
      student: identity.student,
      admin: identity.admin ?? null,
      expiresAt: identity.expiresAt.toISOString(),
    };
  }
  async logout(req: AuthRequest): Promise<void> {
    await this.security.assertCsrf(req);
    await this.db.$transaction((tx) =>
      this.repo.revoke(tx, req.identity!.sessionId, req.identity!.user.id, req.id ?? randomUUID()),
    );
  }
  private invalid(role: 'STUDENT' | 'ADMIN'): never {
    throw new ApiException(
      401,
      'UNAUTHENTICATED',
      role === 'ADMIN' ? 'Email or password is incorrect.' : 'Student ID or password is incorrect.',
    );
  }
  private limited(): never {
    throw new ApiException(
      429,
      'RATE_LIMITED',
      'Too many sign-in attempts. Please try again later.',
      this.config.get('LOGIN_WINDOW_SECONDS', { infer: true }),
    );
  }
}
