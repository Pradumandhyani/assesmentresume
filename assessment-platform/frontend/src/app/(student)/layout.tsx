import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { serverSession } from '@/services/server-session';
import { ApiError } from '@/services/api-client';
export const dynamic = 'force-dynamic';
export default async function StudentLayout({ children }: { children: ReactNode }) {
  try {
    const session = await serverSession();
    if (session.data.user.role !== 'STUDENT' || !session.data.student) redirect('/login');
  } catch (error) {
    if (error instanceof ApiError && [401, 403].includes(error.status)) redirect('/login');
    throw error;
  }
  return children;
}
