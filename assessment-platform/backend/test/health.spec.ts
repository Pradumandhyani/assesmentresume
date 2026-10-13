import Redis from 'ioredis';
import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../src/config/environment';
import type { PrismaService } from '../src/database/prisma.service';
import { HealthService } from '../src/modules/health/health.service';
import { HealthController } from '../src/modules/health/health.controller';
import type { Response } from 'express';

jest.mock('ioredis', () => jest.fn());
describe('readiness fails closed without disclosing dependency secrets', () => {
  const redis = { status: 'ready', ping: jest.fn(), on: jest.fn(), disconnect: jest.fn() };
  const db = { now: jest.fn(), judgeWorkerHeartbeat: { count: jest.fn() } };
  let enabled: boolean;
  let service: HealthService;
  beforeEach(() => {
    jest.clearAllMocks();
    enabled = false;
    db.now.mockResolvedValue(new Date('2026-10-13T12:00:00Z'));
    db.judgeWorkerHeartbeat.count.mockResolvedValue(1);
    redis.ping.mockResolvedValue('PONG');
    (Redis as unknown as jest.Mock).mockImplementation(() => redis);
    const config = {
      get: (name: string) =>
        name === 'EXECUTION_ENABLED'
          ? enabled
          : 'redis://private-user:private-password@internal.invalid:6379',
    };
    service = new HealthService(
      db as unknown as PrismaService,
      config as unknown as ConfigService<Environment, true>,
    );
  });
  afterEach(() => service.onModuleDestroy());
  it('requires the actual database and labels disabled dependencies explicitly', async () => {
    expect(await service.ready()).toEqual({
      ready: true,
      dependencies: { database: 'READY', queue: 'DISABLED', execution: 'DISABLED' },
    });
    expect(Redis).not.toHaveBeenCalled();
  });
  it('reports 503 when the database is unavailable without exposing its error', async () => {
    db.now.mockRejectedValue(new Error('private-host private-password'));
    const result = await service.ready();
    expect(result.ready).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/private|password|host/);
    const status = jest.fn();
    await new HealthController(service).ready({ status } as unknown as Response);
    expect(status).toHaveBeenCalledWith(503);
  });
  it('requires both Redis and a fresh worker heartbeat when execution is enabled', async () => {
    enabled = true;
    expect((await service.ready()).ready).toBe(true);
    db.judgeWorkerHeartbeat.count.mockResolvedValue(0);
    expect((await service.ready()).dependencies.execution).toBe('UNAVAILABLE');
    db.judgeWorkerHeartbeat.count.mockResolvedValue(1);
    redis.ping.mockRejectedValue(new Error('private Redis connection'));
    const result = await service.ready();
    expect(result.ready).toBe(false);
    expect(result.dependencies.queue).toBe('UNAVAILABLE');
    expect(JSON.stringify(result)).not.toMatch(/private/);
  });
  it('coalesces simultaneous probes without caching subsequent stale health', async () => {
    await Promise.all([service.ready(), service.ready(), service.ready()]);
    expect(db.now).toHaveBeenCalledTimes(1);
    db.now.mockRejectedValue(new Error('unavailable'));
    expect((await service.ready()).ready).toBe(false);
    expect(db.now).toHaveBeenCalledTimes(2);
  });
  it('keeps liveness independent of readiness failure', () => {
    expect(new HealthController(service).live()).toEqual({ live: true });
  });
});
