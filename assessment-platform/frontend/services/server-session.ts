import 'server-only';
import { cookies } from 'next/headers';
import { apiRequest, type ApiSuccess } from './api-client';
export async function serverSession(): Promise<ApiSuccess<'getMe'>> {
  return apiRequest<ApiSuccess<'getMe'>>(
    `${process.env.BACKEND_API_URL ?? 'http://127.0.0.1:4000'}/api/v1/auth/me`,
    { headers: { Cookie: (await cookies()).toString() } },
  );
}
