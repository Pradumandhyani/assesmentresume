'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { ApiError, get, mutate } from '@/services/api-client';
export function useAdminQuery<T>(path: string, interval?: number, enabled = true) {
  return useQuery({
    queryKey: ['admin', path],
    queryFn: ({ signal }) => get<T>(path, signal),
    enabled,
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
        pending.current = { body: serialized, key: createRequestKey() };
      return mutate<T>(path, body, method, pending.current.key);
    },
    onSuccess: () => {
      pending.current = null;
      return cache.invalidateQueries({ queryKey: ['admin'] });
    },
  });
}

// randomUUID is unavailable on HTTP LAN origins; getRandomValues works there too.
export function createRequestKey() {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
