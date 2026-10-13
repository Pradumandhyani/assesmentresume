'use client';
import { ErrorState } from '@/components/ui/management';
export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  return <ErrorState error={error} retry={reset} />;
}
