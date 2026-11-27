'use client';
import { useRef, useState, type FormEvent } from 'react';
import { useAdminMutation } from '@/hooks/use-admin';
import type { NewStudent } from '@/types/admin';
import { Field } from '@/components/ui/management';
import { readStudentFile, studentColumns } from './student-import';

type Created = { id: string; createdCount: number };
export function StudentEntry({ institutionId }: { institutionId: string }) {
  const [mode, setMode] = useState<'single' | 'bulk' | null>(null);
  const [students, setStudents] = useState<NewStudent[]>([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [reading, setReading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const readVersion = useRef(0);
  const create = useAdminMutation<Created, NewStudent>(
    `/admin/institutions/${institutionId}/students`,
  );
  const bulk = useAdminMutation<Created, { students: NewStudent[] }>(
    `/admin/institutions/${institutionId}/students/import`,
  );
  const pending = create.isPending || bulk.isPending;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSuccess('');
    const form = event.currentTarget,
      data = new FormData(form);
    const value = (key: string) => String(data.get(key) ?? '');
    create.mutate(
      {
        externalId: value('externalId'),
        displayName: value('displayName'),
        email: value('email'),
        password: value('password'),
        cohort: value('cohort'),
      },
      {
        onSuccess: () => {
          form.reset();
          create.reset();
          setSuccess('Student added. They can sign in using their student ID and password.');
        },
      },
    );
  }
  function template() {
    const url = URL.createObjectURL(
      new Blob([studentColumns.join(',') + '\r\n'], { type: 'text/csv;charset=utf-8' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'student-import-template.csv';
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="panel form-panel">
      <div className="panel-heading">
        <div>
          <h2>Add students</h2>
          <p>Students added here belong to this institution.</p>
        </div>
      </div>
      <div className="institution-entry-actions">
        <button
          className="button secondary"
          disabled={pending || reading}
          aria-pressed={mode === 'single'}
          onClick={() => {
            setMode('single');
            setSuccess('');
          }}
        >
          Add student
        </button>
        <button
          className="button secondary"
          disabled={pending || reading}
          aria-pressed={mode === 'bulk'}
          onClick={() => {
            setMode('bulk');
            setSuccess('');
          }}
        >
          Upload CSV / Excel
        </button>
      </div>
      {success && (
        <p role="status" className="institution-feedback">
          {success}
        </p>
      )}
      {mode === 'single' && (
        <form onSubmit={submit}>
          <fieldset disabled={pending} className="institution-fields">
            <div className="form-grid">
              <Field label="Student ID" htmlFor="externalId">
                <input id="externalId" name="externalId" required maxLength={128} />
              </Field>
              <Field label="Student name" htmlFor="displayName">
                <input id="displayName" name="displayName" required maxLength={200} />
              </Field>
              <Field label="Student email" htmlFor="studentEmail">
                <input id="studentEmail" name="email" type="email" required maxLength={320} />
              </Field>
              <Field
                label="Password"
                htmlFor="studentPassword"
                hint="At least 12 characters. Share these credentials with the student."
              >
                <input
                  id="studentPassword"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={1024}
                />
              </Field>
              <Field label="Cohort (optional)" htmlFor="cohort">
                <input id="cohort" name="cohort" maxLength={100} />
              </Field>
            </div>
            {create.error && (
              <p className="alert" role="alert">
                {create.error.message}
              </p>
            )}
            <div className="form-actions">
              <button className="button" type="submit">
                {create.isPending ? 'Adding...' : 'Save student'}
              </button>
            </div>
          </fieldset>
        </form>
      )}
      {mode === 'bulk' && (
        <div className="institution-fields">
          <p>
            Upload a CSV or Excel (.xlsx) file, up to 2 MB and 500 students. Excel uses the first
            worksheet. Required columns: externalId, displayName, email, password. Cohort is
            optional. Passwords need at least 12 characters. Format IDs and passwords as text in
            Excel.
          </p>
          <div className="institution-entry-actions">
            <button className="button secondary small" onClick={template}>
              Download CSV template
            </button>
          </div>
          <Field label="Student file" htmlFor="studentFile">
            <input
              ref={fileRef}
              id="studentFile"
              type="file"
              accept=".csv,.xlsx"
              disabled={pending || reading}
              onChange={async (event) => {
                const file = event.target.files?.[0],
                  version = ++readVersion.current;
                setStudents([]);
                setError('');
                setSuccess('');
                bulk.reset();
                if (!file) return;
                setReading(true);
                try {
                  const parsed = await readStudentFile(file);
                  if (readVersion.current === version) setStudents(parsed);
                } catch (failure) {
                  if (readVersion.current === version)
                    setError(
                      failure instanceof Error ? failure.message : 'Unable to read this file.',
                    );
                } finally {
                  if (readVersion.current === version) setReading(false);
                }
              }}
            />
          </Field>
          {reading && <p role="status">Reading student file...</p>}
          {(error || bulk.error) && (
            <p className="alert" role="alert">
              {error || bulk.error?.message}
            </p>
          )}
          {students.length > 0 && (
            <>
              <p>
                {students.length} students ready to import. All rows must pass validation; an error
                adds no students.
              </p>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Student ID</th>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Cohort</th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.slice(0, 10).map((s) => (
                      <tr key={s.externalId}>
                        <td>{s.externalId}</td>
                        <td>{s.displayName}</td>
                        <td>{s.email}</td>
                        <td>{s.cohort || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {students.length > 10 && <p>Showing the first 10 students.</p>}
              <div className="form-actions">
                <button
                  className="button"
                  disabled={pending || reading}
                  onClick={() =>
                    bulk.mutate(
                      { students },
                      {
                        onSuccess: (response) => {
                          setSuccess(
                            `${response.data.createdCount} students added to this institution.`,
                          );
                          setStudents([]);
                          bulk.reset();
                          if (fileRef.current) fileRef.current.value = '';
                        },
                      },
                    )
                  }
                >
                  {bulk.isPending ? 'Importing students...' : `Import ${students.length} students`}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
