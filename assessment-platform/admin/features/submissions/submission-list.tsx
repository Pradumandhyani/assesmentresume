'use client';
import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { AssessmentFilter } from '@/components/assessment-filter';
import { useAdminQuery } from '@/hooks/use-admin';
import { queryString } from '@/services/api-client';
import type { Page } from '@/types/admin';
import {
  Badge,
  dateTime,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeading,
  Pagination,
} from '@/components/ui/management';
interface Submission {
  id: string;
  attemptId: string;
  studentId: string;
  studentName: string;
  externalId: string;
  assessmentId: string;
  assessmentTitle: string;
  questionTitle: string;
  purpose: string;
  language: string;
  status: string;
  acceptedAt: string;
  completedAt: string | null;
  errorCode: string | null;
  result: {
    verdict: string;
    passedCount: number;
    totalCount: number;
    score: string;
    cpuTimeMs: number | null;
    memoryKiB: number | null;
  } | null;
}
export function SubmissionList() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [assessmentId, setAssessmentId] = useState('');
  const [search, setSearch] = useState('');
  const query = useAdminQuery<Page<Submission>>(
    `/admin/submissions${queryString({ page, pageSize: 20, status, assessmentId, search })}`,
    5000,
  );
  return (
    <>
      <PageHeading
        eyebrow="EVALUATION PIPELINE"
        title="Submissions"
        description="Inspect accepted work, asynchronous evaluation status, and safe aggregate results."
        action={
          <button className="button secondary" onClick={() => void query.refetch()}>
            <RefreshCw size={16} />
            Refresh
          </button>
        }
      />
      <div className="panel">
        <div className="table-toolbar">
          <input
            aria-label="Search submissions"
            placeholder="Search student or assessment"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          <AssessmentFilter
            value={assessmentId}
            onChange={(value) => {
              setAssessmentId(value);
              setPage(1);
            }}
          />
          <select
            aria-label="Filter submission status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {[
              'PENDING',
              'QUEUED',
              'RUNNING',
              'COMPLETED',
              'INFRASTRUCTURE_FAILED',
              'CANCELLED',
            ].map((s) => (
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
            title="No matching submissions"
            description="Student runs and submissions will appear here after acceptance."
          />
        ) : (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Student / assessment</th>
                    <th>Question</th>
                    <th>Type</th>
                    <th>Language</th>
                    <th>Status</th>
                    <th>Accepted</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.data.items.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <strong>{s.studentName}</strong>
                        <small>
                          {s.externalId} · {s.assessmentTitle}
                        </small>
                      </td>
                      <td>
                        {s.questionTitle}
                        <small className="mono">{s.id}</small>
                      </td>
                      <td>
                        <Badge>{s.purpose}</Badge>
                      </td>
                      <td>{s.language === 'CPP' ? 'C++' : s.language}</td>
                      <td>
                        <Badge>{s.status}</Badge>
                        {s.errorCode && <small className="field-error">{s.errorCode}</small>}
                      </td>
                      <td>
                        {dateTime(s.acceptedAt)}
                        {s.completedAt && <small>Completed {dateTime(s.completedAt)}</small>}
                      </td>
                      <td>
                        {s.result ? (
                          <>
                            <Badge>{s.result.verdict}</Badge>
                            <small>
                              {s.result.passedCount}/{s.result.totalCount} cases · {s.result.score}{' '}
                              marks
                            </small>
                            {s.result.cpuTimeMs !== null && (
                              <small>{s.result.cpuTimeMs} ms CPU</small>
                            )}
                          </>
                        ) : (
                          <span className="muted">Pending</span>
                        )}
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
      <p className="muted">
        Hidden inputs, expected outputs, and private execution diagnostics are excluded from this
        response.
      </p>
    </>
  );
}
