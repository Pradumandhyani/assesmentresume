'use client';
import { useState } from 'react';
import { useAdminQuery } from '@/hooks/use-admin';
import { queryString } from '@/services/api-client';
import type { Audit, Page } from '@/types/admin';
import {
  Badge,
  dateTime,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeading,
  Pagination,
} from '@/components/ui/management';
export function AuditList() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const query = useAdminQuery<Page<Audit & { actorName: string | null }>>(
    `/admin/audit-logs${queryString({ page, pageSize: 25, search })}`,
  );
  return (
    <>
      <PageHeading
        eyebrow="GOVERNANCE"
        title="Audit trail"
        description="An append-only record of administrative actions and sensitive lifecycle changes."
      />
      <div className="panel">
        <div className="table-toolbar">
          <input
            aria-label="Search audit logs"
            placeholder="Search action or entity"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        {query.isPending ? (
          <LoadingState />
        ) : query.isError ? (
          <ErrorState error={query.error} retry={() => void query.refetch()} />
        ) : query.data.data.items.length === 0 ? (
          <EmptyState
            title="No audit events found"
            description="Try a different filter. Administrative changes are recorded automatically."
          />
        ) : (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Action</th>
                    <th>Actor</th>
                    <th>Entity</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.data.items.map((a) => (
                    <tr key={a.id}>
                      <td>{dateTime(a.occurredAt)}</td>
                      <td>
                        <Badge>{a.action}</Badge>
                      </td>
                      <td>{a.actorName ?? 'System'}</td>
                      <td>
                        {a.entityType}
                        <small className="mono">{a.entityId ?? '—'}</small>
                      </td>
                      <td>
                        <details>
                          <summary>Event metadata</summary>
                          <pre className="audit-metadata">
                            {JSON.stringify(a.metadata, null, 2)}
                          </pre>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page}
              pageSize={25}
              total={query.data.data.total}
              onChange={setPage}
            />
          </>
        )}
      </div>
    </>
  );
}
