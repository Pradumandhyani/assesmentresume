'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useAdminMutation, useAdminQuery } from '@/hooks/use-admin';
import { queryString } from '@/services/api-client';
import type { EntityMutation, Institution, Page } from '@/types/admin';
import {
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  PageHeading,
  Pagination,
} from '@/components/ui/management';

type InstitutionInput = Omit<Institution, 'id' | 'studentCount' | 'address'> & { address: string };
export function InstitutionList() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const query = useAdminQuery<Page<Institution>>(
    `/admin/institutions${queryString({ page, pageSize: 20, search })}`,
  );
  const create = useAdminMutation<EntityMutation, InstitutionInput>('/admin/institutions');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const value = (key: string) => String(data.get(key) ?? '').trim();
    create.mutate(
      {
        institutionId: value('institutionId'),
        name: value('name'),
        mainFaculty: value('mainFaculty'),
        email: value('email'),
        phone: value('phone'),
        address: value('address'),
      },
      {
        onSuccess: (response) => router.push(`/institutions/${response.data.id}`),
      },
    );
  }
  return (
    <>
      <PageHeading
        eyebrow="PEOPLE"
        title="Institutions"
        description="Create an institution, then open it to add students individually or upload a student file."
        action={
          <button
            className="button"
            onClick={() => {
              create.reset();
              setCreating(!creating);
            }}
          >
            {creating ? 'Close form' : 'Add institution'}
          </button>
        }
      />
      {creating && (
        <form className="panel form-panel" onSubmit={submit}>
          <div className="panel-heading">
            <h2>Institution details</h2>
          </div>
          <fieldset disabled={create.isPending} className="institution-fields">
            <div className="form-grid">
              <Field label="Institution ID" htmlFor="institutionId">
                <input id="institutionId" name="institutionId" required maxLength={128} />
              </Field>
              <Field label="Institution name" htmlFor="name">
                <input id="name" name="name" required maxLength={200} />
              </Field>
              <Field label="Main faculty / contact person" htmlFor="mainFaculty">
                <input id="mainFaculty" name="mainFaculty" required maxLength={200} />
              </Field>
              <Field label="Email" htmlFor="email">
                <input id="email" name="email" type="email" required maxLength={320} />
              </Field>
              <Field label="Phone" htmlFor="phone">
                <input id="phone" name="phone" type="tel" required maxLength={40} />
              </Field>
              <Field label="Address (optional)" htmlFor="address">
                <textarea id="address" name="address" maxLength={1000} />
              </Field>
            </div>
            {create.error && (
              <p className="alert" role="alert">
                {create.error.message}
              </p>
            )}
            <div className="form-actions">
              <button className="button" type="submit">
                {create.isPending ? 'Saving...' : 'Save institution'}
              </button>
            </div>
          </fieldset>
        </form>
      )}
      <div className="panel">
        <div className="table-toolbar">
          <input
            aria-label="Search institutions"
            placeholder="Search institution ID, name or faculty"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
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
            title="No institutions found"
            description="Add an institution before adding its students."
          />
        ) : (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Institution</th>
                    <th>Institution ID</th>
                    <th>Main faculty</th>
                    <th>Contact</th>
                    <th>Students</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.data.items.map((institution) => (
                    <tr key={institution.id}>
                      <td>
                        <Link href={`/institutions/${institution.id}`}>{institution.name}</Link>
                      </td>
                      <td className="mono">{institution.institutionId}</td>
                      <td>{institution.mainFaculty}</td>
                      <td>
                        {institution.email}
                        <br />
                        {institution.phone}
                      </td>
                      <td>{institution.studentCount}</td>
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
    </>
  );
}
