import type { CanActivate } from '@nestjs/common';
// No permissive placeholder guard is registered. Later implementation must fail closed.
export type SessionGuardContract = CanActivate;
