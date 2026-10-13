'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import {
  Activity,
  BarChart3,
  BookOpen,
  CalendarDays,
  ChevronRight,
  ClipboardList,
  Code2,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { ApiError, authApi } from '@/services/api-client';
import type { Envelope, Session } from '@/types/admin';
const links = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/students', label: 'Students', icon: Users },
  { href: '/assessments', label: 'Assessments', icon: CalendarDays },
  { href: '/questions', label: 'Question bank', icon: BookOpen },
  { href: '/submissions', label: 'Submissions', icon: Code2 },
  { href: '/results', label: 'Results & analytics', icon: BarChart3 },
  { href: '/audit-logs', label: 'Audit trail', icon: ClipboardList },
  { href: '/settings', label: 'System settings', icon: Settings },
];
export function AdminShell({
  children,
  initialSession,
}: {
  children: ReactNode;
  initialSession: Envelope<Session>;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const cache = useQueryClient();
  const [open, setOpen] = useState(false);
  const session = useQuery({
    queryKey: ['admin-session'],
    queryFn: ({ signal }) => authApi.me(signal),
    initialData: initialSession,
    refetchInterval: 30000,
    retry: false,
  });
  const logout = useMutation({
    mutationFn: authApi.logout,
    onSuccess: () => {
      cache.clear();
      router.replace('/login');
      router.refresh();
    },
  });
  useEffect(() => {
    if (session.error instanceof ApiError && [401, 403].includes(session.error.status)) {
      cache.clear();
      router.replace('/login');
    }
    if (session.data?.data.user.role !== 'ADMIN') router.replace('/login');
  }, [session.error, session.data, cache, router]);
  const current = links.find((link) => pathname.startsWith(link.href));
  return (
    <div className="console-root">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      {open && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        className={`sidebar ${open ? 'sidebar-open' : ''}`}
        aria-label="Administration navigation"
      >
        <Link href="/dashboard" className="brand">
          <span className="brand-mark">
            <Code2 size={23} />
          </span>
          <span>
            Assess<span className="brand-dot">.</span>
            <small>ADMINISTRATION</small>
          </span>
        </Link>
        <button
          className="mobile-close icon-button"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        >
          <X size={20} />
        </button>
        <div className="nav-caption">WORKSPACE</div>
        <nav>
          {links.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className={`nav-link ${pathname.startsWith(href) ? 'nav-active' : ''}`}
              aria-current={pathname.startsWith(href) ? 'page' : undefined}
            >
              <Icon size={18} />
              {label}
              {pathname.startsWith(href) && <ChevronRight size={14} />}
            </Link>
          ))}
        </nav>
        <div className="sidebar-note">
          <ShieldCheck size={20} />
          <strong>Secure assessment console</strong>
          <span>Every administrative change is validated and recorded.</span>
        </div>
      </aside>
      <div className="console-content">
        <header className="console-header">
          <div className="header-left">
            <button
              className="mobile-menu icon-button"
              aria-label="Open navigation"
              aria-expanded={open}
              onClick={() => setOpen(true)}
            >
              <Menu size={22} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={15} />
            <strong>{current?.label ?? 'Administration'}</strong>
          </div>
          <div className="header-account">
            <span className="header-status">
              <Activity size={14} /> Admin console
            </span>
            <span className="avatar">
              {session.data.data.user.displayName.slice(0, 1).toUpperCase()}
            </span>
            <span className="account-name">
              {session.data.data.user.displayName}
              <small>Administrator</small>
            </span>
            <button
              className="icon-button"
              aria-label="Sign out"
              disabled={logout.isPending}
              onClick={() => logout.mutate()}
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>
        {logout.error && (
          <p className="alert" role="alert">
            {logout.error.message}
          </p>
        )}
        <main id="main-content" className="page-content">
          {children}
        </main>
        <footer className="console-footer">
          Assessment platform <span>Server-authoritative exams · Immutable question versions</span>
        </footer>
      </div>
    </div>
  );
}
