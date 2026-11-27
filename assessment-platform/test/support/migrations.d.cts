export function applyMigrations(
  database: { exec(sql: string): Promise<unknown> },
  directory?: string,
): Promise<void>;
