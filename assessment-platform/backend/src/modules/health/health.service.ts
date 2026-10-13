import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { type RedisOptions } from 'ioredis';
import type { Environment } from '../../config/environment';
import { PrismaService } from '../../database/prisma.service';
import { redisConnection } from '../../queues/execution-queues';

export interface Readiness {
  ready: boolean;
  dependencies: {
    database: 'READY' | 'UNAVAILABLE';
    queue: 'READY' | 'UNAVAILABLE' | 'DISABLED';
    execution: 'READY' | 'UNAVAILABLE' | 'DISABLED';
  };
}

@Injectable()
export class HealthService implements OnModuleDestroy {
  private redis: Redis | undefined;
  private inFlight: Promise<Readiness> | undefined;
  constructor(
    private readonly db: PrismaService,
    private readonly config: ConfigService<Environment, true>,
  ) {}

  private async bounded<T>(operation: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('HEALTH_TIMEOUT')), 1500);
          timer.unref();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async queueReady(): Promise<boolean> {
    try {
      if (!this.redis) {
        this.redis = new Redis({
          ...(redisConnection(this.config.get('REDIS_QUEUE_URL', { infer: true })) as RedisOptions),
          lazyConnect: true,
          retryStrategy: null,
          connectTimeout: 1000,
          commandTimeout: 1000,
          maxRetriesPerRequest: 0,
          enableOfflineQueue: false,
        });
        this.redis.on('error', () => {});
      }
      if (this.redis.status === 'wait') await this.bounded(this.redis.connect());
      if (this.redis.status !== 'ready') {
        this.redis.disconnect();
        this.redis = undefined;
        return false;
      }
      return (await this.bounded(this.redis.ping())) === 'PONG';
    } catch {
      this.redis?.disconnect();
      this.redis = undefined;
      return false;
    }
  }

  ready(): Promise<Readiness> {
    // Coalesce overlapping probes, never cache an obsolete healthy response.
    this.inFlight ??= this.check().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private async check(): Promise<Readiness> {
    const executionEnabled = this.config.get('EXECUTION_ENABLED', { infer: true });
    let database: Readiness['dependencies']['database'];
    let execution: Readiness['dependencies']['execution'] = executionEnabled
      ? 'UNAVAILABLE'
      : 'DISABLED';
    try {
      const now = await this.bounded(this.db.now());
      database = 'READY';
      if (executionEnabled) {
        const workers = await this.bounded(
          this.db.judgeWorkerHeartbeat.count({
            where: { lastSeenAt: { gte: new Date(now.getTime() - 30000) } },
          }),
        );
        execution = workers > 0 ? 'READY' : 'UNAVAILABLE';
      }
    } catch {
      database = 'UNAVAILABLE';
    }
    const queue = executionEnabled
      ? (await this.queueReady())
        ? 'READY'
        : 'UNAVAILABLE'
      : 'DISABLED';
    return {
      ready: database === 'READY' && queue !== 'UNAVAILABLE' && execution !== 'UNAVAILABLE',
      dependencies: { database, queue, execution },
    };
  }

  onModuleDestroy(): void {
    this.redis?.disconnect();
  }
}
