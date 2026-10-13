import type { Envelope, Session } from '@/types/admin';
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
export async function request<T>(path: string, options: RequestInit = {}): Promise<Envelope<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json', ...options.headers },
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError')
      throw error;
    throw new ApiError(0, 'NETWORK_ERROR', 'Unable to connect. Check your connection and retry.');
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error =
      payload && typeof payload === 'object' && 'error' in payload ? payload.error : null;
    const message =
      error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
        ? error.message
        : 'The request could not be completed. Please retry.';
    const code =
      error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
        ? error.code
        : 'SERVICE_UNAVAILABLE';
    throw new ApiError(response.status, code, message);
  }
  if (!payload || typeof payload !== 'object' || !('data' in payload) || !('meta' in payload))
    throw new ApiError(503, 'INVALID_RESPONSE', 'Unexpected service response. Please retry.');
  return payload as Envelope<T>;
}
export const apiBase = '/api/v1';
export const get = <T>(path: string, signal?: AbortSignal) =>
  request<T>(`${apiBase}${path}`, signal ? { signal } : {});
export async function mutate<T>(
  path: string,
  body: unknown,
  method = 'POST',
  key?: string,
): Promise<Envelope<T>> {
  const csrf = await get<{ csrfToken: string }>('/auth/csrf');
  return request<T>(`${apiBase}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrf.data.csrfToken,
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    body: JSON.stringify(body),
  });
}
export const authApi = {
  me: (signal?: AbortSignal) => get<Session>('/auth/me', signal),
  login: (body: { identifier: string; password: string; remember: boolean }) =>
    mutate<Session>('/auth/login', { ...body, role: 'ADMIN' }),
  logout: () => mutate<{ revoked: boolean }>('/auth/logout', {}),
};
export const queryString = (values: Record<string, string | number | undefined>) => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value !== undefined && value !== '') query.set(key, String(value));
  return query.size ? `?${query}` : '';
};
export async function exportCsv(path: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${apiBase}${path}`, {
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'text/csv' },
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Unable to download. Check your connection and retry.');
  }
  if (!response.ok)
    throw new ApiError(response.status, 'EXPORT_FAILED', 'CSV export failed. Please retry.');
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'assessment-results.csv';
  link.click();
  URL.revokeObjectURL(url);
}
