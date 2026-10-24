import { spawn, fork } from 'node:child_process';
import { existsSync, readFileSync, createWriteStream, realpathSync, statfsSync } from 'node:fs';
import { dirname, join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const activeCommands = new Set();
function stopCommand(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    const cleanup = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    cleanup.on('error', () => child.kill());
    cleanup.once('close', (code) => {
      // Restricted Windows tokens may start taskkill but deny its operation. The
      // fallback only targets the exact child handle created by this supervisor.
      if (code !== 0 && child.exitCode === null && child.signalCode === null) child.kill();
    });
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill();
    }
  }
}
export async function stopCommands() {
  const commands = [...activeCommands];
  for (const child of commands) {
    child.localCancelled = true;
    stopCommand(child);
  }
  const until = Date.now() + 15000;
  while (commands.some((child) => activeCommands.has(child)) && Date.now() < until)
    await delay(100);
}
export function alive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
export const pnpmCommand = (args) => {
  const entry = process.env.npm_execpath;
  if (entry && /pnpm\.(?:c?js|mjs)$/i.test(entry) && existsSync(entry))
    return { command: process.execPath, args: [entry, ...args] };
  const windowsEntry = join(process.env.APPDATA || '', 'npm/node_modules/pnpm/bin/pnpm.cjs');
  if (process.platform === 'win32' && existsSync(windowsEntry))
    return { command: process.execPath, args: [windowsEntry, ...args] };
  return { command: 'pnpm', args };
};

export async function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: process.env,
      windowsHide: true,
      shell: false,
      detached: process.platform !== 'win32',
      ...options,
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    activeCommands.add(child);
    let output = '';
    const log = options.logFile
      ? createWriteStream(options.logFile, { flags: 'w', mode: 0o600 })
      : null;
    if (options.capture) {
      for (const stream of [child.stdout, child.stderr])
        stream.on('data', (data) => {
          if (!options.stdoutOnly || stream === child.stdout)
            output = (output + data).slice(-1048576);
          log?.write(data);
        });
    }
    const timer = setTimeout(() => {
      stopCommand(child);
      reject(new Error(`${options.label || command} timed out.`));
    }, options.timeout || 600000);
    child.once('error', () => {
      clearTimeout(timer);
      reject(new Error(`${options.label || command} is unavailable.`));
    });
    child.once('close', (code) => {
      activeCommands.delete(child);
      clearTimeout(timer);
      const completed = () => {
        if (child.localCancelled)
          reject(
            Object.assign(new Error('Local setup command cancelled.'), { code: 'LOCAL_CANCELLED' }),
          );
        else if (code === 0) resolve(output.trim());
        else
          reject(
            new Error(
              `${options.label || command} failed (exit ${code}).${options.capture ? ' See the service status or private logs; secret-bearing output was suppressed.' : ''}`,
            ),
          );
      };
      if (log) log.end(completed);
      else completed();
    });
  });
}
export function pnpm(args, options) {
  const invocation = pnpmCommand(args);
  return run(invocation.command, invocation.args, { label: `pnpm ${args.join(' ')}`, ...options });
}

export function dockerCommand() {
  if (process.platform === 'win32') {
    for (const candidate of [
      join(
        process.env.ProgramFiles || 'C:/Program Files',
        'Docker/Docker/resources/bin/docker.exe',
      ),
      join(process.env.LOCALAPPDATA || '', 'Programs/DockerDesktop/resources/bin/docker.exe'),
    ])
      if (existsSync(candidate)) {
        // Also make the existing toolchain builder work if VS Code has an old PATH.
        process.env.PATH = `${dirname(candidate)}${delimiter}${process.env.PATH || ''}`;
        return candidate;
      }
  }
  return 'docker';
}
export async function requireDocker({ start = false } = {}) {
  const command = dockerCommand();
  const inspect = async () => {
    const info = JSON.parse(
      await run(command, ['info', '--format', '{{json .}}'], {
        capture: true,
        stdoutOnly: true,
        timeout: 30000,
      }),
    );
    if (info.OSType !== 'linux') throw new Error('WINDOWS_CONTAINERS');
    await run(command, ['compose', 'version'], { capture: true, timeout: 15000 });
  };
  try {
    await inspect();
    return command;
  } catch (error) {
    if (error.message === 'WINDOWS_CONTAINERS')
      throw new Error('Switch Docker Desktop to Linux containers, then rerun pnpm local:up.');
    if (start && ['win32', 'darwin'].includes(process.platform)) {
      try {
        console.log('Starting the installed Docker Desktop engine...');
        await run(command, ['desktop', 'start', '--timeout', '90'], {
          capture: true,
          timeout: 100000,
        });
        await waitFor(
          'Docker Desktop Linux engine',
          async () => {
            await inspect();
            return true;
          },
          { timeout: 60000 },
        );
        return command;
      } catch {
        /* Report the actual prerequisite instead of changing OS/security settings. */
      }
    }
    throw new Error(
      'Docker Linux engine / Compose is unavailable. Install Docker Desktop, enable WSL2, and start its engine. Then rerun pnpm.cmd local:up. No remote service or payment is required.',
    );
  }
}
export function composeArgs(config, args) {
  return [
    'compose',
    '--project-name',
    config.project,
    '--env-file',
    join(root, '.env'),
    '-f',
    join(root, 'docker-compose.yml'),
    '-f',
    join(root, 'docker-compose.local.yml'),
    ...args,
  ];
}

export function checkDockerStorage(firstSetup) {
  if (process.platform !== 'win32') return;
  const directory = join(process.env.LOCALAPPDATA || '', 'Docker/wsl/disk');
  if (!existsSync(directory)) return;
  const storage = realpathSync(directory);
  const stats = statfsSync(storage);
  const freeGiB = (stats.bavail * stats.bsize) / 1073741824;
  const minimum = firstSetup ? 15 : 2;
  if (freeGiB < minimum)
    throw new Error(
      `Docker storage has ${freeGiB.toFixed(1)} GiB free; at least ${minimum} GiB is needed. Move Docker's disk image to a drive with free space before retrying. Existing volumes were preserved.`,
    );
  console.log(`Docker storage has ${freeGiB.toFixed(1)} GiB free.`);
}

export async function waitFor(label, check, { timeout = 120000, isStopping = () => false } = {}) {
  const until = Date.now() + timeout;
  while (Date.now() < until && !isStopping()) {
    if (await check().catch(() => false)) return;
    await delay(500);
  }
  throw new Error(`${label} did not become healthy. See .local/logs and run pnpm local:check.`);
}
export function startService(name, entry, args, cwd, env, token, onExit) {
  const log = createWriteStream(join(root, '.local/logs', `${name}.log`), {
    flags: 'w',
    mode: 0o600,
  });
  const child = fork(fileURLToPath(new URL('./service.mjs', import.meta.url)), [entry, ...args], {
    cwd,
    env: { ...env, LOCAL_SUPERVISOR_TOKEN: token },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  child.once('error', () => onExit(name));
  child.once('exit', () => {
    log.end();
    onExit(name);
  });
  return { name, child, pid: child.pid };
}
export function serviceReady(name, event) {
  try {
    return readFileSync(join(root, '.local/logs', `${name}.log`), 'utf8').includes(
      `"event":"${event}"`,
    );
  } catch {
    return false;
  }
}
export async function stopServices(services, token) {
  await Promise.all(
    services.map(async ({ child }) => {
      if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
      if (child.connected) child.send({ type: 'stop', token }, () => {});
      const until = Date.now() + 20000;
      while (child.exitCode === null && child.signalCode === null && Date.now() < until)
        await delay(100);
      if (child.exitCode === null && child.signalCode === null) child.kill();
    }),
  );
}
