'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Plus, Search, ArrowUpRight } from 'lucide-react';
import type { Page } from '@/types/admin';
import type { QuestionSummary } from '@/types/questions';
import { queryString } from '@/services/api-client';
import { useAdminQuery } from '@/hooks/use-admin';
import {
  Badge,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeading,
  Pagination,
} from '@/components/ui/management';
export function QuestionList() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const query = useAdminQuery<Page<QuestionSummary>>(
    `/admin/questions${queryString({ page, pageSize: 20, search, status })}`,
  );
  return (
    <>
      <PageHeading
        eyebrow="CONTENT LIBRARY"
        title="Question bank"
        description="Author questions and publish immutable versions for assessment allocation."
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
              }}
            />
          </div>
          <select
            aria-label="Filter question status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All versions</option>
            <option value="DRAFT">Draft</option>
            <option value="PUBLISHED">Published</option>
          </select>
        </div>
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
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page}
              pageSize={20}
              total={query.data.data.total}
              onChange={setPage}
            />
          </>
        )}
      </div>
    </>
  );
}
