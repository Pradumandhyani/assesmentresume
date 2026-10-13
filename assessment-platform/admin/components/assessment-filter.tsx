'use client';
import { useState } from 'react';
import { useAdminQuery } from '@/hooks/use-admin';
import { queryString } from '@/services/api-client';
import type { Assessment, Page } from '@/types/admin';
export function AssessmentFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  const query = useAdminQuery<Page<Assessment>>(
    `/admin/assessments${queryString({ search, page: 1, pageSize: 100 })}`,
  );
  const items = query.data?.data.items ?? [];
  return (
    <div className="assessment-filter">
      <input
        aria-label="Find an assessment to filter"
        placeholder="Find assessment by title"
        maxLength={128}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <select
        aria-label="Filter by assessment"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={query.isPending}
      >
        <option value="">All assessments</option>
        {value && !items.some((a) => a.id === value) && (
          <option value={value}>Selected assessment</option>
        )}
        {items.map((a) => (
          <option key={a.id} value={a.id}>
            {a.title}
          </option>
        ))}
      </select>
      {query.isError && (
        <button className="text-button" onClick={() => void query.refetch()}>
          Retry assessment list
        </button>
      )}
    </div>
  );
}
