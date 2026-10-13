import type { Response } from 'express';
import type { AuthIdentity, AuthRequest } from '../src/modules/auth/auth.types';
import type { AuthService } from '../src/modules/auth/auth.service';
import type { AuthSecurity } from '../src/modules/auth/auth.security';
import { protectAdminBody } from '../src/common/http/admin-body-parser';
import { ApiException } from '../src/common/http/api-error';
import { TestcaseKeyring } from '../src/workers/judge/testcase-crypto';
import { randomBytes } from 'node:crypto';
describe('Authoring request admission before larger JSON parsing', () => {
  const identity = { user: { id: 'actor', role: 'ADMIN', authVersion: 1 } } as AuthIdentity;
  async function invoke(actor: AuthIdentity | null, csrfFailure?: Error, lookupFailure?: Error) {
    const identify = jest.fn().mockImplementation(async () => {
      if (lookupFailure) throw lookupFailure;
      return actor;
    });
    const assertCsrf = jest.fn().mockImplementation(async () => {
      if (csrfFailure) throw csrfFailure;
    });
    const status = jest.fn().mockReturnThis(),
      json = jest.fn(),
      setHeader = jest.fn(),
      next = jest.fn();
    await protectAdminBody(
      { identify } as unknown as AuthService,
      { assertCsrf } as unknown as AuthSecurity,
    )({ method: 'POST' } as AuthRequest, { status, json, setHeader } as unknown as Response, next);
    return { next, status, json, assertCsrf };
  }
  it('refuses unauthenticated request bodies before parsing', async () => {
    const r = await invoke(null);
    expect(r.status).toHaveBeenCalledWith(401);
    expect(r.next).not.toHaveBeenCalled();
    expect(r.assertCsrf).not.toHaveBeenCalled();
  });
  it('refuses student sessions before parsing', async () => {
    const r = await invoke({ ...identity, user: { ...identity.user, role: 'STUDENT' } });
    expect(r.status).toHaveBeenCalledWith(403);
    expect(r.next).not.toHaveBeenCalled();
  });
  it('requires actual administrator CSRF approval before parsing', async () => {
    const r = await invoke(
      identity,
      new ApiException(403, 'CSRF_INVALID', 'Security token rejected.'),
    );
    expect(r.next).not.toHaveBeenCalled();
    expect(r.status).toHaveBeenCalledWith(403);
  });
  it('admits authorized administrator bodies', async () => {
    const r = await invoke(identity);
    expect(r.next).toHaveBeenCalledTimes(1);
    expect(r.status).not.toHaveBeenCalled();
    expect(r.assertCsrf).toHaveBeenCalledTimes(1);
  });
  it('sanitizes authentication dependency failures', async () => {
    const r = await invoke(null, undefined, new Error('private-database-password'));
    expect(r.status).toHaveBeenCalledWith(503);
    expect(JSON.stringify(r.json.mock.calls)).not.toContain('private-database-password');
  });
  it('allows authoring keys without granting diagnostics decryption while judge keys require it', () => {
    const value = {
      keys: ['PUBLIC', 'HIDDEN'].map((dataClass) => ({
        id: dataClass,
        dataClass,
        base64: randomBytes(32).toString('base64'),
      })),
    };
    expect(() => new TestcaseKeyring(value)).toThrow('Missing data-class key');
    const authoring = new TestcaseKeyring(value, ['PUBLIC', 'HIDDEN']);
    const encrypted = authoring.encrypt('private case', 'HIDDEN', 'HIDDEN', 'aad');
    expect(authoring.decrypt(encrypted, 'HIDDEN', 'HIDDEN', 'aad')).toBe('private case');
    expect(() =>
      authoring.encrypt('private diagnostic', 'DIAGNOSTICS', 'DIAGNOSTICS', 'aad'),
    ).toThrow('Key authorization failed');
  });
});
