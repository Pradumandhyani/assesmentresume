import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { ApiError } from '@/services/api-client';
import { serverSession } from '@/services/server-session';
import { AdminShell } from '@/components/admin-shell';
export const dynamic = 'force-dynamic';
export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  let session;
  try {
    session = await serverSession();
  } catch (error) {
    if (error instanceof ApiError && [401, 403].includes(error.status)) redirect('/login');
    throw error;
  }
  if (session.data.user.role !== 'ADMIN') redirect('/login');
  return <AdminShell initialSession={session}>{children}</AdminShell>;
}
