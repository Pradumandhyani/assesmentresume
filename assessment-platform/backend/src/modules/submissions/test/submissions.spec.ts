import { validate } from 'class-validator';
import { CreateSubmissionDto } from '../dto/create-submission.dto';
import { idempotencyKey } from '../submissions.service';
describe('submission input boundaries', () => {
  it('allows only the three supported languages and a real question identifier', async () => {
    const valid = Object.assign(new CreateSubmissionDto(), {
      attemptQuestionId: 'b2400000-0000-4000-8000-000000000001',
      language: 'PYTHON',
      sourceCode: 'print(1)',
    });
    expect(await validate(valid)).toHaveLength(0);
    valid.language = 'JAVASCRIPT' as CreateSubmissionDto['language'];
    expect(await validate(valid)).not.toHaveLength(0);
  });
  it('requires stable bounded idempotency keys', () => {
    expect(idempotencyKey('abcdefghijklmnop')).toBe('abcdefghijklmnop');
    for (const value of [undefined, 'short', 'abcdefghijklmnop:unsafe', 'x'.repeat(129)])
      expect(() => idempotencyKey(value)).toThrow();
  });
});
