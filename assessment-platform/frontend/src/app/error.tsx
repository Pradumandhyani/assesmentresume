'use client';
import { Button } from '@/components/ui/button';
export default function ApplicationError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="full-error">
      <h1>We couldn&apos;t load your workspace.</h1>
      <p>The service may be temporarily unavailable. Please try again.</p>
      <Button className="primary-button" onClick={reset}>
        Try again
      </Button>
    </main>
  );
}
