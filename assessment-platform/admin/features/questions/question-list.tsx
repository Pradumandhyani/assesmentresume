'use client';
import { useRef, useState, useEffect } from 'react';
import Link from 'next/link';
import { Plus, Search, ArrowUpRight, Send } from 'lucide-react';
import type { Page } from '@/types/admin';
import type { QuestionSummary, Settings } from '@/types/questions';
import { queryString } from '@/services/api-client';
import { useAdminQuery } from '@/hooks/use-admin';
import {
  Badge,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeading,
  Pagination,
  ConfirmDialog,
} from '@/components/ui/management';
import { DeleteQuestionButton } from './delete-question-button';
import { useBulkPublish } from './use-bulk-publish';
export function QuestionList() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [pageSize, setPageSize] = useState(20);
  const [selected, setSelected] = useState<Record<string, QuestionSummary>>({});
  const [confirmPublish, setConfirmPublish] = useState(false);
  const settings = useAdminQuery<Settings>('/admin/settings');
  const bulk = useBulkPublish();
  const query = useAdminQuery<Page<QuestionSummary>>(
    `/admin/questions${queryString({ page, pageSize, search, status })}`,
  );
  const selectable =
    query.data?.data.items.filter((q) => q.status === 'DRAFT' && !q.archivedAt) ?? [];
  const selectedCount = Object.keys(selected).length;
  const allOnPage = selectable.length > 0 && selectable.every((q) => !!selected[q.id]);
  const someOnPage = selectable.some((q) => !!selected[q.id]);
  const selectAll = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAll.current) selectAll.current.indeterminate = someOnPage && !allOnPage;
  }, [someOnPage, allOnPage]);
  function clearSelection() {
    setSelected({});
    bulk.reset();
  }
  return (
    <>
      <PageHeading
        eyebrow="CONTENT LIBRARY"
        title="Question bank"
        description={`Browse ${query.data?.data.total ?? 'all'} questions, manage versions, and remove questions from the active bank.`}
        action={
          <Link className="button" href="/questions/create">
            <Plus size={17} />
            Create question
          </Link>
        }
      />
      <div className="panel">
        <div className="table-toolbar">
          <div className="search-input">
            <Search size={17} />
            <input
              aria-label="Search questions"
              placeholder="Search question title or slug"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
                clearSelection();
              }}
            />
          </div>
          <select
            aria-label="Filter question status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
              clearSelection();
            }}
          >
            <option value="">All versions</option>
            <option value="DRAFT">Draft</option>
            <option value="PUBLISHED">Published</option>
          </select>
          <select
            aria-label="Questions per page"
            value={pageSize}
            onChange={(event) => {
              setPageSize(Number(event.target.value));
              setPage(1);
            }}
          >
            <option value={20}>20 per page</option>
            <option value={50}>50 per page</option>
            <option value={100}>100 per page</option>
          </select>
        </div>
        {selectedCount > 0 && (
          <div className="table-toolbar" aria-label="Selected questions">
            <strong>
              {selectedCount} draft{selectedCount === 1 ? '' : 's'} selected
            </strong>
            <button
              className="button"
              disabled={bulk.isPending || !settings.data?.data.questionAuthoringAvailable}
              onClick={() => setConfirmPublish(true)}
            >
              <Send size={16} /> Publish selected
            </button>
            <button className="button secondary" disabled={bulk.isPending} onClick={clearSelection}>
              Clear selection
            </button>
          </div>
        )}
        {settings.data && !settings.data.data.questionAuthoringAvailable && (
          <p className="alert">
            Publishing is unavailable. Configure the question keyring and pinned toolchain catalog
            on the admin backend.
          </p>
        )}
        {bulk.data && (
          <div className={bulk.data.failed.length ? 'alert' : 'notice'} role="status">
            <strong>
              {bulk.data.published.length} published; {bulk.data.failed.length} need attention.
            </strong>
            {bulk.data.failed.length > 0 && (
              <ul>
                {bulk.data.failed.map((item) => (
                  <li key={item.id}>
                    <Link href={`/questions/${item.id}/edit`}>{item.title}</Link>: {item.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {query.isPending ? (
          <LoadingState />
        ) : query.isError ? (
          <ErrorState error={query.error} retry={() => void query.refetch()} />
        ) : query.data.data.items.length === 0 ? (
          <EmptyState
            title="No questions found"
            description="Create a question or change your filters."
          />
        ) : (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>
                      <input
                        ref={selectAll}
                        type="checkbox"
                        aria-label="Select all drafts on this page"
                        checked={allOnPage}
                        disabled={!selectable.length || bulk.isPending}
                        onChange={() =>
                          setSelected((current) => {
                            const next = { ...current };
                            for (const q of selectable) {
                              if (allOnPage) delete next[q.id];
                              else next[q.id] = q;
                            }
                            return next;
                          })
                        }
                      />
                    </th>
                    <th>Question</th>
                    <th>Difficulty</th>
                    <th>Topics</th>
                    <th>Version</th>
                    <th>Status</th>
                    <th>Marks</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {query.data.data.items.map((q) => (
                    <tr key={q.id}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Select ${q.title}`}
                          checked={!!selected[q.id]}
                          disabled={q.status !== 'DRAFT' || !!q.archivedAt || bulk.isPending}
                          onChange={(event) =>
                            setSelected((current) => {
                              const next = { ...current };
                              if (event.target.checked) next[q.id] = q;
                              else delete next[q.id];
                              return next;
                            })
                          }
                        />
                      </td>
                      <td>
                        <Link className="record-title" href={`/questions/${q.id}/edit`}>
                          {q.title}
                        </Link>
                        <small>{q.slug}</small>
                      </td>
                      <td>
                        <Badge
                          tone={
                            q.difficulty === 'EASY'
                              ? 'success'
                              : q.difficulty === 'MEDIUM'
                                ? 'warning'
                                : 'danger'
                          }
                        >
                          {q.difficulty}
                        </Badge>
                      </td>
                      <td>{q.topics.join(', ') || '—'}</td>
                      <td>v{q.version}</td>
                      <td>
                        <Badge>{q.archivedAt ? 'ARCHIVED' : q.status}</Badge>
                      </td>
                      <td>{q.maxScore}</td>
                      <td>
                        <Link
                          href={`/questions/${q.id}/edit`}
                          className="icon-button"
                          aria-label={`Open ${q.title}`}
                        >
                          <ArrowUpRight size={17} />
                        </Link>
                        <DeleteQuestionButton question={q} onDeleted={() => setPage(1)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page}
              pageSize={pageSize}
              total={query.data.data.total}
              onChange={setPage}
            />
          </>
        )}
      </div>
      <ConfirmDialog
        open={confirmPublish}
        title={`Publish ${selectedCount} selected draft${selectedCount === 1 ? '' : 's'}?`}
        description={
          bulk.isPending
            ? `Publishing ${bulk.completed} of ${selectedCount} drafts… Keep this page open.`
            : 'Each saved draft is validated before publication. Published versions cannot be edited. Drafts that fail remain selected so you can review and retry them.'
        }
        confirmLabel="Publish selected drafts"
        pending={bulk.isPending}
        onClose={() => setConfirmPublish(false)}
        onConfirm={() =>
          bulk.mutate(Object.values(selected), {
            onSuccess: (result) => {
              setSelected((current) =>
                Object.fromEntries(
                  Object.entries(current).filter(([id]) => !result.published.includes(id)),
                ),
              );
              setConfirmPublish(false);
            },
          })
        }
      />
    </>
  );
}
