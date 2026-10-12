import { randomInt } from 'node:crypto';
export function shuffle<T>(values: readonly T[]): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}
export function allocate<T extends { difficulty: string }>(pool: readonly T[]): T[] {
  const selected: T[] = [];
  for (const [difficulty, count] of [
    ['EASY', 2],
    ['MEDIUM', 1],
    ['HARD', 1],
  ] as const) {
    const bucket = pool.filter((q) => q.difficulty === difficulty);
    if (bucket.length < count) throw new Error('Insufficient frozen question pool');
    selected.push(...shuffle(bucket).slice(0, count));
  }
  return shuffle(selected);
}
