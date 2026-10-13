import { Agent, request } from 'node:https';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import {
  brokerResultSchema,
  type BrokerClient,
  type CompileResult,
  type BrokerResult,
} from './protocol';
import type { compileSchema, runSchema } from './protocol';
export class MtlsBrokerClient implements BrokerClient {
  private readonly agent: Agent;
  private readonly origin: URL;
  constructor(url: string, caFile: string, certFile: string, keyFile: string, concurrency = 4) {
    this.origin = new URL(url);
    if (
      this.origin.protocol !== 'https:' ||
      this.origin.username ||
      this.origin.password ||
      this.origin.pathname !== '/' ||
      this.origin.search ||
      this.origin.hash
    )
      throw new Error('Broker URL must be an HTTPS origin');
    this.agent = new Agent({
      ca: readFileSync(caFile),
      cert: readFileSync(certFile),
      key: readFileSync(keyFile),
      rejectUnauthorized: true,
      minVersion: 'TLSv1.3',
      keepAlive: true,
      maxSockets: concurrency + 2,
    });
  }
  private call(path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    return new Promise((resolve, reject) => {
      const req = request(
        new URL(path, this.origin),
        {
          agent: this.agent,
          method: payload ? 'POST' : 'GET',
          signal,
          headers: payload
            ? { 'Content-Type': 'application/json', 'Content-Length': payload.length }
            : {},
          timeout: 35000,
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > 1048576) req.destroy(new Error('BROKER_RESPONSE_LIMIT'));
            else chunks.push(chunk);
          });
          res.on('error', () => reject(new Error('BROKER_TRANSPORT')));
          res.on('end', () => {
            if (res.statusCode !== 200)
              return reject(
                new Error(res.statusCode === 429 ? 'BROKER_BUSY' : 'BROKER_UNAVAILABLE'),
              );
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
            } catch {
              reject(new Error('BROKER_PROTOCOL'));
            }
          });
        },
      );
      req.on('timeout', () => req.destroy(new Error('BROKER_TIMEOUT')));
      req.on('error', () => reject(new Error('BROKER_TRANSPORT')));
      req.end(payload);
    });
  }
  async health() {
    return z
      .object({
        runtime: z.literal('gvisor'),
        toolchains: z
          .array(
            z
              .object({
                id: z.string(),
                digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
              })
              .strict(),
          )
          .min(3),
      })
      .strict()
      .parse(await this.call('/health', undefined, AbortSignal.timeout(5000)));
  }
  async compile(input: z.infer<typeof compileSchema>, signal: AbortSignal): Promise<CompileResult> {
    return z
      .object({
        artifactId: z.string().uuid().nullable(),
        result: brokerResultSchema,
        toolchainDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      })
      .strict()
      .parse(await this.call('/v1/compile', input, signal));
  }
  async run(input: z.infer<typeof runSchema>, signal: AbortSignal): Promise<BrokerResult> {
    return brokerResultSchema.parse(await this.call('/v1/run', input, signal));
  }
  async cleanup(artifactId: string) {
    await this.call('/v1/cleanup', { artifactId }, AbortSignal.timeout(5000));
  }
  close() {
    this.agent.destroy();
  }
}
