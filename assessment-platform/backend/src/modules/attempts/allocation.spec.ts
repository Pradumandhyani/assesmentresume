import { allocate } from './allocation';
describe('stratified immutable allocation selection', () => {
  const pool = ['EASY', 'EASY', 'EASY', 'MEDIUM', 'MEDIUM', 'HARD'].map((difficulty, id) => ({
    id,
    difficulty,
  }));
  it('selects four distinct identities in the fixed difficulty proportions', () => {
    for (let i = 0; i < 30; i++) {
      const selected = allocate(pool);
      expect(new Set(selected.map((q) => q.id)).size).toBe(4);
      expect(selected.filter((q) => q.difficulty === 'EASY')).toHaveLength(2);
    }
    expect(pool).toHaveLength(6);
  });
  it('fails atomically for an insufficient frozen pool', () => {
    expect(() => allocate(pool.filter((q) => q.difficulty !== 'HARD'))).toThrow('Insufficient');
  });
  it('samples different sets independently from a larger bank while respecting custom counts', () => {
    const bank = ['EASY', 'MEDIUM', 'HARD'].flatMap((difficulty) =>
      Array.from({ length: 30 }, (_, id) => ({ id: `${difficulty}-${id}`, difficulty })),
    );
    const sets = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const questions = allocate(bank, { easyCount: 3, mediumCount: 2, hardCount: 1 });
      expect(questions.filter((q) => q.difficulty === 'EASY')).toHaveLength(3);
      expect(questions.filter((q) => q.difficulty === 'MEDIUM')).toHaveLength(2);
      expect(questions.filter((q) => q.difficulty === 'HARD')).toHaveLength(1);
      sets.add(
        questions
          .map((q) => q.id)
          .sort()
          .join(','),
      );
    }
    expect(sets.size).toBeGreaterThan(1);
  });
});
