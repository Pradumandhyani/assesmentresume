'use client';
import { ErrorState } from '@/components/ui/management';
export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="page-content">
      <ErrorState error={error} retry={reset} />
    </main>
  );
}
