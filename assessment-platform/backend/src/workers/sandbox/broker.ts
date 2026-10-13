import { createServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { DockerCliControl, GvisorSandboxEngine } from './docker-engine';
import { ToolchainCatalog, toolchainDigest } from './toolchain-catalog';
import { compileSchema, runSchema, cleanupSchema } from './protocol';
import type { TLSSocket } from 'node:tls';
import pino from 'pino';
const env = z
  .object({
    SANDBOX_PORT: z.coerce.number().int().min(1024).max(65535).default(9443),
    SANDBOX_BIND: z.string().default('127.0.0.1'),
    SANDBOX_CA_FILE: z.string().min(1),
    SANDBOX_CERT_FILE: z.string().min(1),
    SANDBOX_KEY_FILE: z.string().min(1),
    SANDBOX_CLIENT_FINGERPRINTS: z.string().regex(/^[a-f0-9]{64}(?:,[a-f0-9]{64})*$/),
    SANDBOX_TOOLCHAIN_CATALOG: z.string().min(1),
    SANDBOX_RUNSC_PATH: z.string().startsWith('/'),
    SANDBOX_RUNSC_SHA256: z.string().regex(/^[a-f0-9]{64}$/),
    SANDBOX_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(8),
  })
  .parse(process.env);
const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const engine = new GvisorSandboxEngine(
  ToolchainCatalog.fromFile(env.SANDBOX_TOOLCHAIN_CATALOG),
  new DockerCliControl(),
);
const fingerprints = new Set(env.SANDBOX_CLIENT_FINGERPRINTS.split(','));
async function main() {
  await engine.verifyRuntime(env.SANDBOX_RUNSC_PATH, env.SANDBOX_RUNSC_SHA256);
  await engine.reap();
  let active = 0;
  const server = createServer(
    {
      ca: readFileSync(env.SANDBOX_CA_FILE),
      cert: readFileSync(env.SANDBOX_CERT_FILE),
      key: readFileSync(env.SANDBOX_KEY_FILE),
      requestCert: true,
      rejectUnauthorized: true,
      minVersion: 'TLSv1.3',
    },
    async (req, res) => {
      const socket = req.socket as TLSSocket;
      const fingerprint = socket
        .getPeerCertificate()
        .fingerprint256?.replaceAll(':', '')
        .toLowerCase();
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      if (!socket.authorized || !fingerprint || !fingerprints.has(fingerprint)) {
        res.writeHead(403).end('{"error":"FORBIDDEN"}');
        return;
      }
      if (req.method === 'GET' && req.url === '/health') {
        res.end(
          JSON.stringify({
            runtime: 'gvisor',
            toolchains: engine.catalog.entries.map((v) => ({
              id: v.id,
              digest: toolchainDigest(v.image),
            })),
          }),
        );
        return;
      }
      if (
        req.method !== 'POST' ||
        !['/v1/compile', '/v1/run', '/v1/cleanup'].includes(req.url ?? '')
      ) {
        res.writeHead(404).end('{"error":"NOT_FOUND"}');
        return;
      }
      if (active >= env.SANDBOX_CONCURRENCY && req.url !== '/v1/cleanup') {
        res.writeHead(429).end('{"error":"BUSY"}');
        return;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 35000);
      res.on('close', () => {
        if (!res.writableFinished) controller.abort();
      });
      active++;
      try {
        if (req.headers['content-type'] !== 'application/json') throw new Error('CONTENT_TYPE');
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          const data = Buffer.from(chunk as Uint8Array);
          size += data.length;
          if (size > 1048576) throw new Error('REQUEST_LIMIT');
          chunks.push(data);
        }
        const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        let result: unknown;
        if (req.url === '/v1/compile')
          result = await engine.compile(compileSchema.parse(body), controller.signal);
        else if (req.url === '/v1/run')
          result = await engine.run(runSchema.parse(body), controller.signal);
        else {
          await engine.cleanup(cleanupSchema.parse(body).artifactId);
          result = { cleaned: true };
        }
        if (!res.destroyed) res.end(JSON.stringify(result));
      } catch {
        if (!res.destroyed) res.writeHead(503).end('{"error":"SANDBOX_UNAVAILABLE"}');
        logger.warn({ event: 'sandbox.request.failed' }); // no source, test payload, exception or logs
      } finally {
        clearTimeout(timer);
        active--;
      }
    },
  );
  server.requestTimeout = 40000;
  server.headersTimeout = 5000;
  server.maxConnections = env.SANDBOX_CONCURRENCY * 4 + 10;
  const janitor = setInterval(() => {
    void engine.reap().catch(() => logger.error({ event: 'sandbox.cleanup.failed' }));
  }, 10000);
  const stop = () => {
    clearInterval(janitor);
    server.close();
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  server.listen(env.SANDBOX_PORT, env.SANDBOX_BIND, () =>
    logger.info({ event: 'sandbox.ready', port: env.SANDBOX_PORT }),
  );
}
void main().catch(() => {
  logger.fatal({ event: 'sandbox.startup.failed' });
  process.exitCode = 1;
});
