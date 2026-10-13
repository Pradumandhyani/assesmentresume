import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AdminPrismaService } from '../../../database/admin-prisma.service';
import { Prisma } from '../../../database/generated/client';
import { ApiException } from '../../../common/http/api-error';
import type { AuthIdentity } from '../../auth/auth.types';

export const missing = () => new ApiException(404, 'NOT_FOUND', 'Resource not found.');
export const immutable = () =>
  new ApiException(
    409,
    'VERSION_IMMUTABLE',
    'Published configuration is immutable. Create a new draft.',
  );
export const conflict = () =>
  new ApiException(409, 'REVISION_CONFLICT', 'This item changed. Refresh before saving.');
export const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
@Injectable()
export class ManagementRepository {
  constructor(readonly db: AdminPrismaService) {}
  async now() {
    this.db.assertConfigured();
    return (await this.db.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0]!.now;
  }
  async adminId(identity: AuthIdentity, tx: Prisma.TransactionClient) {
    const admin = await tx.admin.findUnique({
      where: { userId: identity.user.id },
      select: { id: true },
    });
    if (!admin) throw new ApiException(403, 'FORBIDDEN', 'An administrator profile is required.');
    return admin.id;
  }
  async assertActor(identity: AuthIdentity, tx: Prisma.TransactionClient) {
    const [actor] = await tx.$queryRaw<
      { role: string; is_active: boolean; auth_version: number }[]
    >`SELECT role,is_active,auth_version FROM users WHERE id=${identity.user.id}::uuid FOR SHARE`;
    if (
      !actor ||
      identity.user.role !== 'ADMIN' ||
      actor.role !== 'ADMIN' ||
      !actor.is_active ||
      actor.auth_version !== identity.user.authVersion
    )
      throw new ApiException(
        403,
        'FORBIDDEN',
        'Administrator authorization changed. Sign in again.',
      );
    await this.adminId(identity, tx);
  }
  async audit(
    tx: Prisma.TransactionClient,
    identity: AuthIdentity,
    action: string,
    type: string,
    id: string | null,
    metadata: Prisma.InputJsonValue = {},
  ) {
    await tx.auditLog.create({
      data: {
        actorUserId: identity.user.id,
        action,
        entityType: type,
        entityId: id,
        requestId: randomUUID(),
        metadata,
      },
    });
  }
  async mutate<T extends Prisma.InputJsonObject>(
    identity: AuthIdentity,
    operation: string,
    key: string | undefined,
    input: unknown,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    this.db.assertConfigured();
    if (!key || !/^[A-Za-z0-9_-]{16,128}$/.test(key))
      throw new ApiException(400, 'VALIDATION_FAILED', 'A valid Idempotency-Key is required.');
    const requestHash = digest(input);
    for (let retry = 0; ; retry++)
      try {
        return await this.db.$transaction(
          async (tx) => {
            await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '3s'");
            await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '10s'");
            await this.assertActor(identity, tx);
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${identity.user.id + operation + key})::bigint)`;
            const previous = await tx.idempotencyRecord.findUnique({
              where: { userId_operation_key: { userId: identity.user.id, operation, key } },
            });
            if (previous) {
              if (previous.requestHash !== requestHash)
                throw new ApiException(
                  409,
                  'IDEMPOTENCY_CONFLICT',
                  'Request key was used with different input.',
                );
              return previous.responseBody as T;
            }
            const result = await work(tx),
              now = (await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0]!.now;
            await tx.idempotencyRecord.create({
              data: {
                userId: identity.user.id,
                operation,
                key,
                requestHash,
                responseCode: 200,
                responseBody: result,
                expiresAt: new Date(now.getTime() + 7 * 86400000),
              },
            });
            return result;
          },
          { timeout: 20000 },
        );
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034' &&
          retry < 3
        )
          continue;
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
          throw new ApiException(409, 'REVISION_CONFLICT', 'This identifier already exists.');
        throw error;
      }
  }
}
