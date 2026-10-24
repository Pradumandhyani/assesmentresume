import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { root, run } from '../local/runtime.mjs';

export const cliVersion = '5.71.0';
let verifiedCommand;

async function verify(command) {
  const version = await run(command, ['--version'], {
    capture: true,
    stdoutOnly: true,
    timeout: 15000,
  });
  if (version !== `railway ${cliVersion}`)
    throw new Error(
      `Railway CLI ${cliVersion} is required for the validated setup response contracts.`,
    );
  verifiedCommand = command;
  return command;
}

export async function railwayCommand() {
  if (verifiedCommand) return verifiedCommand;
  const paths = [
    join(root, '.tooling/railway/node_modules/@railway/cli/bin/railway.exe'),
    join(root, '.tooling/railway/node_modules/@railway/cli/bin/railway'),
    join(process.env.APPDATA || '', 'npm/node_modules/@railway/cli/bin/railway.exe'),
  ];
  const installed = paths.find(existsSync);
  if (installed) return verify(installed);
  // Install the pinned official CLI privately, without changing workspace dependencies.
  const npm = join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  if (!existsSync(npm)) throw new Error(`Install @railway/cli@${cliVersion} with npm, then retry.`);
  await run(
    process.execPath,
    [
      npm,
      'install',
      '--prefix',
      '.tooling/railway',
      '--no-save',
      '--package-lock=false',
      `@railway/cli@${cliVersion}`,
    ],
    { capture: true },
  );
  const command = paths.find(existsSync);
  if (!command) throw new Error('The official Railway CLI installation is unavailable.');
  return verify(command);
}

/** Keep secret-bearing Railway stdout/stderr out of terminal output and error causes. */
export async function railway(args, { cwd = root, input, json = false, timeout = 120000 } = {}) {
  const command = await railwayCommand();
  const output = await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      windowsHide: true,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout = (stdout + chunk).slice(-2097152);
    });
    // Drain errors, which can include variable values. Never include them in thrown errors.
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-65536);
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Railway command timed out. Retry setup; saved resources are preserved.'));
    }, timeout);
    child.once('error', () => {
      clearTimeout(timer);
      reject(new Error('Railway CLI could not start.'));
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const output = stdout + stderr;
        const detail = /Deploys have been paused temporarily/i.test(output)
          ? 'Railway has paused deployments. Check https://status.railway.com and retry after recovery.'
          : /creating projects too quickly/i.test(output)
            ? 'Railway project creation is rate limited. Wait at least 30 seconds before retrying.'
            : 'Check account access, billing and service status in Railway; secret-bearing output was suppressed.';
        reject(new Error(`Railway ${args[0]} failed. ${detail}`));
      } else resolve(stdout.trim());
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
  if (!json) return output;
  try {
    return JSON.parse(output);
  } catch {
    throw new Error('Railway returned an unexpected response; private setup state was preserved.');
  }
}
