'use client';
import Link from 'next/link';
import {
  Activity,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  Clock,
  Plus,
  Users,
} from 'lucide-react';
import { useAdminQuery } from '@/hooks/use-admin';
import { Badge, dateTime, ErrorState, LoadingState, PageHeading } from '@/components/ui/management';
interface Dashboard {
  totalStudents: number;
  totalAssessments: number;
  upcomingAssessments: number;
  activeAssessments: number;
  completedAssessments: number;
  currentlyActiveStudents: number;
  completionRate: number;
  queue: {
    pending: number;
    queued: number;
    running: number;
    failed: number;
    oldestPendingAt: string | null;
    healthyWorkers: number;
    status: 'HEALTHY' | 'DEGRADED' | 'DISABLED';
  };
  recentActions: {
    id: string;
    action: string;
    entityType: string;
    entityId: string | null;
    occurredAt: string;
    actorName: string | null;
  }[];
}
export function AdminDashboard() {
  const query = useAdminQuery<Dashboard>('/admin/dashboard', 10000);
  if (query.isPending) return <LoadingState />;
  if (query.isError) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const data = query.data.data;
  const stats = [
    {
      label: 'Total students',
      value: data.totalStudents,
      icon: Users,
      detail: `${data.currentlyActiveStudents} currently active`,
    },
    {
      label: 'All assessments',
      value: data.totalAssessments,
      icon: CalendarDays,
      detail: `${data.completedAssessments} completed`,
    },
    {
      label: 'Upcoming',
      value: data.upcomingAssessments,
      icon: Clock,
      detail: 'Published, scheduled assessments',
    },
    {
      label: 'Active assessments',
      value: data.activeAssessments,
      icon: Activity,
      detail: 'Currently within the exam window',
    },
  ];
  return (
    <>
      <PageHeading
        eyebrow="WORKSPACE OVERVIEW"
        title="Assessment operations"
        description="A live view of your students, assessments, and evaluation pipeline."
        action={
          <Link className="button" href="/assessments/create">
            <Plus size={17} />
            Create assessment
          </Link>
        }
      />
      <div className="stats-grid">
        {stats.map(({ label, value, icon: Icon, detail }) => (
          <div className="stat-card" key={label}>
            <div>
              <span>{label}</span>
              <Icon size={19} />
            </div>
            <strong>{value.toLocaleString()}</strong>
            <small>{detail}</small>
          </div>
        ))}
      </div>
      <div className="dashboard-grid">
        <section className="panel form-panel">
          <div className="panel-heading">
            <div>
              <h2>Evaluation pipeline</h2>
              <p>Durable submission status from PostgreSQL.</p>
            </div>
            <Badge
              tone={
                data.queue.status === 'HEALTHY'
                  ? 'success'
                  : data.queue.status === 'DISABLED'
                    ? 'neutral'
                    : 'warning'
              }
            >
              {data.queue.status}
            </Badge>
          </div>
          <div className="queue-grid">
            {[
              { label: 'Pending dispatch', count: data.queue.pending },
              { label: 'Queued', count: data.queue.queued },
              { label: 'Running', count: data.queue.running },
              { label: 'Failed / review', count: data.queue.failed },
            ].map((q) => (
              <div key={q.label}>
                <strong>{q.count}</strong>
                <span>{q.label}</span>
              </div>
            ))}
          </div>
          <div className="queue-footer">
            <span>{data.queue.healthyWorkers} healthy judge workers</span>
            <span>
              Oldest pending:{' '}
              {data.queue.oldestPendingAt ? dateTime(data.queue.oldestPendingAt) : 'None'}
            </span>
          </div>
          <Link className="text-button" href="/submissions">
            Inspect submissions
            <ArrowUpRight size={15} />
          </Link>
        </section>
        <section className="panel form-panel completion-panel">
          <div className="panel-heading">
            <div>
              <h2>Assessment completion</h2>
              <p>Backend-calculated completion rate.</p>
            </div>
            <CheckCircle2 size={22} />
          </div>
          <strong className="completion-value">
            {(data.completionRate * 100).toFixed(1)}
            <span>%</span>
          </strong>
          <progress
            value={Math.min(100, Math.max(0, data.completionRate * 100))}
            max={100}
            aria-label="Assessment completion rate"
          />
          <div className="queue-footer">
            <span>{data.currentlyActiveStudents} active students</span>
            <Link href="/results" className="text-button">
              View analytics
              <ArrowUpRight size={14} />
            </Link>
          </div>
        </section>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Recent administrative activity</h2>
            <p>Changes recorded in the append-only audit trail.</p>
          </div>
          <Link href="/audit-logs" className="button secondary small">
            View audit trail
            <ArrowUpRight size={14} />
          </Link>
        </div>
        {data.recentActions.length ? (
          <div className="activity-list">
            {data.recentActions.map((a) => (
              <div key={a.id}>
                <span className="activity-dot" />
                <div>
                  <strong>{a.action.replaceAll('_', ' ')}</strong>
                  <small>
                    {a.actorName ?? 'System'} · {a.entityType}
                  </small>
                </div>
                <time dateTime={a.occurredAt}>{dateTime(a.occurredAt)}</time>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-inline">No administrative actions recorded yet.</p>
        )}
      </section>
      <p className="updated-at">Server snapshot: {dateTime(query.data.meta.serverNow)}</p>
    </>
  );
}
