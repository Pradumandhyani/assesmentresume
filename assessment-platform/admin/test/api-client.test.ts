import { describe, expect, it, vi } from 'vitest';
import { ApiError, authApi, get, mutate, queryString } from '@/services/api-client';
const ok = (data: unknown) =>
  new Response(JSON.stringify({ data, meta: { serverNow: '2026-10-13T10:00:00.000Z' } }), {
    status: 200,
  });
describe('administration API boundary', () => {
  it('requests ADMIN login through shared session and CSRF APIs', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(ok({ csrfToken: 'test-csrf' }))
      .mockResolvedValueOnce(ok({ user: { role: 'ADMIN' } }));
    vi.stubGlobal('fetch', fetch);
    await authApi.login({
      identifier: 'staff@example.test',
      password: 'test-password',
      remember: false,
    });
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/v1/auth/csrf');
    const [path, options] = fetch.mock.calls[1] as [string, RequestInit];
    expect(path).toBe('/api/v1/auth/login');
    expect(options.credentials).toBe('include');
    expect(options.headers).toMatchObject({ 'X-CSRF-Token': 'test-csrf' });
    expect(JSON.parse(String(options.body))).toMatchObject({
      role: 'ADMIN',
      identifier: 'staff@example.test',
    });
  });
  it('sends idempotency keys and never places mutation data in URLs', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(ok({ csrfToken: 'token' }))
      .mockResolvedValueOnce(ok({ id: 'saved' }));
    vi.stubGlobal('fetch', fetch);
    await mutate(
      '/admin/questions',
      { testCases: [{ input: 'sensitive' }] },
      'POST',
      'request-key',
    );
    const [path, options] = fetch.mock.calls[1] as [string, RequestInit];
    expect(path).toBe('/api/v1/admin/questions');
    expect(options.headers).toMatchObject({ 'Idempotency-Key': 'request-key' });
    expect(path).not.toContain('sensitive');
  });
  it('surfaces backend authorization errors without a fabricated success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: 'FORBIDDEN', message: 'Administrator access is required.' },
          }),
          { status: 403 },
        ),
      ),
    );
    await expect(get('/admin/students')).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });
  it('reports network interruptions distinctly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    await expect(get('/admin/dashboard')).rejects.toMatchObject({
      status: 0,
      code: 'NETWORK_ERROR',
    });
  });
  it('rejects malformed successful responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
    await expect(get('/admin/dashboard')).rejects.toBeInstanceOf(ApiError);
  });
  it('preserves aborts and encodes filters', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('Stopped', 'AbortError')));
    await expect(get('/admin/students')).rejects.toMatchObject({ name: 'AbortError' });
    expect(queryString({ search: 'a&b', page: 2, active: undefined })).toBe('?search=a%26b&page=2');
  });
});
