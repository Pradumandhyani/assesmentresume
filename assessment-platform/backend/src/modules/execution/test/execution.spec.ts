import { cents, decimal, outputMatches, scoreCases, executionRules } from '../grading';
describe('backend fixed-point grading policy', () => {
  it('calculates weighted partial scores exactly and rounds down to cents', () => {
    expect(
      scoreCases(
        '10',
        [
          { weight: '1', passed: true },
          { weight: '2', passed: false },
        ],
        true,
      ),
    ).toBe('3.33');
    expect(
      scoreCases(
        '30',
        [
          { weight: '2.50', passed: true },
          { weight: '2.50', passed: true },
        ],
        true,
      ),
    ).toBe('30.00');
  });
  it('supports all-or-nothing marks', () => {
    expect(
      scoreCases(
        '20',
        [
          { weight: '1', passed: true },
          { weight: '1', passed: false },
        ],
        false,
      ),
    ).toBe('0.00');
    expect(scoreCases('20', [{ weight: '1', passed: true }], false)).toBe('20.00');
  });
  it('rejects invalid or empty grading inputs rather than inventing scores', () => {
    expect(() => scoreCases('10', [], true)).toThrow();
    expect(() => scoreCases('10', [{ weight: '0', passed: true }], true)).toThrow();
    expect(() => cents('1.001')).toThrow();
    expect(decimal(cents('1000000.01'))).toBe('1000000.01');
  });
  it('supports explicit exact and token output adapters', () => {
    expect(outputMatches('1  2\n', '1\t2', 'TOKENS')).toBe(true);
    expect(outputMatches('1\n', '1', 'EXACT')).toBe(false);
    expect(() => outputMatches('a', 'a', 'unknown')).toThrow();
  });
  it('preserves the legacy final-snapshot policy for existing attempts', () => {
    expect(executionRules({})).toMatchObject({
      submissionSelection: 'FINAL_SNAPSHOT',
      hiddenFeedbackImmediate: false,
    });
    expect(executionRules({ submissionSelection: 'LATEST_VALID' }).submissionSelection).toBe(
      'LATEST_VALID',
    );
  });
});
