'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowDownToLine,
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Clock3,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UserRound,
} from 'lucide-react';
import { PlatformLogo } from '@/components/platform-logo';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { ApiError } from '@/services/api-client';
import { useSession, useLogout } from '@/features/auth/use-auth';
import { useAssessments } from '@/features/assessments/use-assessments';
import { AssessmentCard } from '@/features/assessments/assessment-card';
import { DashboardSkeleton } from './dashboard-skeleton';
type Tab = 'UPCOMING' | 'ACTIVE' | 'COMPLETED' | 'CLOSED';
const tabs: { id: Tab; label: string }[] = [
  { id: 'UPCOMING', label: 'Upcoming' },
  { id: 'ACTIVE', label: 'Active' },
  { id: 'COMPLETED', label: 'Completed' },
  { id: 'CLOSED', label: 'Closed & cancelled' },
];
export function StudentDashboard() {
  const router = useRouter();
  const session = useSession();
  const assessments = useAssessments();
  const logout = useLogout();
  const [tab, setTab] = useState<Tab>('UPCOMING');
  const [profile, setProfile] = useState(false);
  const [help, setHelp] = useState(false);
  const refresh = useCallback(() => {
    void assessments.refetch();
  }, [assessments.refetch]);
  const error = session.error ?? assessments.error;
  useEffect(() => {
    if (error instanceof ApiError && [401, 403].includes(error.status)) {
      router.replace('/login');
      router.refresh();
    }
  }, [error, router]);
  useEffect(() => {
    const visible = () => {
      if (document.visibilityState === 'visible') {
        void assessments.refetch();
        void session.refetch();
      }
    };
    const reconnect = () => {
      void assessments.refetch();
    };
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('pageshow', reconnect);
    window.addEventListener('online', reconnect);
    return () => {
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('pageshow', reconnect);
      window.removeEventListener('online', reconnect);
    };
  }, [assessments.refetch, session.refetch]);
  async function signOut() {
    try {
      await logout.mutateAsync();
      router.replace('/login');
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        router.replace('/login');
        router.refresh();
      }
    }
  }
  const student = session.data?.data.student;
  const firstPage = assessments.data?.pages[0];
  if ((session.isPending || assessments.isPending) && !error) return <DashboardSkeleton />;
  if (!student || !firstPage)
    return (
      <main className="full-error">
        <ShieldCheck size={34} />
        <h1>Your workspace is temporarily unavailable.</h1>
        <p role="alert">{error?.message ?? 'We couldn’t load your assessments.'}</p>
        <Button
          className="primary-button"
          onClick={() => {
            void session.refetch();
            refresh();
          }}
        >
          <RefreshCw size={16} />
          Try again
        </Button>
      </main>
    );
  const summary = firstPage.data.summary;
  const items = assessments.data!.pages.flatMap((page) => page.data.items);
  const selected = items.filter((item) =>
    tab === 'CLOSED' ? ['CLOSED', 'CANCELLED'].includes(item.category) : item.category === tab,
  );
  const countFor = (id: Tab) =>
    id === 'CLOSED'
      ? summary.closed + summary.cancelled
      : summary[id.toLowerCase() as 'upcoming' | 'active' | 'completed'];
  const initials = student.displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
  const firstName = student.displayName.split(/\s+/)[0];
  return (
    <div className="dashboard-shell">
      <aside className="sidebar">
        <a href="/dashboard" aria-label="CodeBench dashboard">
          <PlatformLogo />
        </a>
        <div className="sidebar-section">WORKSPACE</div>
        <nav aria-label="Workspace">
          <a className="sidebar-link selected" href="/dashboard" aria-current="page">
            <LayoutDashboard size={19} />
            Overview
            <span className="nav-current-dot" />
          </a>
          <button
            className="sidebar-link"
            onClick={() => {
              setTab('UPCOMING');
              document.getElementById('assessments')?.scrollIntoView({ behavior: 'smooth' });
            }}
          >
            <CalendarDays size={19} />
            My assessments
            {summary.upcoming > 0 && <span className="nav-count">{summary.upcoming}</span>}
          </button>
          <button
            className="sidebar-link"
            onClick={() => {
              setTab('COMPLETED');
              document.getElementById('assessments')?.scrollIntoView({ behavior: 'smooth' });
            }}
          >
            <BookOpen size={19} />
            Assessment history
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="focus-card">
            <span>
              <Sparkles size={19} />
            </span>
            <h3>A little focus goes a long way.</h3>
            <p>Find a quiet spot. Think it through. You&apos;ve got this.</p>
            <i aria-hidden="true" />
          </div>
          <button className="sidebar-link" onClick={() => setHelp(true)}>
            <CircleHelp size={19} />
            Help & support
            <ArrowUpRight size={15} />
          </button>
          <span className="sidebar-caption">YOUR POTENTIAL, IN PROGRESS.</span>
        </div>
      </aside>
      <div className="dashboard-body">
        <header className="dashboard-header">
          <span className="header-breadcrumb">
            <span>Workspace</span>
            <span>/</span>Overview
          </span>
          <div className="mobile-logo">
            <PlatformLogo />
          </div>
          <button
            className="profile-button"
            onClick={() => setProfile(true)}
            aria-haspopup="dialog"
          >
            <span className="avatar">{initials}</span>
            <span className="profile-text">
              <strong>{student.displayName}</strong>
              <small>{student.externalId}</small>
            </span>
            <ChevronDown size={16} />
          </button>
        </header>
        <main className="dashboard-main">
          <div className="welcome-row">
            <div>
              <span className="eyebrow welcome-eyebrow">LET&apos;S MAKE PROGRESS</span>
              <h1>
                Welcome back, {firstName}
                <span className="welcome-wave" aria-hidden="true">
                  ✦
                </span>
              </h1>
              <p>One challenge at a time. Your next opportunity is waiting.</p>
            </div>
            <span className="secure-badge">
              <ShieldCheck size={16} />
              Secure student workspace
            </span>
          </div>
          <section className="stats-grid" aria-label="Assessment summary">
            {[
              {
                label: 'Upcoming assessments',
                count: summary.upcoming,
                icon: CalendarDays,
                text: 'Get ready for what’s next',
                tone: 'purple',
              },
              {
                label: 'Active assessments',
                count: summary.active,
                icon: Clock3,
                text: 'Your current challenges',
                tone: 'amber',
              },
              {
                label: 'Completed assessments',
                count: summary.completed,
                icon: CheckCircle2,
                text: 'Every attempt is progress',
                tone: 'green',
              },
            ].map(({ label, count, icon: Icon, text, tone }) => (
              <article className="stat-card" key={label}>
                <div>
                  <span className="stat-label">{label}</span>
                  <strong className="stat-number">{String(count).padStart(2, '0')}</strong>
                  <span className="stat-caption">{text}</span>
                </div>
                <span className={`stat-icon stat-${tone}`}>
                  <Icon size={21} />
                </span>
              </article>
            ))}
          </section>
          <section id="assessments" className="assessments-section">
            <div className="section-heading">
              <div>
                <h2>
                  Your assessments
                  <span className="section-count">
                    {summary.upcoming +
                      summary.active +
                      summary.completed +
                      summary.closed +
                      summary.cancelled}
                  </span>
                </h2>
                <p>All your challenges, organized in one place.</p>
              </div>
              <button
                className="refresh-button"
                onClick={refresh}
                disabled={assessments.isFetching}
                aria-label="Refresh assessments"
              >
                <RefreshCw size={15} className={assessments.isFetching ? 'spin' : ''} />
                <span>Refresh</span>
              </button>
            </div>
            <div className="assessment-tabs" role="tablist" aria-label="Assessment status">
              {tabs.map(({ id, label }) => (
                <button
                  role="tab"
                  id={`tab-${id}`}
                  aria-controls="assessment-panel"
                  aria-selected={tab === id}
                  tabIndex={tab === id ? 0 : -1}
                  key={id}
                  className={tab === id ? 'tab-active' : ''}
                  onClick={() => setTab(id)}
                  onKeyDown={(event) => {
                    if (['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) {
                      event.preventDefault();
                      const index = tabs.findIndex((t) => t.id === id);
                      const next =
                        event.key === 'Home'
                          ? 0
                          : event.key === 'End'
                            ? tabs.length - 1
                            : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) %
                              tabs.length;
                      const target = tabs[next]!.id;
                      setTab(target);
                      document.getElementById(`tab-${target}`)?.focus();
                    }
                  }}
                >
                  <span>{label}</span>
                  <span className="tab-count">{countFor(id)}</span>
                </button>
              ))}
            </div>
            {error && (
              <div className="dashboard-alert" role="alert">
                {error.message} <button onClick={refresh}>Retry</button>
              </div>
            )}
            <div
              id="assessment-panel"
              role="tabpanel"
              aria-labelledby={`tab-${tab}`}
              className="assessment-list"
            >
              {selected.length ? (
                selected.map((item) => (
                  <AssessmentCard
                    key={item.assessment.id}
                    item={item}
                    serverNow={firstPage.meta.serverNow}
                    onRefresh={refresh}
                  />
                ))
              ) : (
                <div className="empty-state">
                  <span>
                    <CalendarDays size={27} />
                  </span>
                  <h3>
                    {tab === 'UPCOMING'
                      ? 'A little breathing room.'
                      : tab === 'ACTIVE'
                        ? 'No active assessments.'
                        : tab === 'COMPLETED'
                          ? 'Your journey is just beginning.'
                          : 'Nothing to show here.'}
                  </h3>
                  <p>
                    {tab === 'UPCOMING'
                      ? 'Assigned assessments will appear here when they’re scheduled.'
                      : tab === 'COMPLETED'
                        ? 'Your completed assessments and released scores will appear here.'
                        : 'Check back for updates from your assessment coordinator.'}
                  </p>
                </div>
              )}
              {assessments.hasNextPage && (
                <Button
                  variant="outline"
                  disabled={assessments.isFetchingNextPage}
                  onClick={() => {
                    void assessments.fetchNextPage();
                  }}
                >
                  <ArrowDownToLine size={16} />
                  {assessments.isFetchingNextPage ? 'Loading…' : 'Load more assessments'}
                </Button>
              )}
            </div>
          </section>
          <div className="preparation-note">
            <span>
              <Sparkles size={20} />
            </span>
            <div>
              <strong>A good setup makes a difference.</strong>
              <p>
                Use a stable internet connection, keep your device charged and choose a
                distraction-free space.
              </p>
            </div>
          </div>
          <footer className="dashboard-footer">
            <span>CodeBench · Built for better problem solvers.</span>
            <span>
              <ShieldCheck size={13} />
              Your progress stays private.
            </span>
          </footer>
        </main>
      </div>
      <Modal open={profile} onClose={() => setProfile(false)} title="Your student profile">
        <div className="profile-modal-identity">
          <span className="avatar">{initials}</span>
          <div>
            <strong>{student.displayName}</strong>
            <p>Student ID: {student.externalId}</p>
          </div>
        </div>
        <p className="modal-note">
          Manage your credentials through your institution&apos;s assessment coordinator.
        </p>
        {logout.error && (
          <p className="form-alert" role="alert">
            {logout.error.message}
          </p>
        )}
        <Button
          className="primary-button"
          onClick={() => {
            void signOut();
          }}
          disabled={logout.isPending}
        >
          {logout.isPending ? <LoaderCircle size={17} className="spin" /> : <LogOut size={17} />}
          Sign out
        </Button>
      </Modal>
      <Modal open={help} onClose={() => setHelp(false)} title="Help & support">
        <p>
          For assessment access, schedule changes or password assistance, contact your
          institution&apos;s assessment coordinator.
        </p>
        <p className="modal-note">
          Include your student ID and assessment title. Keep your password private.
        </p>
        <Button className="primary-button" onClick={() => setHelp(false)}>
          <UserRound size={16} />
          Got it
        </Button>
      </Modal>
    </div>
  );
}
