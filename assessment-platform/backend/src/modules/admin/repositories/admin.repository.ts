import type { Prisma } from '../../../database/generated/client';
// Domain writes must receive the caller's transaction; repositories never open nested transactions.
export interface AdminRepositoryContract {
  readonly transaction: Prisma.TransactionClient;
}
