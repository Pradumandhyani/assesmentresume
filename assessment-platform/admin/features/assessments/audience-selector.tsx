'use client';
import { useState } from 'react';
import { useAdminQuery } from '@/hooks/use-admin';
import { queryString } from '@/services/api-client';
import type { AssignmentTarget, Institution, Page, Student } from '@/types/admin';
import { Badge, ErrorState, Field, LoadingState, Pagination } from '@/components/ui/management';

export function AudienceSelector({
  value,
  onChange,
  assessmentId,
}: {
  value: AssignmentTarget;
  onChange: (target: AssignmentTarget) => void;
  assessmentId?: string;
}) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [institutionSearch, setInstitutionSearch] = useState('');
  const [institutionPage, setInstitutionPage] = useState(1);
  const institutions = useAdminQuery<Page<Institution>>(
    `/admin/institutions${queryString({ search: institutionSearch, page: institutionPage, pageSize: 100 })}`,
  );
  const courses = useAdminQuery<{ items: { name: string; studentCount: number }[] }>(
    `/admin/institutions/${value.institutionId}/courses`,
    undefined,
    !!value.institutionId,
  );
  const students = useAdminQuery<Page<Student>>(
    `/admin/students${queryString({ institutionId: value.institutionId, course: value.course, search, page, pageSize: 20, active: 'true' })}`,
  );
  const scopeTotal = useAdminQuery<Page<Student>>(
    `/admin/students${queryString({ institutionId: value.institutionId, course: value.course, pageSize: 1, active: 'true' })}`,
  );
  const rows = students.data?.data.items ?? [];
  function changeScope(next: Partial<AssignmentTarget>) {
    onChange({ ...value, ...next, studentIds: [] });
    setPage(1);
    setSearch('');
  }
  return (
    <div className="audience-selector">
      <div className="form-grid">
        <Field label="Find institution" htmlFor="audience-institution-search">
          <input
            id="audience-institution-search"
            value={institutionSearch}
            placeholder="Search institution name or ID"
            onChange={(e) => {
              setInstitutionSearch(e.target.value);
              setInstitutionPage(1);
            }}
          />
        </Field>
        <Field label="Institution" htmlFor="audience-institution">
          <select
            id="audience-institution"
            value={value.institutionId ?? ''}
            onChange={(e) =>
              changeScope({ institutionId: e.target.value || undefined, course: undefined })
            }
          >
            <option value="">All institutions and unassigned students</option>
            {value.institutionId &&
              !institutions.data?.data.items.some((i) => i.id === value.institutionId) && (
                <option value={value.institutionId}>Selected institution</option>
              )}
            {institutions.data?.data.items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} ({i.institutionId})
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Course"
          htmlFor="audience-course"
          hint="Choose an institution to filter its courses."
        >
          <select
            id="audience-course"
            disabled={!value.institutionId || courses.isPending || courses.isError}
            value={value.course ?? ''}
            onChange={(e) => changeScope({ course: e.target.value || undefined })}
          >
            <option value="">All courses</option>
            {courses.data?.data.items.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name} ({c.studentCount})
              </option>
            ))}
          </select>
        </Field>
      </div>
      {institutions.isError && (
        <ErrorState error={institutions.error} retry={() => void institutions.refetch()} />
      )}
      {institutions.data && institutions.data.data.total > 100 && (
        <Pagination
          page={institutionPage}
          pageSize={100}
          total={institutions.data.data.total}
          onChange={setInstitutionPage}
        />
      )}
      {value.institutionId && courses.isError && (
        <ErrorState error={courses.error} retry={() => void courses.refetch()} />
      )}
      <label className="checkbox">
        <input
          type="checkbox"
          checked={value.allStudents}
          onChange={(e) => onChange({ ...value, allStudents: e.target.checked, studentIds: [] })}
        />
        Assign all active students in this scope
      </label>
      <p className="notice" role="status">
        {value.allStudents
          ? `${scopeTotal.data?.data.total ?? 'Loading'} active students in the selected scope. This includes all pages.`
          : `${value.studentIds.length} students selected across pages.`}{' '}
        Assignments include currently enrolled students. Students added later can be assigned here
        separately.
      </p>
      {scopeTotal.isError && (
        <ErrorState error={scopeTotal.error} retry={() => void scopeTotal.refetch()} />
      )}
      {scopeTotal.data?.data.total === 0 && (
        <p className="notice">
          No active students in this scope. Add students to the institution and course first.
        </p>
      )}
      {!value.allStudents && (
        <>
          <Field label="Find students" htmlFor="audience-student-search">
            <input
              id="audience-student-search"
              placeholder="Search name or student ID"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </Field>
          {students.isPending ? (
            <LoadingState />
          ) : students.isError ? (
            <ErrorState error={students.error} retry={() => void students.refetch()} />
          ) : (
            <>
              {rows.length === 0 ? (
                <p className="muted">No matching active students.</p>
              ) : (
                <>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={rows.every((s) => value.studentIds.includes(s.id))}
                      onChange={(e) =>
                        onChange({
                          ...value,
                          studentIds: e.target.checked
                            ? [...new Set([...value.studentIds, ...rows.map((s) => s.id)])]
                            : value.studentIds.filter((id) => !rows.some((s) => s.id === id)),
                        })
                      }
                    />
                    Select all students on this page
                  </label>
                  <div className="pool-list">
                    {rows.map((s) => (
                      <label className="pool-item" key={s.id}>
                        <input
                          type="checkbox"
                          checked={value.studentIds.includes(s.id)}
                          onChange={(e) =>
                            onChange({
                              ...value,
                              studentIds: e.target.checked
                                ? [...value.studentIds, s.id]
                                : value.studentIds.filter((id) => id !== s.id),
                            })
                          }
                        />
                        <span>
                          <strong>{s.displayName}</strong>
                          <small>
                            {s.externalId} · {s.institution?.name ?? 'No institution'} ·{' '}
                            {s.course ?? 'No course'}
                          </small>
                        </span>
                        {assessmentId &&
                          s.assignments.some(
                            (a) => a.assessmentId === assessmentId && a.status === 'ASSIGNED',
                          ) && <Badge>ASSIGNED</Badge>}
                      </label>
                    ))}
                  </div>
                </>
              )}
              <Pagination
                page={page}
                pageSize={20}
                total={students.data.data.total}
                onChange={setPage}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
