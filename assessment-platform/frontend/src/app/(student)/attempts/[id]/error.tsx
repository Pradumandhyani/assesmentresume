'use client';
import Link from 'next/link';
export default function AttemptError({ reset }: { reset: () => void }) {
  return (
    <div className="workspace-empty" role="alert">
      <h1>We couldn’t open the workspace</h1>
      <p>Your saved code and deadline remain on the server.</p>
      <button className="primary-button" onClick={reset}>
        Try again
      </button>
      <Link href="/dashboard">Back to dashboard</Link>
    </div>
  );
}
