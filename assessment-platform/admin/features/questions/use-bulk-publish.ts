'use client';
import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, mutate } from '@/services/api-client';
import type { EntityMutation } from '@/types/admin';
import type { QuestionSummary } from '@/types/questions';

export function useBulkPublish() {
  const cache = useQueryClient();
  const keys = useRef(new Map<string, string>());
  const [completed, setCompleted] = useState(0);
  const mutation = useMutation({
    mutationFn: async (questions: QuestionSummary[]) => {
      setCompleted(0);
      const published: string[] = [];
      const failed: { id: string; title: string; message: string }[] = [];
      // Reuse the revision-checked, validated publishing endpoint for every draft.
      // Each request has its own stable key so lost responses can be retried safely.
      for (const question of questions) {
        const identity = `${question.id}:${question.revision}`;
        const key = keys.current.get(identity) ?? crypto.randomUUID();
        keys.current.set(identity, key);
        try {
          await mutate<EntityMutation>(
            `/admin/questions/${question.id}/publish`,
            { revision: question.revision },
            'POST',
            key,
          );
          published.push(question.id);
          keys.current.delete(identity);
        } catch (error) {
          failed.push({
            id: question.id,
            title: question.title,
            message:
              error instanceof Error ? error.message : 'Publication failed. Retry this draft.',
          });
          if (
            error instanceof ApiError &&
            (error.status === 0 || [401, 403, 429].includes(error.status) || error.status >= 500)
          ) {
            for (const remaining of questions.slice(published.length + failed.length))
              failed.push({
                id: remaining.id,
                title: remaining.title,
                message: 'Not attempted. Resolve the service error and retry.',
              });
            break;
          }
        }
        setCompleted(published.length + failed.length);
      }
      return { published, failed };
    },
    onSuccess: () => cache.invalidateQueries({ queryKey: ['admin'] }),
  });
  return { ...mutation, completed };
}
