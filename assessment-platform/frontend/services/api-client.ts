import type { operations } from '@/types/api';
export type ApiSuccess<K extends keyof operations> = operations[K] extends {
  responses: { 200: { content: { 'application/json': infer T } } };
}
  ? T
  : never;
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
export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json', ...options.headers },
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      'Unable to connect. Check your connection and try again.',
    );
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error =
      payload && typeof payload === 'object' && 'error' in payload ? payload.error : null;
    const message =
      error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
        ? error.message
        : 'The service is temporarily unavailable. Please retry.';
    const code =
      error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
        ? error.code
        : 'SERVICE_UNAVAILABLE';
    throw new ApiError(response.status, code, message);
  }
  if (!payload || typeof payload !== 'object' || !('data' in payload) || !('meta' in payload))
    throw new ApiError(
      503,
      'INVALID_RESPONSE',
      'The service returned an unexpected response. Please retry.',
    );
  return payload as T;
}
const base = '/api/v1';
export const studentApi = {
  me: (signal?: AbortSignal) =>
    apiRequest<ApiSuccess<'getMe'>>(`${base}/auth/me`, signal ? { signal } : {}),
  assessments: (cursor?: string, signal?: AbortSignal) =>
    apiRequest<ApiSuccess<'getDashboardAssessments'>>(
      `${base}/assessments?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      signal ? { signal } : {},
    ),
  eligibility: (id: string) =>
    apiRequest<ApiSuccess<'getAssessmentEligibility'>>(
      `${base}/assessments/${encodeURIComponent(id)}/eligibility`,
    ),
  login: (body: { identifier: string; password: string; remember: boolean }) =>
    mutate<'login'>('/auth/login', body),
  logout: () => mutate<'logout'>('/auth/logout', {}),
};
export async function apiMutation<T>(
  path: string,
  body: unknown,
  method = 'POST',
  headers: Record<string, string> = {},
): Promise<T> {
  const csrf = await apiRequest<ApiSuccess<'getCsrf'>>(`${base}/auth/csrf`);
  return apiRequest<T>(`${base}${path}`, {
    method,
    headers: {
      ...headers,
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrf.data.csrfToken,
    },
    body: JSON.stringify(body),
  });
}
async function mutate<K extends 'login' | 'logout'>(
  path: string,
  body: unknown,
): Promise<ApiSuccess<K>> {
  return apiMutation<ApiSuccess<K>>(path, body);
}
