'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Plus, Search, ArrowUpRight } from 'lucide-react';
import { useAdminQuery } from '@/hooks/use-admin';
import { queryString } from '@/services/api-client';
import type { Assessment, Page } from '@/types/admin';
import {
  Badge,
  dateTime,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeading,
  Pagination,
} from '@/components/ui/management';
export function AssessmentList() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const query = useAdminQuery<Page<Assessment>>(
    `/admin/assessments${queryString({ page, pageSize: 20, search, status })}`,
  );
  return (
    <>
      <PageHeading
        eyebrow="ASSESSMENT OPERATIONS"
        title="Assessments"
        description="Configure schedules, assign students, and monitor each assessment."
        action={
          <Link className="button" href="/assessments/create">
            <Plus size={17} />
            Create assessment
          </Link>
        }
      />
      <div className="panel">
        <div className="table-toolbar">
          <div className="search-input">
            <Search size={17} />
            <input
              aria-label="Search assessments"
              placeholder="Search assessments"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <select
            aria-label="Filter assessment status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {['DRAFT', 'SCHEDULED', 'OPEN', 'CLOSED', 'CANCELLED', 'ARCHIVED'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        {query.isPending ? (
          <LoadingState />
        ) : query.isError ? (
          <ErrorState error={query.error} retry={() => void query.refetch()} />
        ) : query.data.data.items.length === 0 ? (
          <EmptyState
            title="No assessments found"
            description="Create your first assessment or adjust the filters."
          />
        ) : (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Assessment</th>
                    <th>Status</th>
                    <th>Opens</th>
                    <th>Duration</th>
                    <th>Students</th>
                    <th>Attempts</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {query.data.data.items.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <Link className="record-title" href={`/assessments/${a.id}`}>
                          {a.title}
                        </Link>
                        <small>
                          {a.rule.easyCount + a.rule.mediumCount + a.rule.hardCount} questions ·{' '}
                          {a.rule.allowedLanguages.join(', ')}
                        </small>
                      </td>
                      <td>
                        <Badge>{a.status}</Badge>
                      </td>
                      <td>{dateTime(a.opensAt)}</td>
                      <td>{Math.round(a.rule.durationSeconds / 60)} min</td>
                      <td>{a.assignmentCount}</td>
                      <td>{a.attemptCount}</td>
                      <td>
                        <Link
                          href={`/assessments/${a.id}`}
                          className="icon-button"
                          aria-label={`View ${a.title}`}
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
