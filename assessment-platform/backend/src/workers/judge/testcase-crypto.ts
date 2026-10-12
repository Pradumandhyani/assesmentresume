import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { z } from 'zod';

export type DataClass = 'PUBLIC' | 'HIDDEN' | 'DIAGNOSTICS';
const keyringSchema = z.object({ keys: z.array(z.object({
  id: z.string().min(1).max(128),
  dataClass: z.enum(['PUBLIC', 'HIDDEN', 'DIAGNOSTICS']),
  base64: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
}).strict()).min(3).max(100) }).strict();
export class TestcaseKeyring {
  private readonly keys = new Map<string, { dataClass: DataClass; key: Buffer }>();
  constructor(value: unknown) {
    for (const entry of keyringSchema.parse(value).keys) {
      if (this.keys.has(entry.id)) throw new Error('Duplicate key ID');
      this.keys.set(entry.id, { dataClass: entry.dataClass, key: Buffer.from(entry.base64, 'base64') });
    }
    for (const kind of ['PUBLIC', 'HIDDEN', 'DIAGNOSTICS'] as const)
      if (![...this.keys.values()].some((key) => key.dataClass === kind)) throw new Error('Missing data-class key');
  }
  static fromFile(path: string, production = false) {
    if (production && process.platform !== 'win32' && (statSync(path).mode & 0o077))
      throw new Error('Worker keyring must not be group/world readable');
    return new TestcaseKeyring(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  }
  id(kind: DataClass) { return [...this.keys].find(([, key]) => key.dataClass === kind)![0]; }
  private key(id: string, kind: DataClass) {
    const item = this.keys.get(id);
    if (!item || item.dataClass !== kind) throw new Error('Key authorization failed');
    return item.key;
  }
  encrypt(text: string, id: string, kind: DataClass, aad: string): Uint8Array<ArrayBuffer> {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(id, kind), nonce);
    cipher.setAAD(Buffer.from(aad));
    return new Uint8Array(Buffer.concat([nonce, cipher.update(text, 'utf8'), cipher.final(), cipher.getAuthTag()]));
  }
  decrypt(bytes: Uint8Array, id: string, kind: DataClass, aad: string): string {
    if (bytes.byteLength < 28 || bytes.byteLength > 262172) throw new Error('Invalid envelope size');
    const payload = Buffer.from(bytes);
    const cipher = createDecipheriv('aes-256-gcm', this.key(id, kind), payload.subarray(0, 12));
    cipher.setAAD(Buffer.from(aad));
    cipher.setAuthTag(payload.subarray(-16));
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat([
      cipher.update(payload.subarray(12, -16)), cipher.final(),
    ]));
  }
}
export const caseAad = (versionId: string, ordinal: number, kind: 'PUBLIC' | 'HIDDEN', field: 'input' | 'expected') =>
  `case-v1:${versionId}:${ordinal}:${kind}:${field}`;
export const caseHash = (input: string, expected: string) => createHash('sha256').update(JSON.stringify([input, expected])).digest('hex');
export function verifyCaseHash(input: string, expected: string, hash: string) {
  if (!/^[a-f0-9]{64}$/.test(hash) || !timingSafeEqual(Buffer.from(caseHash(input, expected), 'hex'), Buffer.from(hash, 'hex')))
    throw new Error('Test-case integrity check failed');
}
