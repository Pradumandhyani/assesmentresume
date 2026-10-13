import { spawn } from 'node:child_process';
import net from 'node:net';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

// Smoke-check this repository's compiled server only. Never accepts or runs submitted source.
const backend = fileURLToPath(new URL('../backend', import.meta.url));
const db = await PGlite.create();
for (const migration of [
  '20261011000000_new_install_only',
  '20261011010000_student_dashboard',
  '20261012000000_public_question_examples',
  '20261012010000_execution_lifecycle',
    '20261013000000_admin_management',
])
  await db.exec(
    readFileSync(
      new URL(`../backend/prisma/migrations/${migration}/migration.sql`, import.meta.url),
      'utf8',
    ),
  );
const socket = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0, maxConnections: 1 });
await socket.start();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const reservation = net.createServer();
await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const child = spawn(process.execPath, ['--env-file=.env.example', 'dist/main.js'], {
  cwd: backend,
  env: {
    ...process.env,
    PORT: String(port),
    DATABASE_URL: `postgresql://postgres@${socket.getServerConn()}/postgres`,
    DATABASE_POOL_MAX: '1',
    CSRF_SIGNING_KEY: randomBytes(32).toString('hex'),
  },
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
let spawnError;
child.on('error', (error) => {
  spawnError = error;
});
for (const stream of [child.stdout, child.stderr])
  stream.on('data', (data) => {
    output = (output + data.toString()).slice(-8000);
  });
try {
  let started = false;
  for (let index = 0; index < 120; index++) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) throw new Error(`API bootstrap exited: ${output}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/student/assessments`, {
        signal: AbortSignal.timeout(500),
      });
      assert.equal(response.status, 401);
      started = true;
      break;
    } catch {
      await delay(200);
    }
  }
  assert.ok(started, `API did not start: ${output}`);
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(1000),
  });
  assert.equal(response.status, 400);
  const reserved = await fetch(
    `http://127.0.0.1:${port}/api/v1/student/assessments/00000000-0000-4000-8000-000000000001/attempts`,
    { method: 'POST', signal: AbortSignal.timeout(1000) },
  );
  assert.equal(reserved.status, 401);
  console.log(
    'Compiled API starts: assessments and attempt creation are authenticated (401); login validates input (400).',
  );
} finally {
  if (child.exitCode === null && child.pid) {
    const stopped = new Promise((resolve) => child.once('exit', resolve));
    child.kill();
    await stopped;
  }
  await socket.stop();
  await db.close();
}
