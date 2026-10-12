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
});
