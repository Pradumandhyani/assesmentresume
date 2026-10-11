import { spawn } from 'node:child_process';
import net from 'node:net';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

// Smoke-check this repository's compiled server only. Never accepts or runs submitted source.
const backend = fileURLToPath(new URL('../backend', import.meta.url));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const reservation = net.createServer();
await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const child = spawn(process.execPath, ['--env-file=.env.example', 'dist/main.js'], {
  cwd: backend,
  env: { ...process.env, PORT: String(port) },
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
      assert.equal(response.status, 404);
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
  assert.equal(response.status, 404);
  console.log(
    'Compiled API starts; login and student assessment business routes remain unimplemented (404).',
  );
} finally {
  if (child.exitCode === null && child.pid) {
    const stopped = new Promise((resolve) => child.once('exit', resolve));
    child.kill();
    await stopped;
  }
}
