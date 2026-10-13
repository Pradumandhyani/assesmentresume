'use client';
import { useState } from 'react';
import Link from 'next/link';
import { BarChart3, Send, Ban, RefreshCw, UserPlus } from 'lucide-react';
import type { Assessment, Monitoring, Page, Student } from '@/types/admin';
import type { EntityMutation } from '@/types/admin';
import { useAdminMutation, useAdminQuery } from '@/hooks/use-admin';
import { queryString } from '@/services/api-client';
import {
  Badge,
  ConfirmDialog,
  dateTime,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  PageHeading,
  Pagination,
} from '@/components/ui/management';
import { AssessmentForm } from './assessment-form';
export function AssessmentDetail({ id }: { id: string }) {
  const [tab, setTab] = useState('overview');
  const [dialog, setDialog] = useState<'publish' | 'cancel' | null>(null);
  const query = useAdminQuery<Assessment>(`/admin/assessments/${id}`);
  const publish = useAdminMutation<EntityMutation, { revision: number }>(
    `/admin/assessments/${id}/publish`,
  );
  const cancel = useAdminMutation<Assessment, { revision: number }>(
    `/admin/assessments/${id}/cancel`,
  );
  if (query.isPending) return <LoadingState />;
  if (query.isError) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const a = query.data.data;
  const action = dialog === 'publish' ? publish : cancel;
  return (
    <>
      <PageHeading
        eyebrow="ASSESSMENT"
        title={a.title}
        description={a.description ?? 'Manage this assessment and monitor student progress.'}
        action={
          <>
            <Badge>{a.status}</Badge>
            {a.status === 'DRAFT' && (
              <button
                className="button"
                onClick={() => {
                  publish.reset();
                  setDialog('publish');
                }}
              >
                <Send size={16} />
                Publish
              </button>
            )}
            {!['CANCELLED', 'ARCHIVED', 'CLOSED'].includes(a.status) && (
              <button
                className="button secondary"
                onClick={() => {
                  cancel.reset();
                  setDialog('cancel');
                }}
              >
                <Ban size={16} />
                Cancel assessment
              </button>
            )}
          </>
        }
      />
      <div className="tabs" role="tablist" aria-label="Assessment views">
        {['overview', 'students', 'monitor'].map((t) => (
          <button
            key={t}
            role="tab"
            id={`tab-${t}`}
            aria-controls={`panel-${t}`}
            aria-selected={tab === t}
            tabIndex={tab === t ? 0 : -1}
            onKeyDown={(e) => {
              const list = ['overview', 'students', 'monitor'];
              const i = list.indexOf(t);
              if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                e.preventDefault();
                const next = list[(i + (e.key === 'ArrowRight' ? 1 : 2)) % 3]!;
                setTab(next);
                document.getElementById(`tab-${next}`)?.focus();
              }
            }}
            onClick={() => setTab(t)}
          >
            {t === 'monitor'
              ? 'Live monitoring'
              : t === 'students'
                ? 'Student assignments'
                : 'Overview & configuration'}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'overview' ? (
          a.status === 'DRAFT' ? (
            <AssessmentForm key={`${a.id}-${a.revision}`} initial={a} />
          ) : (
            <>
              <div className="stats-grid">
                <div className="stat-card">
                  <span>Assigned students</span>
                  <strong>{a.assignmentCount}</strong>
                </div>
                <div className="stat-card">
                  <span>Attempts started</span>
                  <strong>{a.attemptCount}</strong>
                </div>
                <div className="stat-card">
                  <span>Duration</span>
                  <strong>
                    {a.rule.durationSeconds / 60}
                    <small> min</small>
                  </strong>
                </div>
                <div className="stat-card">
                  <span>Questions</span>
                  <strong>{a.rule.easyCount + a.rule.mediumCount + a.rule.hardCount}</strong>
                </div>
              </div>
              <div className="panel form-panel">
                <h2>Published configuration</h2>
                <dl className="details-list">
                  <dt>Start</dt>
                  <dd>{dateTime(a.opensAt)}</dd>
                  <dt>Latest start</dt>
                  <dd>{dateTime(a.latestStartAt)}</dd>
                  <dt>Close</dt>
                  <dd>{dateTime(a.closesAt)}</dd>
                  <dt>Results release</dt>
                  <dd>{dateTime(a.resultsReleaseAt)}</dd>
                  <dt>Difficulty distribution</dt>
                  <dd>
                    {a.rule.easyCount} Easy · {a.rule.mediumCount} Medium · {a.rule.hardCount} Hard
                  </dd>
                  <dt>Languages</dt>
                  <dd>{a.rule.allowedLanguages.join(', ')}</dd>
                  <dt>Topics</dt>
                  <dd>{a.rule.allowedTopics.join(', ') || 'All topics'}</dd>
                  <dt>Scoring policy</dt>
                  <dd>{a.rule.submissionSelection.replaceAll('_', ' ')}</dd>
                </dl>
                <p className="notice">
                  Published configuration and assigned question versions remain immutable.
                </p>
                <Link className="button secondary" href={`/results?assessmentId=${a.id}`}>
                  <BarChart3 size={16} />
                  View results
                </Link>
              </div>
              <div className="panel form-panel">
                <h2>Frozen question pool</h2>
                <div className="pool-list">
                  {a.pool.map((q) => (
                    <div className="pool-item" key={q.id}>
                      <span>
                        {q.title}
                        <small>{q.topics.join(', ')}</small>
                      </span>
                      <Badge>{q.difficulty}</Badge>
                      <span>{q.maxScore} marks</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )
        ) : tab === 'students' ? (
          <Assignments id={id} />
        ) : (
          <Monitor id={id} />
        )}
      </div>
      <ConfirmDialog
        open={dialog !== null}
        title={dialog === 'publish' ? 'Publish this assessment?' : 'Cancel this assessment?'}
        description={
          dialog === 'publish'
            ? 'The backend validates the schedule, question pool, toolchains, and scoring rules. Published rules and versions become immutable.'
            : 'Students cannot start or continue submissions for a cancelled assessment. Existing work is retained for audit.'
        }
        confirmLabel={dialog === 'publish' ? 'Publish assessment' : 'Cancel assessment'}
        destructive={dialog === 'cancel'}
        pending={action.isPending}
        error={action.error}
        onClose={() => setDialog(null)}
        onConfirm={() =>
          action.mutate({ revision: a.revision }, { onSuccess: () => setDialog(null) })
        }
      />
    </>
  );
}
function Assignments({ id }: { id: string }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [cohorts, setCohorts] = useState('');
  const [message, setMessage] = useState('');
  const students = useAdminQuery<Page<Student>>(
    `/admin/students${queryString({ page, pageSize: 20, search, active: 'true' })}`,
  );
  const assign = useAdminMutation<unknown, { studentIds: string[]; cohorts: string[] }>(
    `/admin/assessments/${id}/assignments`,
  );
  return (
    <div className="panel form-panel">
      <h2>Assign students</h2>
      <p className="muted">
        Select active students or assign all active members of a cohort. Existing assignments are
        reused.
      </p>
      <div className="form-grid">
        <Field label="Find students" htmlFor="student-search">
          <input
            id="student-search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Name or student ID"
          />
        </Field>
        <Field label="Cohorts" htmlFor="cohorts" hint="Comma-separated exact cohort names.">
          <input id="cohorts" value={cohorts} onChange={(e) => setCohorts(e.target.value)} />
        </Field>
      </div>
      {students.isError ? (
        <ErrorState error={students.error} retry={() => void students.refetch()} />
      ) : students.isPending ? (
        <LoadingState />
      ) : (
        <>
          <div className="pool-list">
            {students.data.data.items.map((s) => (
              <label className="pool-item" key={s.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(s.id)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked ? [...selected, s.id] : selected.filter((x) => x !== s.id),
                    )
                  }
                />
                <span>
                  <strong>{s.displayName}</strong>
                  <small>
                    {s.externalId} · {s.cohort ?? 'No cohort'}
                  </small>
                </span>
                {s.assignments.some((a) => a.assessmentId === id) && <Badge>ASSIGNED</Badge>}
              </label>
            ))}
          </div>
          <Pagination
            page={page}
            pageSize={20}
            total={students.data.data.total}
            onChange={setPage}
          />
        </>
      )}
      {assign.error && (
        <p role="alert" className="alert">
          {assign.error.message}
        </p>
      )}
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      <button
        className="button"
        disabled={assign.isPending || (!selected.length && !cohorts.trim())}
        onClick={() =>
          assign.mutate(
            {
              studentIds: selected,
              cohorts: cohorts
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
            },
            {
              onSuccess: () => {
                setMessage('Assignments persisted.');
                setSelected([]);
                setCohorts('');
              },
            },
          )
        }
      >
        <UserPlus size={16} />
        {assign.isPending
          ? 'Assigning…'
          : `Assign students${selected.length ? ` (${selected.length})` : ''}`}
      </button>
    </div>
  );
}
function Monitor({ id }: { id: string }) {
  const [page, setPage] = useState(1);
  const query = useAdminQuery<Monitoring>(
    `/admin/assessments/${id}/monitor?page=${page}&pageSize=20`,
    5000,
  );
  return (
    <div className="panel">
      <div className="panel-heading">
        <div>
          <h2>Live assessment monitoring</h2>
          <p>
            Refreshes every five seconds. A stale heartbeat indicates connectivity, not cheating.
          </p>
        </div>
        <button
          className="icon-button"
          aria-label="Refresh monitoring"
          onClick={() => void query.refetch()}
        >
          <RefreshCw size={17} />
        </button>
      </div>
      {query.isPending ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : (
        <>
          <div className="monitor-counts">
            {Object.entries(query.data.data.counts).map(([label, value]) => (
              <span key={label}>
                <strong>{value}</strong>
                {label.replaceAll('_', ' ')}
              </span>
            ))}
          </div>
          {query.data.data.items.length === 0 ? (
            <EmptyState
              title="No students assigned"
              description="Assign students to start tracking progress."
            />
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Status</th>
                    <th>Last heartbeat</th>
                    <th>Expires</th>
                    <th>Evaluation</th>
                    <th>Score</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.data.items.map((s) => (
                    <tr key={s.assignmentId}>
                      <td>
                        <strong>{s.studentName}</strong>
                        <small>{s.externalId}</small>
                      </td>
                      <td>
                        <Badge>{s.status}</Badge>
                      </td>
                      <td>
                        {s.lastHeartbeatAt ? dateTime(s.lastHeartbeatAt) : 'No heartbeat recorded'}
                      </td>
                      <td>{s.expiresAt ? dateTime(s.expiresAt) : '—'}</td>
                      <td>{s.resultStatus ? <Badge>{s.resultStatus}</Badge> : '—'}</td>
                      <td>{s.score ?? 'Pending'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination page={page} pageSize={20} total={query.data.data.total} onChange={setPage} />
        </>
      )}
    </div>
  );
}
