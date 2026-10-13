import 'server-only';
import { cookies } from 'next/headers';
import { request } from './api-client';
import type { Session } from '@/types/admin';
export function serverSession() {
  return cookies().then((cookieStore) =>
    request<Session>(`${process.env.BACKEND_API_URL ?? 'http://127.0.0.1:4000'}/api/v1/auth/me`, {
      headers: { Cookie: cookieStore.toString() },
    }),
  );
}
