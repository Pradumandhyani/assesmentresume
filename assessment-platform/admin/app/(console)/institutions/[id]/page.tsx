import { InstitutionDetail } from '@/features/institutions/institution-detail';
export default async function InstitutionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InstitutionDetail key={id} id={id} />;
}
