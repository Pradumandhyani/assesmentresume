import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'dotenv';
import * as argon2 from 'argon2';
import { PasswordService } from '../password.service';
import { validateEnvironment, type Environment } from '../../../config/environment';
describe('password verification and safe hash migration', () => {
  let service: PasswordService;
  beforeAll(async () => {
    const env = validateEnvironment({
      ...parse(readFileSync(resolve(__dirname, '../../../../.env.example'))),
      ARGON2_MEMORY_KIB: '19456',
      ARGON2_TIME_COST: '2',
    });
    service = new PasswordService(new ConfigService<Environment, true>(env));
    await service.onModuleInit();
  });
  it('generates Argon2id credentials and verifies the correct password', async () => {
    const hash = await service.hash('Test-only-password!');
    expect(hash.startsWith('$argon2id$v=19$')).toBe(true);
    expect(await service.verify(hash, 'Test-only-password!')).toEqual({
      valid: true,
      rehash: false,
    });
  });
  it('accepts independently generated Argon2id hashes', async () => {
    const hash = await argon2.hash('Test-only-password!', {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
    expect((await service.verify(hash, 'Test-only-password!')).valid).toBe(true);
  });
  it('accepts both supported parameter orders', async () => {
    const hash = await service.hash('Test-only-password!');
    const parts = hash.split('$');
    parts[3] = parts[3]!.split(',').reverse().join(',');
    expect((await service.verify(parts.join('$'), 'Test-only-password!')).valid).toBe(true);
  });
  it('upgrades legacy Argon2 without reducing its existing memory or time budget', async () => {
    const legacy = await argon2.hash('Test-only-password!', {
      type: argon2.argon2i,
      memoryCost: 19456,
      timeCost: 4,
      parallelism: 1,
    });
    expect(await service.verify(legacy, 'Test-only-password!')).toEqual({
      valid: true,
      rehash: true,
    });
    const updated = await service.hash('Test-only-password!', legacy);
    expect(updated.startsWith('$argon2id$')).toBe(true);
    const parameters = updated.split('$')[3]!.split(',');
    expect(parameters).toContain('t=4');
  });
  it('rejects incorrect passwords, unknown identities and unsupported hashes', async () => {
    const hash = await service.hash('Test-only-password!');
    expect((await service.verify(hash, 'incorrect')).valid).toBe(false);
    expect((await service.verify(null, 'incorrect')).valid).toBe(false);
    expect((await service.verify('unsupported-format', 'incorrect')).valid).toBe(false);
  });
});
