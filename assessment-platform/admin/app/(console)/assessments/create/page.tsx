import { PageHeading } from '@/components/ui/management';
import { AssessmentForm } from '@/features/assessments/assessment-form';
export default async function CreateAssessment({
  searchParams,
}: {
  searchParams: Promise<{ institutionId?: string }>;
}) {
  const { institutionId } = await searchParams;
  return (
    <>
      <PageHeading
        eyebrow="ASSESSMENTS"
        title="Create an assessment"
        description="Start with a draft. Review the schedule and question pool before publishing."
      />
      <AssessmentForm institutionId={institutionId} />
    </>
  );
}
