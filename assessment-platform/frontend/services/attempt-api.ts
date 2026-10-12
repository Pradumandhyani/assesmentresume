import type { components } from '@/types/api';
import { apiMutation, apiRequest, type ApiSuccess } from './api-client';
export type Language = components['schemas']['Language'];
export type Attempt = components['schemas']['AttemptResponse'];
export type Draft = components['schemas']['DraftResponse'];
export type Question = components['schemas']['QuestionPublic'];
export type Envelope<T> = {
  data: T;
  meta: components['schemas']['Meta'];
  timing?: { receivedAt: number; roundTripMs: number };
};
async function timed<T>(request: () => Promise<Envelope<T>>): Promise<Envelope<T>> {
  const started = performance.now();
  const response = await request();
  const receivedAt = performance.now();
  return { ...response, timing: { receivedAt, roundTripMs: receivedAt - started } };
}
const path = (id: string) => `/attempts/${encodeURIComponent(id)}`;
export const attemptApi = {
  start: (id: string, key: string) =>
    apiMutation<Envelope<Attempt>>(`/assessments/${encodeURIComponent(id)}/start`, {}, 'POST', {
      'Idempotency-Key': key,
    }),
  get: (id: string, signal?: AbortSignal) =>
    timed(() => apiRequest<Envelope<Attempt>>(`/api/v1${path(id)}`, signal ? { signal } : {})),
  question: (id: string, q: string, signal?: AbortSignal) =>
    apiRequest<Envelope<Question>>(
      `/api/v1${path(id)}/questions/${encodeURIComponent(q)}`,
      signal ? { signal } : {},
    ),
  drafts: (id: string) => apiRequest<ApiSuccess<'getAttemptDrafts'>>(`/api/v1${path(id)}/drafts`),
  save: (id: string, q: string, language: Language, sourceCode: string, expectedRevision: number) =>
    apiMutation<Envelope<Draft>>(
      `${path(id)}/drafts/${encodeURIComponent(q)}/${language}`,
      { sourceCode, expectedRevision },
      'PUT',
    ),
  select: (id: string, q: string, language: Language, expectedStateVersion: number) =>
    timed(() =>
      apiMutation<Envelope<Attempt>>(
        `${path(id)}/questions/${encodeURIComponent(q)}/language`,
        { language, expectedStateVersion },
        'PATCH',
      ),
    ),
  finalize: (id: string, expectedStateVersion: number, key: string) =>
    apiMutation<Envelope<Attempt>>(`${path(id)}/finalization`, { expectedStateVersion }, 'POST', {
      'Idempotency-Key': key,
    }),
  history: (id: string, signal?: AbortSignal) =>
    apiRequest<ApiSuccess<'getAttemptHistory'>>(
      `/api/v1${path(id)}/history`,
      signal ? { signal } : {},
    ),
};
