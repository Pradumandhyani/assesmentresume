export interface OutboxWorkerContract {
  dispatchBatch(limit: number): Promise<number>;
}
// Later implementation claims PostgreSQL rows with FOR UPDATE SKIP LOCKED.
