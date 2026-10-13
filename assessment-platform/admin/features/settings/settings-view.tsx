'use client';
import { LockKeyhole, ShieldCheck, Server } from 'lucide-react';
import { useAdminQuery } from '@/hooks/use-admin';
import type { Settings } from '@/types/questions';
import { Badge, ErrorState, LoadingState, PageHeading } from '@/components/ui/management';
export function SettingsView() {
  const query = useAdminQuery<Settings>('/admin/settings', 30000);
  if (query.isPending) return <LoadingState />;
  if (query.isError) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const s = query.data.data;
  return (
    <>
      <PageHeading
        eyebrow="PLATFORM CONFIGURATION"
        title="System settings"
        description="Review effective security and execution settings. Deployment-controlled values are read-only."
      />
      <div className="settings-grid">
        <section className="panel form-panel">
          <h2>
            <ShieldCheck size={20} /> Authentication & sessions
          </h2>
          <dl className="details-list">
            {Object.entries(s.session).map(([key, value]) => (
              <div className="setting-row" key={key}>
                <dt>{key.replace(/([A-Z])/g, ' $1')}</dt>
                <dd>
                  {typeof value === 'boolean' ? (value ? 'Enabled' : 'Disabled') : String(value)}
                </dd>
              </div>
            ))}
          </dl>
          <p className="notice">
            HTTP-only server sessions, same-origin CSRF validation, and backend role checks protect
            administrative access.
          </p>
        </section>
        <section className="panel form-panel">
          <h2>
            <Server size={20} /> Execution readiness
          </h2>
          <dl className="details-list">
            <dt>Execution</dt>
            <dd>
              <Badge>{s.executionEnabled ? 'ACTIVE' : 'DISABLED'}</Badge>
            </dd>
            <dt>Question authoring</dt>
            <dd>
              <Badge>{s.questionAuthoringAvailable ? 'ACTIVE' : 'DISABLED'}</Badge>
            </dd>
          </dl>
          {!s.executionEnabled && (
            <p className="notice">
              Execution is disabled. Complete the isolated Linux judge gate and configure healthy
              workers before enabling it.
            </p>
          )}
          <p className="muted">
            Secrets, database credentials, and hidden tests are excluded from this response.
          </p>
        </section>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Pinned toolchain catalog</h2>
            <p>Published questions refer to these immutable toolchain identifiers.</p>
          </div>
          <LockKeyhole size={20} />
        </div>
        {s.toolchains.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Language</th>
                  <th>Version</th>
                  <th>Immutable identifier</th>
                </tr>
              </thead>
              <tbody>
                {s.toolchains.map((t) => (
                  <tr key={t.id}>
                    <td>{t.language === 'CPP' ? 'C++' : t.language}</td>
                    <td>{t.version}</td>
                    <td className="mono">{t.id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-inline">
            No toolchains configured. Question publication requires a reviewed catalog.
          </p>
        )}
      </section>
      {s.queueLimits && (
        <section className="panel form-panel">
          <h2>Admission & queue limits</h2>
          <pre className="audit-metadata">{JSON.stringify(s.queueLimits, null, 2)}</pre>
        </section>
      )}
      {s.policy && (
        <section className="panel form-panel">
          <h2>Assessment policy bounds</h2>
          <pre className="audit-metadata">{JSON.stringify(s.policy, null, 2)}</pre>
        </section>
      )}
    </>
  );
}
