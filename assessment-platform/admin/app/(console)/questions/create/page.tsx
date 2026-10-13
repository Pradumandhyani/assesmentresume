import { PageHeading } from '@/components/ui/management';
import { QuestionForm } from '@/features/questions/question-form';
export default function CreateQuestion() {
  return (
    <>
      <PageHeading
        eyebrow="QUESTION BANK"
        title="Create a DSA question"
        description="Draft the problem, starter code, samples, and protected grading cases."
      />
      <QuestionForm />
    </>
  );
}
