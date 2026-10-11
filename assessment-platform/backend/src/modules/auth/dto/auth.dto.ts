import type { components } from '../../../../../contracts/generated/api';
export type LoginRequest = components['schemas']['LoginRequest'];
export type SessionResponse = components['schemas']['SessionResponse'];
export type CsrfResponse = components['schemas']['CsrfResponse'];
// Compile-time types only. Runtime DTO validation is an explicit later-step requirement.
