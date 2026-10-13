import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client';
import { ApiException } from '../common/http/api-error';
import type { Environment } from '../config/environment';

/** Dedicated administration identity. Never injected into a student-facing service. */
@Injectable()
export class AdminPrismaService extends PrismaClient implements OnModuleDestroy {
  readonly configured: boolean;
  constructor(config: ConfigService<Environment, true>) {
    const url = config.get('ADMIN_DATABASE_URL', { infer: true });
    const production = config.get('NODE_ENV', { infer: true }) === 'production';
    super({
      adapter: new PrismaPg({
        connectionString: url ?? config.get('DATABASE_URL', { infer: true }),
        max: config.get('ADMIN_DATABASE_POOL_MAX', { infer: true }) ?? 5,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 30000,
      }),
    });
    this.configured = !production || !!url;
  }
  assertConfigured() {
    if (!this.configured)
      throw new ApiException(
        503,
        'SERVICE_UNAVAILABLE',
        'Administration database identity is not configured.',
      );
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
