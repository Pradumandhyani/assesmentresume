import { QuestionDetailPage } from '@/features/questions/question-detail';
export default async function EditQuestion({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <QuestionDetailPage id={id} />;
}
