import type { Prisma } from '../../../database/generated/client';
// Domain writes must receive the caller's transaction; repositories never open nested transactions.
export interface AuthRepositoryContract {
  readonly transaction: Prisma.TransactionClient;
}

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';

@Injectable()
export class AuthRepository {
  constructor(private readonly db: PrismaService) {}
  findStudent(identifier: string) {
    return this.db.student.findUnique({
      where: { externalId: identifier },
      include: { user: true },
    });
  }
  async findAdmin(identifier: string) {
    // Legacy email casing is preserved; ambiguous case-folded identities fail closed.
    const users = await this.db.user.findMany({
      where: { email: { equals: identifier, mode: 'insensitive' }, role: 'ADMIN' },
      include: { admin: true },
      take: 2,
    });
    return users.length === 1 && users[0]!.admin ? users[0]! : null;
  }
  async createSession(
    tx: Prisma.TransactionClient,
    input: {
      userId: string;
      passwordHash: string;
      replacementHash: string | null;
      authVersion: number;
      tokenHash: string;
      csrfTokenHash: string;
      ttl: number;
      previousTokenHash: string | null;
      role: 'STUDENT' | 'ADMIN';
      remember: boolean;
      requestId: string;
    },
  ) {
    // Lock identity while checking active state, rotating legacy hashes and issuing a session.
    const [user] = await tx.$queryRaw<
      { password_hash: string; is_active: boolean; auth_version: number; role: string }[]
    >`SELECT password_hash, is_active, auth_version, role FROM users WHERE id = ${input.userId}::uuid FOR UPDATE`;
    if (
      !user ||
      !user.is_active ||
      user.role !== input.role ||
      user.password_hash !== input.passwordHash ||
      user.auth_version !== input.authVersion
    )
      return null;
    if (input.replacementHash)
      await tx.user.update({
        where: { id: input.userId },
        data: { passwordHash: input.replacementHash },
      });
    const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    if (!clock) throw new Error('Database clock unavailable');
    if (input.previousTokenHash)
      await tx.authSession.updateMany({
        where: { tokenHash: input.previousTokenHash, revokedAt: null },
        data: { revokedAt: clock.now },
      });
    const session = await tx.authSession.create({
      data: {
        userId: input.userId,
        tokenHash: input.tokenHash,
        csrfTokenHash: input.csrfTokenHash,
        authVersion: input.authVersion,
        expiresAt: new Date(clock.now.getTime() + input.ttl * 1000),
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: input.userId,
        action: 'AUTH_LOGIN',
        entityType: 'auth_session',
        entityId: session.id,
        requestId: input.requestId,
        metadata: { role: input.role, remember: input.remember },
      },
    });
    return { session, now: clock.now };
  }
  async findSession(tokenHash: string) {
    const session = await this.db.authSession.findUnique({
      where: { tokenHash },
      include: {
        user: {
          select: {
            id: true,
            role: true,
            isActive: true,
            authVersion: true,
            email: true,
            student: { select: { id: true, externalId: true, displayName: true } },
            admin: { select: { id: true, displayName: true } },
          },
        },
      },
    });
    const now = await this.db.now();
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= now ||
      !session.user.isActive ||
      session.authVersion !== session.user.authVersion ||
      (session.user.role === 'STUDENT' && !session.user.student) ||
      (session.user.role === 'ADMIN' && !session.user.admin)
    )
      return null;
    return { session, now };
  }
  async revoke(tx: Prisma.TransactionClient, sessionId: string, userId: string, requestId: string) {
    const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    if (!clock) throw new Error('Database clock unavailable');
    await tx.authSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: clock.now },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        action: 'AUTH_LOGOUT',
        entityType: 'auth_session',
        entityId: sessionId,
        requestId,
        metadata: {},
      },
    });
  }
  async consumeRate(key: string, windowSeconds: number): Promise<number> {
    const [row] = await this.db.$queryRaw<{ count: number }[]>`
      INSERT INTO login_rate_limits (key, count, expires_at)
      VALUES (${key}, 1, clock_timestamp() + ${windowSeconds} * interval '1 second')
      ON CONFLICT (key) DO UPDATE SET
        count = CASE WHEN login_rate_limits.expires_at <= clock_timestamp() THEN 1 ELSE login_rate_limits.count + 1 END,
        expires_at = CASE WHEN login_rate_limits.expires_at <= clock_timestamp() THEN EXCLUDED.expires_at ELSE login_rate_limits.expires_at END
      RETURNING count`;
    if (!row) throw new Error('Rate limiter unavailable');
    return row.count;
  }
}
