'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { studentApi, ApiError, type ApiSuccess } from '@/services/api-client';
export const sessionKey = ['session'] as const;
export function useSession(initialData?: ApiSuccess<'getMe'>) {
  return useQuery({
    queryKey: sessionKey,
    queryFn: ({ signal }) => studentApi.me(signal),
    ...(initialData ? { initialData } : {}),
    staleTime: 15000,
    refetchInterval: 30000,
    retry: (count, error) =>
      !(error instanceof ApiError && [401, 403].includes(error.status)) && count < 1,
  });
}
export function useLogin() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: studentApi.login,
    onSuccess: (session) => {
      cache.clear();
      cache.setQueryData(sessionKey, session);
    },
  });
}
export function useLogout() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: studentApi.logout,
    onSuccess: () => {
      cache.clear();
      try {
        for (const key of Object.keys(sessionStorage))
          if (key.startsWith('assessment-pending:')) sessionStorage.removeItem(key);
      } catch {
        /* Storage may be disabled by the browser. */
      }
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401) cache.clear();
    },
  });
}
