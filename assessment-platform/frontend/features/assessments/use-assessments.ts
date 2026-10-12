'use client';
import { useInfiniteQuery } from '@tanstack/react-query';
import { studentApi, ApiError } from '@/services/api-client';
export const assessmentsKey = ['assessments'] as const;
export function useAssessments() {
  return useInfiniteQuery({
    queryKey: assessmentsKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => studentApi.assessments(pageParam, signal),
    getNextPageParam: (page) => page.data.pageInfo.nextCursor ?? undefined,
    staleTime: 0,
    refetchInterval: 15000,
    refetchOnWindowFocus: 'always',
    retry: (count, error) =>
      !(error instanceof ApiError && [401, 403].includes(error.status)) && count < 1,
  });
}
