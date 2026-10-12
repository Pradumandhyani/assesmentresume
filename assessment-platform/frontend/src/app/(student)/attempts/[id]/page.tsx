import type { Metadata } from 'next';
import { AssessmentWorkspace } from '@/features/attempts/assessment-workspace';
export const metadata: Metadata = { title: 'Coding assessment' };
export default async function AttemptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AssessmentWorkspace attemptId={id} />;
}
