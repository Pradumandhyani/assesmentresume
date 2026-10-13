'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { ApiError, get, mutate } from '@/services/api-client';
export function useAdminQuery<T>(path: string, interval?: number) {
  return useQuery({
    queryKey: ['admin', path],
    queryFn: ({ signal }) => get<T>(path, signal),
    refetchInterval: interval ?? false,
    retry: (count, error) =>
      !(error instanceof ApiError && [401, 403].includes(error.status)) && count < 1,
  });
}
export function useAdminMutation<T, Body>(path: string, method = 'POST') {
  const cache = useQueryClient();
  const pending = useRef<{ body: string; key: string } | null>(null);
  return useMutation({
    mutationFn: (body: Body) => {
      const serialized = JSON.stringify(body);
      if (!pending.current || pending.current.body !== serialized)
        pending.current = { body: serialized, key: crypto.randomUUID() };
      return mutate<T>(path, body, method, pending.current.key);
    },
    onSuccess: () => {
      pending.current = null;
      return cache.invalidateQueries({ queryKey: ['admin'] });
    },
  });
}
