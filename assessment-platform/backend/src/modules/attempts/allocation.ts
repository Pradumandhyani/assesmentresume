import { randomInt } from 'node:crypto';
export function shuffle<T>(values: readonly T[]): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}
export function allocate<T extends { difficulty: string }>(
  pool: readonly T[],
  rule = { easyCount: 2, mediumCount: 1, hardCount: 1 },
): T[] {
  const selected: T[] = [];
  for (const [difficulty, count] of [
    ['EASY', rule.easyCount],
    ['MEDIUM', rule.mediumCount],
    ['HARD', rule.hardCount],
  ] as const) {
    const bucket = pool.filter((q) => q.difficulty === difficulty);
    if (bucket.length < count) throw new Error('Insufficient frozen question pool');
    selected.push(...shuffle(bucket).slice(0, count));
  }
  return shuffle(selected);
}
