'use client';
import { useState } from 'react';
import { Download, ChevronDown } from 'lucide-react';
import { AssessmentFilter } from '@/components/assessment-filter';
import { useAdminQuery } from '@/hooks/use-admin';
import { exportCsv, queryString } from '@/services/api-client';
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
interface Result {
  id: string;
  attemptId: string;
  assessmentId: string;
  assessmentTitle: string;
  studentId: string;
  studentName: string;
  externalId: string;
  status: string;
  totalScore: string | null;
  maximumScore: string;
  computedAt: string | null;
  questions: {
    title: string;
    difficulty: string;
    topics: string[];
    score: string | null;
    maximumScore: string;
    verdict: string | null;
    submissionId: string | null;
  }[];
}
interface Aggregate {
  label: string;
  earned: string | number;
  maximum: string | number;
  count: number;
}
interface Analytics {
  completionRate: number;
  scoreDistribution: { range: string; count: number }[];
  difficulty: Aggregate[];
  topics: Aggregate[];
  questions: Aggregate[];
}
export function ResultList({ initialAssessmentId = '' }: { initialAssessmentId?: string }) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [assessmentId, setAssessmentId] = useState(initialAssessmentId);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [view, setView] = useState<'difficulty' | 'topics' | 'questions'>('difficulty');
  const query = useAdminQuery<Page<Result> & { analytics: Analytics }>(
    `/admin/results${queryString({ page, pageSize: 20, search, assessmentId })}`,
    10000,
  );
  async function download() {
    setExporting(true);
    setExportError('');
    try {
      await exportCsv(`/admin/results/export${queryString({ assessmentId, search })}`);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Export failed.');
    } finally {
      setExporting(false);
    }
  }
  const analytics = query.data?.data.analytics;
  return (
    <>
      <PageHeading
        eyebrow="OUTCOMES"
        title="Results & analytics"
        description="Review immutable backend-calculated scores and assessment performance."
        action={
          <button
            className="button"
            disabled={exporting || query.isPending}
            onClick={() => void download()}
          >
            <Download size={17} />
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
        }
      />
      {exportError && (
        <p className="alert" role="alert">
          {exportError}
        </p>
      )}
      <div className="panel">
        <div className="table-toolbar">
          <input
            aria-label="Search results"
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
        </div>
      </div>
      {analytics && (
        <div className="dashboard-grid">
          <section className="panel form-panel">
            <h2>Score distribution</h2>
            <p className="muted">Completion rate: {(analytics.completionRate * 100).toFixed(1)}%</p>
            <div className="distribution">
              {analytics.scoreDistribution.map((bucket) => (
                <div key={bucket.range}>
                  <span>{bucket.range}</span>
                  <progress
                    max={Math.max(1, ...analytics.scoreDistribution.map((b) => b.count))}
                    value={bucket.count}
                    aria-label={`${bucket.range}: ${bucket.count} students`}
                  />
                  <strong>{bucket.count}</strong>
                </div>
              ))}
            </div>
          </section>
          <section className="panel form-panel">
            <div className="panel-heading">
              <h2>Performance breakdown</h2>
              <select
                aria-label="Performance grouping"
                value={view}
                onChange={(e) => setView(e.target.value as typeof view)}
              >
                <option value="difficulty">By difficulty</option>
                <option value="topics">By topic</option>
                <option value="questions">By question</option>
              </select>
            </div>
            <div className="breakdown-list">
              {analytics[view].length ? (
                analytics[view].map((a) => (
                  <div key={a.label}>
                    <span>
                      <strong>{a.label}</strong>
                      <small>{a.count} scored questions</small>
                    </span>
                    <span>
                      {a.earned} / {a.maximum}
                    </span>
                  </div>
                ))
              ) : (
                <p className="muted">No scored questions yet.</p>
              )}
            </div>
          </section>
        </div>
      )}
      <div className="panel">
        {query.isPending ? (
          <LoadingState />
        ) : query.isError ? (
          <ErrorState error={query.error} retry={() => void query.refetch()} />
        ) : query.data.data.items.length === 0 ? (
          <EmptyState
            title="No results yet"
            description="Results appear after finalization. Infrastructure failures remain marked for review."
          />
        ) : (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Assessment</th>
                    <th>Evaluation</th>
                    <th>Score</th>
                    <th>Computed</th>
                    <th>Question breakdown</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.data.items.map((result) => (
                    <tr key={result.id}>
                      <td>
                        <strong>{result.studentName}</strong>
                        <small>{result.externalId}</small>
                      </td>
                      <td>
                        {result.assessmentTitle}
                        <small className="mono">{result.attemptId}</small>
                      </td>
                      <td>
                        <Badge>{result.status}</Badge>
                      </td>
                      <td>
                        <strong>{result.totalScore ?? 'Requires review'}</strong>
                        <small>out of {result.maximumScore}</small>
                      </td>
                      <td>{result.computedAt ? dateTime(result.computedAt) : 'Pending'}</td>
                      <td>
                        <button
                          className="text-button"
                          aria-expanded={expanded === result.id}
                          onClick={() => setExpanded(expanded === result.id ? null : result.id)}
                        >
                          View questions
                          <ChevronDown size={15} />
                        </button>
                        {expanded === result.id && (
                          <div className="result-question-list">
                            {result.questions.map((q, index) => (
                              <div key={`${index}-${q.title}`}>
                                <strong>{q.title}</strong>
                                <div>
                                  <Badge>{q.difficulty}</Badge>
                                  <span>
                                    {q.score ?? 'Pending'} / {q.maximumScore}
                                  </span>
                                </div>
                                <small>
                                  {q.topics.join(', ')} · {q.verdict ?? 'Not evaluated'}
                                </small>
                                {q.submissionId && <small className="mono">{q.submissionId}</small>}
                              </div>
                            ))}
                          </div>
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
    </>
  );
}
