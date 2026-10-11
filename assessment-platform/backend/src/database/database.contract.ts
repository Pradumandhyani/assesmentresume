import type { Prisma } from './generated/client';
export interface DatabaseUnitOfWork {
  serializable<T>(work: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T>;
}
// Runtime adapter: PrismaPg with explicit max=DATABASE_POOL_MAX; no connection is opened here.
