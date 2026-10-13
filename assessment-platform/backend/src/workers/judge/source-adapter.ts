import { z } from 'zod';
const adapter = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('STDIO') }).strict(),
  z
    .object({
      kind: z.literal('SOURCE_WRAPPER'),
      prefix: z.string().max(16384),
      suffix: z.string().max(16384),
    })
    .strict(),
]);
export function adaptSource(source: string, value: unknown): string {
  const policy = adapter.parse(value ?? { kind: 'STDIO' });
  const result = policy.kind === 'STDIO' ? source : `${policy.prefix}\n${source}\n${policy.suffix}`;
  if (Buffer.byteLength(result) > 98304 || result.includes('\0'))
    throw new Error('Invalid adapted source');
  return result;
}
