import type { components } from '../../../../contracts/generated/api';
export type ApiErrorContract = components['schemas']['ApiError'];
// Implement a centralized exception filter in a later step; never pass raw SQL/Prisma/judge errors to clients.
