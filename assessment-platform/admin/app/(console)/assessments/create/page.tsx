import { PageHeading } from '@/components/ui/management';
import { AssessmentForm } from '@/features/assessments/assessment-form';
export default function CreateAssessment() {
  return (
    <>
      <PageHeading
        eyebrow="ASSESSMENTS"
        title="Create an assessment"
        description="Start with a draft. Review the schedule and question pool before publishing."
      />
      <AssessmentForm />
    </>
  );
}
