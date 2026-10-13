import { ResultList } from '@/features/results/result-list';
export default async function ResultsPage({
  searchParams,
}: {
  searchParams: Promise<{ assessmentId?: string }>;
}) {
  const params = await searchParams;
  return <ResultList initialAssessmentId={params.assessmentId ?? ''} />;
}
