import { validate } from 'class-validator';
import { SaveDraftDto, SelectLanguageDto } from '../dto/attempt-input.dto';
describe('attempt mutation input boundaries', () => {
  it('rejects negative revisions and oversized source text', async () => {
    const input = Object.assign(new SaveDraftDto(), {
      sourceCode: 'a'.repeat(65537),
      expectedRevision: -1,
    });
    expect((await validate(input)).map((e) => e.property).sort()).toEqual([
      'expectedRevision',
      'sourceCode',
    ]);
  });
  it('rejects unsupported programming languages', async () => {
    const input = Object.assign(new SelectLanguageDto(), {
      language: 'JAVASCRIPT',
      expectedStateVersion: 1,
    });
    expect((await validate(input)).map((e) => e.property)).toEqual(['language']);
  });
  it('accepts empty code as a real draft with revision zero', async () => {
    expect(
      await validate(Object.assign(new SaveDraftDto(), { sourceCode: '', expectedRevision: 0 })),
    ).toHaveLength(0);
  });
});
