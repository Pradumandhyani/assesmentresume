import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../src/config/environment';
import type { PrismaService } from '../src/database/prisma.service';
import { AuthService } from '../src/modules/auth/auth.service';
import type { AuthRepository } from '../src/modules/auth/repositories/auth.repository';
import type { PasswordService } from '../src/modules/auth/password.service';
import type { AuthSecurity } from '../src/modules/auth/auth.security';
import type { AuthRequest } from '../src/modules/auth/auth.types';

describe('authenticated identities remain bound to their stored role', () => {
  it.each(['STUDENT', 'ADMIN'] as const)(
    'exposes only the %s profile even if a legacy identity has both relations',
    async (role) => {
      const now = new Date('2026-10-13T12:00:00Z');
      const repo = {
        findSession: jest.fn().mockResolvedValue({
          now,
          session: {
            id: 'session',
            tokenHash: 'hash',
            csrfTokenHash: 'csrf-hash',
            expiresAt: new Date(now.getTime() + 3600000),
            user: {
              id: 'user',
              role,
              authVersion: 1,
              email: 'admin@example.invalid',
              student: { id: 'student', externalId: 'STUDENT-1', displayName: 'Student Name' },
              admin: { id: 'admin', displayName: 'Administrator Name' },
            },
          },
        }),
      };
      const service = new AuthService(
        repo as unknown as AuthRepository,
        {} as PasswordService,
        { readToken: () => 'test-session-token' } as unknown as AuthSecurity,
        {} as ConfigService<Environment, true>,
        {} as PrismaService,
      );
      const identity = await service.identify({} as AuthRequest);
      expect(identity?.user.role).toBe(role);
      if (role === 'ADMIN') {
        expect(identity?.student).toBeNull();
        expect(service.profile(identity!).user.displayName).toBe('Administrator Name');
      } else {
        expect(identity?.admin).toBeNull();
        expect(service.profile(identity!).user.displayName).toBe('Student Name');
      }
    },
  );
});
