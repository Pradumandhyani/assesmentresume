'use client';
import Link from 'next/link';
import { useAdminQuery } from '@/hooks/use-admin';
import type { Institution } from '@/types/admin';
import { ErrorState, LoadingState, PageHeading } from '@/components/ui/management';
import { StudentList } from '@/features/students/student-list';
import { StudentEntry } from './student-entry';

export function InstitutionDetail({ id }: { id: string }) {
  const query = useAdminQuery<Institution>(`/admin/institutions/${id}`);
  if (query.isPending) return <LoadingState />;
  if (query.isError) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const institution = query.data.data;
  return (
    <>
      <PageHeading
        eyebrow="INSTITUTION"
        title={institution.name}
        description={`Institution ID: ${institution.institutionId} · ${institution.studentCount} students`}
        action={
          <Link className="button secondary" href="/institutions">
            All institutions
          </Link>
        }
      />
      <Link className="button" href={`/assessments/create?institutionId=${id}`}>
        Create assessment for this institution
      </Link>
      <div className="panel institution-details">
        <dl>
          <div>
            <dt>Main faculty / contact person</dt>
            <dd>{institution.mainFaculty}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{institution.email}</dd>
          </div>
          <div>
            <dt>Phone</dt>
            <dd>{institution.phone}</dd>
          </div>
          {institution.address && (
            <div>
              <dt>Address</dt>
              <dd>{institution.address}</dd>
            </div>
          )}
        </dl>
      </div>
      <StudentEntry institutionId={id} />
      <StudentList key={id} institutionId={id} />
    </>
  );
}
