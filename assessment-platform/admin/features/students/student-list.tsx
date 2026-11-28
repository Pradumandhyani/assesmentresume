'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Search, ShieldOff } from 'lucide-react';
import type { EntityMutation } from '@/types/admin';
import { useAdminMutation, useAdminQuery } from '@/hooks/use-admin';
import { queryString } from '@/services/api-client';
import type { Page, Student } from '@/types/admin';
import {
  Badge,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeading,
  Pagination,
} from '@/components/ui/management';
export function StudentList({ institutionId }: { institutionId?: string }) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [active, setActive] = useState('');
  const [course, setCourse] = useState('');
  const [selected, setSelected] = useState<Student | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const query = useAdminQuery<Page<Student>>(
    `/admin/students${queryString({ page, pageSize: 20, search, active, institutionId, course })}`,
  );
  const update = useAdminMutation<EntityMutation, { active: boolean }>(
    `/admin/students/${selected?.id ?? ''}`,
    'PATCH',
  );
  return (
    <>
      <PageHeading
        eyebrow="PEOPLE"
        title="Students"
        description="Manage account access and review assessment eligibility and progress."
        action={
          !institutionId && (
            <Link className="button" href="/institutions">
              Add students through an institution
            </Link>
          )
        }
      />
      <div className="panel">
        <div className="table-toolbar">
          <div className="search-input">
            <Search size={17} />
            <input
              aria-label="Search students"
              placeholder="Search name or student ID"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <select
            aria-label="Filter student access"
            value={active}
            onChange={(e) => {
              setActive(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All accounts</option>
            <option value="true">Active</option>
            <option value="false">Disabled</option>
          </select>
          <input
            aria-label="Filter students by course"
            placeholder="Exact course name"
            value={course}
            onChange={(e) => {
              setCourse(e.target.value);
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
            title="No matching students"
            description="Try another name, student ID, or account filter."
          />
        ) : (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Student ID</th>
                    {!institutionId && <th>Institution</th>}
                    <th>Cohort</th>
                    <th>Course</th>
                    <th>Access</th>
                    <th>Assessments</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.data.items.map((student) => (
                    <tr key={student.id}>
                      <td>
                        <strong>{student.displayName}</strong>
                      </td>
                      <td className="mono">{student.externalId}</td>
                      {!institutionId && (
                        <td>
                          {student.institution ? (
                            <Link href={`/institutions/${student.institution.id}`}>
                              {student.institution.name}
                            </Link>
                          ) : (
                            'Unassigned'
                          )}
                        </td>
                      )}
                      <td>{student.cohort ?? '—'}</td>
                      <td>
                        <StudentCourse student={student} />
                      </td>
                      <td>
                        <Badge>{student.isActive ? 'ACTIVE' : 'DISABLED'}</Badge>
                      </td>
                      <td>
                        <button
                          className="text-button"
                          onClick={() => setExpanded(expanded === student.id ? null : student.id)}
                          aria-expanded={expanded === student.id}
                        >
                          {student.assignments.length} assigned
                        </button>
                        {expanded === student.id && (
                          <div className="assignment-list">
                            {student.assignments.length ? (
                              student.assignments.map((a) => (
                                <div key={a.assessmentId}>
                                  <Link href={`/assessments/${a.assessmentId}`}>{a.title}</Link>
                                  <Badge>{a.attemptStatus ?? a.status}</Badge>
                                  <small>Score: {a.score ?? 'Pending'}</small>
                                  {a.eligibility && (
                                    <small>Eligibility: {a.eligibility.replaceAll('_', ' ')}</small>
                                  )}
                                </div>
                              ))
                            ) : (
                              <small>No assignments. Assign through an assessment.</small>
                            )}
                          </div>
                        )}
                      </td>
                      <td>
                        <button
                          className="button secondary small"
                          onClick={() => {
                            update.reset();
                            setSelected(student);
                          }}
                        >
                          <ShieldOff size={14} />
                          {student.isActive ? 'Disable' : 'Enable'}
                        </button>
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
      <ConfirmDialog
        open={selected !== null}
        title={`${selected?.isActive ? 'Disable' : 'Enable'} student account?`}
        description={
          selected?.isActive
            ? 'This immediately revokes the student’s sessions. Existing attempts and submitted work remain stored.'
            : 'The student will be able to sign in using existing credentials.'
        }
        confirmLabel={selected?.isActive ? 'Disable account' : 'Enable account'}
        destructive={selected?.isActive ?? false}
        pending={update.isPending}
        error={update.error}
        onClose={() => setSelected(null)}
        onConfirm={() => {
          if (selected)
            update.mutate({ active: !selected.isActive }, { onSuccess: () => setSelected(null) });
        }}
      />
    </>
  );
}

function StudentCourse({ student }: { student: Student }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(student.course ?? '');
  const update = useAdminMutation<EntityMutation, { course: string }>(
    `/admin/students/${student.id}`,
    'PATCH',
  );
  if (!editing)
    return (
      <>
        {student.course ?? 'Not set'}{' '}
        <button
          type="button"
          className="text-button"
          aria-label={`Edit course for ${student.displayName}`}
          onClick={() => {
            setName(student.course ?? '');
            update.reset();
            setEditing(true);
          }}
        >
          Edit
        </button>
      </>
    );
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        update.mutate({ course: name.trim() }, { onSuccess: () => setEditing(false) });
      }}
    >
      <input
        aria-label={`Course for ${student.displayName}`}
        required
        maxLength={100}
        value={name}
        onChange={(event) => setName(event.target.value)}
        disabled={update.isPending}
      />
      <button
        type="submit"
        className="button secondary small"
        disabled={update.isPending || !name.trim()}
      >
        Save course
      </button>
      <button
        type="button"
        className="text-button"
        disabled={update.isPending}
        onClick={() => setEditing(false)}
      >
        Cancel
      </button>
      {update.error && (
        <p className="alert" role="alert">
          {update.error.message}
        </p>
      )}
    </form>
  );
}
