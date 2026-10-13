import type { Request } from 'express';
import type { ApiRequest } from '../../common/http/api-response';
export interface AuthIdentity {
  sessionId: string;
  tokenHash: string;
  csrfTokenHash: string;
  expiresAt: Date;
  user: { id: string; role: 'STUDENT' | 'ADMIN'; authVersion: number };
  student: { id: string; externalId: string; displayName: string } | null;
  admin?: { id: string; displayName: string; email: string } | null;
}
export type AuthRequest = ApiRequest & Request & { identity?: AuthIdentity };
