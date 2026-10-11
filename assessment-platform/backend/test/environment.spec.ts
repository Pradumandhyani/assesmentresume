import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'dotenv';
import { validateEnvironment } from '../src/config/environment';
import {
  judgeEnvironmentSchema,
  maintenanceEnvironmentSchema,
} from '../src/config/worker-environment';

const example = (file: string): Record<string, string> =>
  parse(readFileSync(resolve(__dirname, '..', file)));

describe('configuration security boundaries', () => {
  it('accepts the API development example with typed port, pool and cookie fields', () => {
    const env = validateEnvironment(example('.env.example'));
    expect(env.PORT).toBe(4000);
    expect(env.DATABASE_POOL_MAX).toBe(20);
    expect(env.SESSION_SECURE).toBe(false);
  });

  it('rejects development cookies in production', () => {
    expect(() =>
      validateEnvironment({ ...example('.env.example'), NODE_ENV: 'production' }),
    ).toThrow('Production requires');
  });

  it('requires HTTPS origins after configuring a secure production cookie', () => {
    expect(() =>
      validateEnvironment({
        ...example('.env.example'),
        NODE_ENV: 'production',
        SESSION_SECURE: 'true',
        SESSION_COOKIE_NAME: '__Host-assessment_session',
      }),
    ).toThrow('HTTPS');
  });

  it('does not include hidden-case keys or judge credentials in the API schema', () => {
    const env = validateEnvironment({
      ...example('.env.example'),
      HIDDEN_TESTCASE_KMS_KEY_ID: 'must-not-enter-api-config',
      DATABASE_JUDGE_URL: 'must-not-enter-api-config',
    });
    expect(env).not.toHaveProperty('HIDDEN_TESTCASE_KMS_KEY_ID');
    expect(env).not.toHaveProperty('DATABASE_JUDGE_URL');
  });

  it('validates separately scoped judge and maintenance examples', () => {
    expect(
      judgeEnvironmentSchema.parse(example('.env.judge.example')).DATABASE_JUDGE_POOL_MAX,
    ).toBe(4);
    expect(
      maintenanceEnvironmentSchema.parse(example('.env.maintenance.example')).OUTBOX_BATCH_SIZE,
    ).toBe(100);
  });

  it('requires an encrypted sandbox broker connection', () => {
    expect(() =>
      judgeEnvironmentSchema.parse({
        ...example('.env.judge.example'),
        SANDBOX_BROKER_URL: 'http://broker.example.invalid',
      }),
    ).toThrow();
  });
});
