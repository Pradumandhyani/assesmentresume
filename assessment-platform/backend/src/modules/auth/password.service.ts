import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { compare } from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import type { Environment } from '../../config/environment';
import { ApiException } from '../../common/http/api-error';
function argonSettings(stored: string | null) {
  if (!stored || stored.length >= 512) return null;
  const match = stored.match(/^\$argon2(id|i|d)\$v=19\$([^$]+)\$/);
  const entries = match?.[2]?.split(',') ?? [];
  if (!match || entries.length !== 3 || !entries.every((entry) => /^[mtp]=\d+$/.test(entry)))
    return null;
  const parameters = new Map(entries.map((entry) => entry.split('=')) as Array<[string, string]>);
  const memory = Number(parameters.get('m'));
  const time = Number(parameters.get('t'));
  const parallelism = Number(parameters.get('p'));
  if (
    parameters.size !== 3 ||
    memory < 8192 ||
    memory > 262144 ||
    time < 1 ||
    time > 10 ||
    parallelism < 1 ||
    parallelism > 4 ||
    ![memory, time, parallelism].every(Number.isSafeInteger)
  )
    return null;
  return { algorithm: match[1], memory, time, parallelism };
}
@Injectable()
export class PasswordService implements OnModuleInit {
  private dummy = '';
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  constructor(private readonly config: ConfigService<Environment, true>) {}
  private options(): argon2.HashOptions {
    return {
      type: argon2.argon2id,
      memoryCost: this.config.get('ARGON2_MEMORY_KIB', { infer: true }),
      timeCost: this.config.get('ARGON2_TIME_COST', { infer: true }),
      parallelism: this.config.get('ARGON2_PARALLELISM', { infer: true }),
    };
  }
  async onModuleInit() {
    this.dummy = await this.hash(randomBytes(32).toString('hex'));
  }
  private async bounded<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active >= 4) {
      if (this.waiting.length >= 32)
        throw new ApiException(
          503,
          'SERVICE_UNAVAILABLE',
          'Sign-in is busy. Please retry shortly.',
        );
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else this.active++;
    try {
      return await operation();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
  async hash(password: string, previousHash?: string): Promise<string> {
    const previous = argonSettings(previousHash ?? null);
    const policy = this.options();
    const options = {
      ...policy,
      memoryCost: Math.max(policy.memoryCost!, previous?.memory ?? 0),
      timeCost: Math.max(policy.timeCost!, previous?.time ?? 0),
    };
    return this.bounded(() => argon2.hash(password, options));
  }
  async verify(
    stored: string | null,
    password: string,
  ): Promise<{ valid: boolean; rehash: boolean }> {
    return this.bounded(async () => {
      const argon = argonSettings(stored);
      const bcrypt = stored?.match(/^\$2[aby]\$(\d\d)\$[./A-Za-z0-9]{53}$/);
      try {
        if (stored && argon) {
          const valid = await argon2.verify(stored, password);
          const policy = this.options();
          return {
            valid,
            rehash:
              valid &&
              (argon.algorithm !== 'id' ||
                argon.memory < policy.memoryCost! ||
                argon.time < policy.timeCost!),
          };
        }
        if (
          stored &&
          bcrypt &&
          Number(bcrypt[1]) >= 8 &&
          Number(bcrypt[1]) <= 14 &&
          Buffer.byteLength(password, 'utf8') <= 72
        ) {
          return {
            valid: await compare(password, stored.replace(/^\$2y\$/, '$2b$')),
            rehash: true,
          };
        }
      } catch {
        /* Unsupported or corrupt hashes fail closed. */
      }
      await argon2.verify(this.dummy, password);
      return { valid: false, rehash: false };
    });
  }
}
