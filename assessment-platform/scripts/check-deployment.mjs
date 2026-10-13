import { readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const supplied = process.argv[2] ?? process.env.DEPLOY_ENV_FILE;
if (!supplied)
  throw new Error(
    'Pass a private deployment .env file path; example files are not valid deployment configurations.',
  );
const file = resolve(supplied);
function envFile(path) {
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const at = line.indexOf('=');
        if (at < 1) throw new Error('Invalid environment line');
        return [line.slice(0, at), line.slice(at + 1).replace(/^(['"])(.*)\1$/, '$2')];
      }),
  );
}
const judgeOnly = process.argv.includes('--judge');
if (process.argv.slice(3).some((argument) => argument !== '--judge'))
  throw new Error('Only --judge is supported');
const values = Object.fromEntries(
  readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const at = line.indexOf('=');
      if (at < 1) throw new Error('Invalid deployment environment line');
      return [line.slice(0, at), line.slice(at + 1)];
    }),
);
for (const key of judgeOnly
  ? ['JUDGE_IMAGE']
  : [
      'FRONTEND_IMAGE',
      'ADMIN_IMAGE',
      'API_IMAGE',
      'MAINTENANCE_IMAGE',
      'MIGRATION_IMAGE',
      'CADDY_IMAGE',
    ])
  if (
    !/^[a-z0-9./:_-]+@sha256:[a-f0-9]{64}$/.test(values[key] ?? '') ||
    (values[key] ?? '').includes('example.invalid')
  )
    throw new Error(`${key} must be a reviewed immutable image digest`);
for (const key of judgeOnly ? [] : ['STUDENT_HOST', 'ADMIN_HOST'])
  if (!/^[a-z0-9.-]+$/.test(values[key] ?? '') || (values[key] ?? '').endsWith('.invalid'))
    throw new Error(`${key} must be a real deployment hostname`);
if (!judgeOnly && values.STUDENT_HOST === values.ADMIN_HOST)
  throw new Error('Student and admin hostnames must be distinct');
for (const key of judgeOnly
  ? ['JUDGE_ENV_FILE', 'TOOLCHAIN_CATALOG_FILE']
  : [
      'API_ENV_FILE',
      'ADMIN_API_ENV_FILE',
      'MAINTENANCE_ENV_FILE',
      'MIGRATION_ENV_FILE',
      'ADMIN_QUESTION_KEYRING_FILE',
      'TOOLCHAIN_CATALOG_FILE',
    ]) {
  const info = statSync(values[key] ?? '');
  if (!info.isFile()) throw new Error(`${key} must exist as a private file`);
  if (
    process.platform !== 'win32' &&
    (info.mode & (key === 'TOOLCHAIN_CATALOG_FILE' ? 0o022 : 0o077)) !== 0
  )
    throw new Error(`${key} must be private (catalog metadata must be read-only to group/world)`);
}
if (judgeOnly) {
  const secrets = statSync(values.JUDGE_SECRET_DIRECTORY ?? '');
  if (!secrets.isDirectory() || (process.platform !== 'win32' && (secrets.mode & 0o077) !== 0))
    throw new Error('Judge secret directory must exist with private mode 0700');
} else {
  const student = envFile(values.API_ENV_FILE);
  const admin = envFile(values.ADMIN_API_ENV_FILE);
  for (const configuration of [student, admin]) {
    if (
      configuration.NODE_ENV !== 'production' ||
      configuration.SESSION_SECURE !== 'true' ||
      configuration.SESSION_COOKIE_NAME !== '__Host-assessment_session'
    )
      throw new Error('Production API environments require Secure host-only cookies');
    if (
      !configuration.CSRF_SIGNING_KEY ||
      configuration.CSRF_SIGNING_KEY.length < 32 ||
      configuration.CSRF_SIGNING_KEY.includes('REPLACE')
    )
      throw new Error('Provision a real shared random CSRF signing secret');
  }
  if (student.CSRF_SIGNING_KEY !== admin.CSRF_SIGNING_KEY)
    throw new Error('API processes require the same shared CSRF secret');
  if (
    [
      'ADMIN_DATABASE_URL',
      'ADMIN_ORIGINS',
      'QUESTION_KEYRING_FILE',
      'TESTCASE_KEYRING_FILE',
      'SANDBOX_KEY_FILE',
    ].some((key) => student[key])
  )
    throw new Error(
      'Student API environment must not contain admin/judge identities or secret settings',
    );
  if (
    admin.ADMIN_ORIGINS !== `https://${values.ADMIN_HOST}` ||
    !admin.ADMIN_DATABASE_URL ||
    admin.QUESTION_KEYRING_FILE !== '/run/assessment-secrets/question-keyring.json'
  )
    throw new Error('Admin API requires its exact origin and separate privileged DB/key settings');
  if (
    student.APP_ORIGINS !== `https://${values.STUDENT_HOST}` ||
    admin.APP_ORIGINS !== `https://${values.ADMIN_HOST}`
  )
    throw new Error('Each API environment must allow only its own exact HTTPS browser origin');
}
const result = spawnSync(
  'docker',
  [
    'compose',
    '--env-file',
    file,
    '-f',
    judgeOnly ? 'infra/deploy/docker-compose.judge.yml' : 'infra/deploy/docker-compose.prod.yml',
    'config',
    '--quiet',
  ],
  { stdio: 'inherit', timeout: 30000 },
);
if (result.error || result.status !== 0) {
  console.error(
    'Docker Compose validation unavailable or failed; deployment has not been validated.',
  );
  process.exit(1);
}
console.log(
  'Deployment input and Compose syntax validated. Runtime/security/load gates remain separate.',
);
