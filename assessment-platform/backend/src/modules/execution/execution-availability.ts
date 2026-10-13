import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../database/generated/client';
import type { Environment } from '../../config/environment';
@Injectable()
export class ExecutionAvailability {
  private cached?: { until: number; ids: Set<string> };
  constructor(
    private readonly db: PrismaService,
    private readonly config: ConfigService<Environment, true>,
  ) {}
  async ready(ids: string[], tx?: Prisma.TransactionClient): Promise<boolean> {
    if (!this.config.get<boolean>('EXECUTION_ENABLED') || !ids.length) return false;
    if (!this.cached || performance.now() > this.cached.until) {
      const now = tx
        ? (await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0]!.now
        : await this.db.now();
      const workers = await (tx ?? this.db).judgeWorkerHeartbeat.findMany({
        where: { lastSeenAt: { gte: new Date(now.getTime() - 30000) } },
        select: { toolchainIds: true },
      });
      this.cached = {
        until: performance.now() + 2000,
        ids: new Set(workers.flatMap((w) => w.toolchainIds)),
      };
    }
    return ids.every((id) => this.cached!.ids.has(id));
  }
}
