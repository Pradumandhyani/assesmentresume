import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { compare } from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import type { Environment } from '../../config/environment';
import { ApiException } from '../../common/http/api-error';
@Injectable()
export class PasswordService implements OnModuleInit {
  private dummy = '';
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  constructor(private readonly config: ConfigService<Environment, true>) {}
  private options() {
    return { type: argon2.argon2id, memoryCost: this.config.get('ARGON2_MEMORY_KIB', { infer: true }), timeCost: this.config.get('ARGON2_TIME_COST', { infer: true }), parallelism: this.config.get('ARGON2_PARALLELISM', { infer: true }) };
  }
  async onModuleInit() { this.dummy = await this.hash(randomBytes(32).toString('hex')); }
  private async bounded<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active >= 4) {
      if (this.waiting.length >= 32) throw new ApiException(503, 'SERVICE_UNAVAILABLE', 'Sign-in is busy. Please retry shortly.');
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else this.active++;
    try { return await operation(); }
    finally { const next = this.waiting.shift(); if (next) next(); else this.active--; }
  }
  async hash(password: string): Promise<string> { return this.bounded(() => argon2.hash(password, this.options())); }
  async verify(stored: string | null, password: string): Promise<{ valid: boolean; rehash: boolean }> {
    return this.bounded(async () => {
      const argon = stored?.match(/^\$argon2(id|i|d)\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/);
      const bcrypt = stored?.match(/^\$2[aby]\$(\d\d)\$[./A-Za-z0-9]{53}$/);
      try {
        if (stored && argon && stored.length < 512 && Number(argon[2]) >= 8192 && Number(argon[2]) <= 262144 && Number(argon[3]) >= 1 && Number(argon[3]) <= 10 && Number(argon[4]) >= 1 && Number(argon[4]) <= 4) {
          const valid = await argon2.verify(stored, password);
          return { valid, rehash: valid && (argon[1] !== 'id' || argon2.needsRehash(stored, this.options())) };
        }
        if (stored && bcrypt && Number(bcrypt[1]) >= 8 && Number(bcrypt[1]) <= 14 && Buffer.byteLength(password, 'utf8') <= 72) {
          return { valid: await compare(password, stored.replace(/^\$2y\$/, '$2b$')), rehash: true };
        }
      } catch { /* Unsupported or corrupt hashes fail closed. */ }
      await argon2.verify(this.dummy, password);
      return { valid: false, rehash: false };
    });
  }
}
