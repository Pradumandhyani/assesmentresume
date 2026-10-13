'use client';
import { useState } from 'react';
import { Archive, CheckCircle2, Copy, Send } from 'lucide-react';
import type { EntityMutation } from '@/types/admin';
import { useAdminMutation, useAdminQuery } from '@/hooks/use-admin';
import type { QuestionDetail, Settings } from '@/types/questions';
import {
  Badge,
  ConfirmDialog,
  ErrorState,
  LoadingState,
  PageHeading,
} from '@/components/ui/management';
import { QuestionForm } from './question-form';
type Validation = {
  valid: boolean;
  issues: string[];
  executionValidated: boolean;
  message: string;
};
export function QuestionDetailPage({ id }: { id: string }) {
  const query = useAdminQuery<QuestionDetail>(`/admin/questions/${id}`);
  const settings = useAdminQuery<Settings>('/admin/settings');
  const [dialog, setDialog] = useState<'publish' | 'archive' | 'draft' | null>(null);
  const publish = useAdminMutation<EntityMutation, { revision: number }>(
    `/admin/questions/${id}/publish`,
  );
  const archive = useAdminMutation<QuestionDetail, { revision: number }>(
    `/admin/questions/${id}/archive`,
  );
  const draft = useAdminMutation<QuestionDetail, { revision: number }>(
    `/admin/questions/${id}/draft`,
  );
  const validate = useAdminMutation<Validation, { revision: number }>(
    `/admin/questions/${id}/validate`,
  );
  if (query.isPending) return <LoadingState />;
  if (query.isError) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const q = query.data.data;
  const action = dialog === 'publish' ? publish : dialog === 'archive' ? archive : draft;
  return (
    <>
      <PageHeading
        eyebrow={`QUESTION BANK · VERSION ${q.version}`}
        title={q.title}
        description={
          q.status === 'PUBLISHED'
            ? 'This published version is immutable. Create a new draft to make changes.'
            : 'Save your changes before validation or publication.'
        }
        action={
          <>
            <Badge>{q.archivedAt ? 'ARCHIVED' : q.status}</Badge>
            {!q.archivedAt && (
              <>
                {q.status === 'DRAFT' ? (
                  <>
                    <button
                      className="button secondary"
                      disabled={validate.isPending}
                      onClick={() => validate.mutate({ revision: q.revision })}
                    >
                      <CheckCircle2 size={16} />
                      {validate.isPending ? 'Validating…' : 'Validate saved draft'}
                    </button>
                    <button
                      className="button"
                      disabled={!settings.data?.data.questionAuthoringAvailable}
                      onClick={() => {
                        publish.reset();
                        setDialog('publish');
                      }}
                    >
                      <Send size={16} />
                      Publish version
                    </button>
                  </>
                ) : (
                  <button
                    className="button"
                    onClick={() => {
                      draft.reset();
                      setDialog('draft');
                    }}
                  >
                    <Copy size={16} />
                    Create new draft
                  </button>
                )}
                <button
                  className="button secondary"
                  onClick={() => {
                    archive.reset();
                    setDialog('archive');
                  }}
                >
                  <Archive size={16} />
                  Archive
                </button>
              </>
            )}
          </>
        }
      />
      {validate.error && (
        <p className="alert" role="alert">
          {validate.error.message}
        </p>
      )}
      {validate.data && (
        <div className={validate.data.data.valid ? 'notice' : 'alert'} role="status">
          <strong>
            {validate.data.data.valid
              ? 'Structural validation passed'
              : 'Validation requires changes'}
          </strong>
          <p>{validate.data.data.message}</p>
          {validate.data.data.issues.map((issue) => (
            <p key={issue}>{issue}</p>
          ))}
          {!validate.data.data.executionValidated && (
            <p>Runtime execution has not been validated by this check.</p>
          )}
        </div>
      )}
      {q.status === 'DRAFT' && !q.archivedAt ? (
        <QuestionForm key={`${q.id}-${q.revision}`} initial={q} />
      ) : (
        <div className="panel form-panel problem-preview">
          <div className="button-row">
            <Badge>{q.difficulty}</Badge>
            <span className="muted">
              {q.topics.join(', ')} · {q.maxScore} marks
            </span>
          </div>
          <h2>Problem statement</h2>
          <p className="preserve-lines">{q.statement}</p>
          <h3>Input format</h3>
          <p className="preserve-lines">{q.inputFormat}</p>
          <h3>Output format</h3>
          <p className="preserve-lines">{q.outputFormat}</p>
          <h3>Constraints</h3>
          <pre>{q.constraints}</pre>
          <h3>Public examples</h3>
          {q.publicExamples.map((e) => (
            <div className="example" key={e.ordinal}>
              <strong>Example {e.ordinal}</strong>
              <div className="form-grid">
                <div>
                  <small>INPUT</small>
                  <pre>{e.input}</pre>
                </div>
                <div>
                  <small>EXPECTED OUTPUT</small>
                  <pre>{e.expectedOutput}</pre>
                </div>
              </div>
            </div>
          ))}
          {q.explanation && (
            <>
              <h3>Explanation</h3>
              <p className="preserve-lines">{q.explanation}</p>
            </>
          )}
          <p className="notice">
            Hidden case contents are excluded from this preview. Editing creates a new version and
            preserves active attempts.
          </p>
        </div>
      )}
      <ConfirmDialog
        open={dialog !== null}
        title={
          dialog === 'publish'
            ? 'Publish immutable question version?'
            : dialog === 'archive'
              ? 'Archive this question?'
              : 'Create a new draft version?'
        }
        description={
          dialog === 'publish'
            ? 'The backend validates the saved content, encrypted cases, limits, and pinned toolchains. Published content cannot be edited.'
            : dialog === 'archive'
              ? 'This question is removed from future allocation pools. Existing assigned versions and student work are retained.'
              : 'A new editable version will be created. Published versions assigned to students stay unchanged.'
        }
        confirmLabel={
          dialog === 'publish'
            ? 'Publish version'
            : dialog === 'archive'
              ? 'Archive question'
              : 'Create draft'
        }
        destructive={dialog === 'archive'}
        pending={action.isPending}
        error={action.error}
        onClose={() => setDialog(null)}
        onConfirm={() =>
          action.mutate({ revision: q.revision }, { onSuccess: () => setDialog(null) })
        }
      />
    </>
  );
}
