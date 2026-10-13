'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { attemptApi, type Language, type Submission, type Envelope } from '@/services/attempt-api';
import type { ExecutionState } from './execution-panel';
type Purpose = 'RUN_PUBLIC' | 'SUBMIT';
const pending = (s?: Submission) => !!s && ['PENDING', 'QUEUED', 'RUNNING'].includes(s.status);
export function executionState(submission?: Submission, available = false): ExecutionState {
  if (!submission) return available ? 'IDLE' : 'UNAVAILABLE';
  if (submission.status === 'PENDING' || submission.status === 'QUEUED') return 'QUEUED';
  if (submission.status === 'RUNNING') return 'RUNNING';
  if (submission.status === 'INFRASTRUCTURE_FAILED' || submission.status === 'CANCELLED')
    return 'SYSTEM_ERROR';
  const verdict = submission.result?.verdict;
  if (
    verdict &&
    [
      'COMPILATION_ERROR',
      'RUNTIME_ERROR',
      'TIME_LIMIT_EXCEEDED',
      'MEMORY_LIMIT_EXCEEDED',
      'OUTPUT_LIMIT_EXCEEDED',
    ].includes(verdict)
  )
    return verdict as ExecutionState;
  return verdict === 'INTERNAL_ERROR' ? 'SYSTEM_ERROR' : 'COMPLETED';
}
export function useExecution(
  attemptId: string,
  questionId: string,
  language: Language,
  refresh: () => void,
) {
  const cache = useQueryClient();
  const [ids, setIds] = useState<Record<string, string>>({});
  const [posting, setPosting] = useState<Purpose | null>(null);
  const [error, setError] = useState<string | null>(null);
  const postingRef = useRef(false);
  const requests = useRef<Record<string, { source: string; key: string }>>({});
  const storageKey = `assessment-execution:${attemptId}`;
  const idKey = (purpose: Purpose) => `${questionId}:${language}:${purpose}`;
  useEffect(() => {
    try {
      const stored: unknown = JSON.parse(sessionStorage.getItem(storageKey) ?? '{}');
      if (stored && typeof stored === 'object' && !Array.isArray(stored))
        setIds(
          Object.fromEntries(
            Object.entries(stored).filter(
              ([key, value]) =>
                /^[a-f0-9-]{36}:(PYTHON|JAVA|CPP):(RUN_PUBLIC|SUBMIT)$/.test(key) &&
                typeof value === 'string' &&
                /^[a-f0-9-]{36}$/.test(value),
            ),
          ),
        );
    } catch {
      /* status recovery is best effort; actual submissions remain durable */
    }
  }, [storageKey]);
  const queryFor = (purpose: Purpose) => {
    const id = ids[idKey(purpose)];
    return {
      queryKey: ['submission', id],
      queryFn: ({ signal }: { signal: AbortSignal }) => attemptApi.submission(id!, signal),
      enabled: !!id,
      refetchInterval: (query: { state: { data: Envelope<Submission> | undefined } }) =>
        pending(query.state.data?.data)
          ? 1500
          : query.state.data?.data.status === 'COMPLETED' && !query.state.data.data.feedbackReleased
            ? 10000
            : (false as const),
      refetchOnWindowFocus: true,
      retry: 2,
    };
  };
  const publicQuery = useQuery(queryFor('RUN_PUBLIC'));
  const hiddenQuery = useQuery(queryFor('SUBMIT'));
  const validate = (data?: Submission) =>
    data?.attemptId === attemptId &&
    data.attemptQuestionId === questionId &&
    data.language === language
      ? data
      : undefined;
  const publicSubmission = validate(publicQuery.data?.data),
    hiddenSubmission = validate(hiddenQuery.data?.data);
  async function execute(purpose: Purpose, source: string) {
    if (postingRef.current) return;
    postingRef.current = true;
    setPosting(purpose);
    setError(null);
    const key = idKey(purpose);
    if (requests.current[key]?.source !== source)
      requests.current[key] = { source, key: crypto.randomUUID() };
    try {
      const response = await attemptApi.execute(
        attemptId,
        questionId,
        language,
        source,
        requests.current[key]!.key,
        purpose,
      );
      cache.setQueryData(['submission', response.data.id], response);
      setIds((previous) => {
        const next = { ...previous, [key]: response.data.id };
        try {
          sessionStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          /* no saved claim */
        }
        return next;
      });
      delete requests.current[key];
      refresh();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'The request was not confirmed. Retry with the same code.',
      );
    } finally {
      postingRef.current = false;
      setPosting(null);
    }
  }
  return {
    execute,
    posting,
    error: error ?? publicQuery.error?.message ?? hiddenQuery.error?.message ?? null,
    publicSubmission,
    hiddenSubmission,
    publicPending: pending(publicSubmission),
    hiddenPending: pending(hiddenSubmission),
  };
}
