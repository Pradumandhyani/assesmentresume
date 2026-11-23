'use client';
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useAdminMutation } from '@/hooks/use-admin';
import { ConfirmDialog } from '@/components/ui/management';
import type { QuestionSummary } from '@/types/questions';

export function DeleteQuestionButton({
  question,
  onDeleted,
}: {
  question: QuestionSummary;
  onDeleted?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const remove = useAdminMutation<{ id: string; deleted: boolean }, { revision: number }>(
    `/admin/questions/${question.id}`,
    'DELETE',
  );
  return (
    <>
      <button
        type="button"
        className="button secondary small"
        aria-label={`Delete ${question.title}`}
        onClick={() => {
          remove.reset();
          setOpen(true);
        }}
      >
        <Trash2 size={16} /> Delete
      </button>
      <ConfirmDialog
        open={open}
        title="Delete this question?"
        description={`Remove "${question.title}" from the active question bank and future assessment pools. Saved assessment pools, student attempts and results are retained.`}
        confirmLabel="Delete question"
        destructive
        pending={remove.isPending}
        error={remove.error}
        onClose={() => setOpen(false)}
        onConfirm={() =>
          remove.mutate(
            { revision: question.revision },
            {
              onSuccess: () => {
                setOpen(false);
                onDeleted?.();
              },
            },
          )
        }
      />
    </>
  );
}
