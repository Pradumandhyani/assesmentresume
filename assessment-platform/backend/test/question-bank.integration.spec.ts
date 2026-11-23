import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  prepareQuestionBank,
  prepareQuestionBankDrafts,
  importQuestionBank,
} from '../prisma/question-bank-import';
import {
  importProductionQuestionDrafts,
  configureImportedDraftToolchains,
} from '../prisma/production-question-bank';
import { questionInput } from '../src/modules/admin/dto/management-input';
import { AssessmentManagementService } from '../src/modules/admin/assessment-management.service';
import { QuestionManagementService } from '../src/modules/admin/question-management.service';
import type { AuthIdentity } from '../src/modules/auth/auth.types';
import { caseAad } from '../src/workers/judge/testcase-crypto';
import { contractCatalog, step4Context, testKeyring } from './support/step4-context';

jest.setTimeout(60000);
describe('JSON question bank import, full assessment pools and deletion', () => {
  const catalog = contractCatalog();
  const keys = testKeyring();
  const source = JSON.parse(
    readFileSync(resolve(__dirname, '../../../Questions/question_bank.json'), 'utf8'),
  );
  const prepared = prepareQuestionBank(source, catalog);
  let context: Awaited<ReturnType<typeof step4Context>>;
  let identity: AuthIdentity;
  let adminId: string;
  beforeAll(async () => {
    context = await step4Context(catalog, keys, { admin: true });
    const student = await context.prisma.user.findFirstOrThrow({ where: { role: 'STUDENT' } });
    const user = await context.prisma.user.create({
      data: {
        email: 'bank-admin@test.invalid',
        passwordHash: student.passwordHash,
        role: 'ADMIN',
        admin: { create: { displayName: 'Bank administrator' } },
      },
      include: { admin: true },
    });
    adminId = user.admin!.id;
    identity = {
      sessionId: randomUUID(),
      tokenHash: '',
      csrfTokenHash: '',
      expiresAt: new Date(Date.now() + 3600000),
      user: { id: user.id, role: 'ADMIN', authVersion: user.authVersion },
      student: null,
      admin: { id: adminId, displayName: user.admin!.displayName, email: user.email },
    };
  });
  afterAll(async () => {
    await context?.close();
  });

  it('validates all source questions and keeps solutions and hidden cases out of public content', () => {
    expect(prepared).toHaveLength(source.length);
    expect(prepared.length).toBeGreaterThan(400);
    for (const input of prepared) {
      expect(input.templates).toHaveLength(3);
      expect(
        input.templates.every((template) => !template.starterCode.includes('reference_solution')),
      ).toBe(true);
      expect(
        input.publicExamples.every((example) =>
          input.testCases.some(
            (test) => test.ordinal === example.ordinal && test.visibility === 'PUBLIC',
          ),
        ),
      ).toBe(true);
    }
    expect(() => prepareQuestionBank([source[0], source[0]], catalog)).toThrow(
      'Duplicate question ID',
    );
    expect(() =>
      prepareQuestionBank([{ ...source[0], test_cases: [], edge_cases: [] }], catalog),
    ).toThrow('Invalid question');
  });

  it('imports more than one page, encrypts edge cases and preserves versions on rerun', async () => {
    const selected = prepared.slice(0, 25);
    expect(await importQuestionBank(context.prisma, selected, keys, adminId)).toMatchObject({
      created: 25,
    });
    expect(await importQuestionBank(context.prisma, selected, keys, adminId)).toMatchObject({
      unchanged: 25,
      created: 0,
    });
    const question = await context.prisma.question.findUniqueOrThrow({
      where: { slug: selected[0]!.slug },
      include: { versions: true },
    });
    const version = question.versions[0]!;
    const tests = await context.prisma.testCase.findMany({
      where: { questionVersionId: version.id },
      orderBy: { ordinal: 'asc' },
    });
    expect(tests).toHaveLength(selected[0]!.testCases.length);
    const hidden = tests.find((test) => test.visibility === 'HIDDEN')!;
    expect(
      keys.decrypt(
        hidden.inputCiphertext,
        hidden.encryptionKeyId,
        'HIDDEN',
        caseAad(version.id, hidden.ordinal, 'HIDDEN', 'input'),
      ),
    ).toBe(selected[0]!.testCases.find((test) => test.ordinal === hidden.ordinal)!.input);
    expect(
      await importQuestionBank(
        context.prisma,
        [{ ...selected[0]!, title: 'Updated imported title' }],
        keys,
        adminId,
      ),
    ).toMatchObject({ updated: 1 });
    expect(
      (await context.prisma.questionVersion.findUniqueOrThrow({ where: { id: version.id } })).title,
    ).toBe(selected[0]!.title);
    await context.app.get(QuestionManagementService).draft(identity, question.id, randomUUID(), 1);
    expect(
      await importQuestionBank(
        context.prisma,
        [{ ...selected[0]!, title: 'Updated imported title' }],
        keys,
        adminId,
      ),
    ).toMatchObject({ unchanged: 1 });
    expect(
      (
        await context.prisma.questionVersion.findFirstOrThrow({
          where: { questionId: question.id },
          orderBy: { version: 'desc' },
        })
      ).status,
    ).toBe('DRAFT');
  });

  it('saves the complete compatible pool across pages and keeps deleted questions out of new pools', async () => {
    const service = context.app.get(QuestionManagementService);
    const question = await context.prisma.question.findUniqueOrThrow({
      where: { slug: prepared[1]!.slug },
    });
    const deleted = await service.remove(identity, question.id, randomUUID(), 1);
    expect(deleted.deleted).toBe(true);
    expect(await importQuestionBank(context.prisma, [prepared[1]!], keys, adminId)).toMatchObject({
      archived: 1,
    });
    const bank = await service.list({ page: 1, pageSize: 20 });
    expect(bank.total).toBeGreaterThan(20);
    expect(bank.items.some((item) => item.id === question.id)).toBe(false);
    const now = await context.prisma.now();
    const assessments = context.app.get(AssessmentManagementService);
    const created = await assessments.create(identity, randomUUID(), {
      title: 'Complete bank round',
      description: '',
      opensAt: now.toISOString(),
      latestStartAt: new Date(now.getTime() + 60000).toISOString(),
      closesAt: new Date(now.getTime() + 14400000).toISOString(),
      resultsReleaseAt: new Date(now.getTime() + 14400000).toISOString(),
      questionVersionIds: [],
      poolSelection: 'ALL_PUBLISHED',
      rule: {
        durationSeconds: 10800,
        easyCount: 2,
        mediumCount: 1,
        hardCount: 1,
        allowedLanguages: ['PYTHON', 'JAVA', 'CPP'],
        allowedTopics: [],
        marks: { EASY: '10', MEDIUM: '20', HARD: '30' },
        submissionSelection: 'BEST_VALID',
        partialScoring: true,
        hiddenFeedbackImmediate: false,
      },
    });
    const detail = await assessments.detail(created.id);
    expect(detail.pool.length).toBeGreaterThan(20);
    expect(new Set(detail.pool.map((item) => item.questionId)).size).toBe(detail.pool.length);
    expect(detail.pool.some((item) => item.questionId === question.id)).toBe(false);
    const first = detail.pool[0]!;
    await service.remove(identity, first.questionId, randomUUID(), 1);
    expect((await assessments.detail(created.id)).pool.some((item) => item.id === first.id)).toBe(
      true,
    );
    expect(
      await context.prisma.questionVersion.findUnique({ where: { id: first.id } }),
    ).not.toBeNull();
  });

  it('imports production drafts without fabricated toolchains and preserves edits/deletions on rerun', async () => {
    const drafts = prepareQuestionBankDrafts(source);
    expect(drafts).toHaveLength(source.length);
    expect(drafts.every((question) => question.templates.length === 0)).toBe(true);
    expect(questionInput.safeParse(drafts[0]).success).toBe(false);
    const entries = drafts
      .slice(0, 3)
      .map((question) => ({ ...question, slug: `production-${question.slug}` }));
    await context.database.exec(
      readFileSync(resolve(__dirname, '../prisma/runtime-grants.sql'), 'utf8'),
    );
    await context.database.exec('SET ROLE assessment_admin');
    try {
      expect(await importProductionQuestionDrafts(context.prisma, entries, keys)).toMatchObject({
        created: 3,
        status: 'DRAFT',
      });
      expect(await importProductionQuestionDrafts(context.prisma, entries, keys)).toMatchObject({
        created: 0,
        preserved: 3,
      });
    } finally {
      await context.database.exec('RESET ROLE');
    }
    const question = await context.prisma.question.findUniqueOrThrow({
      where: { slug: entries[0]!.slug },
      include: { versions: { include: { templates: true, testCases: true } } },
    });
    expect(question.versions[0]!.status).toBe('DRAFT');
    expect(question.versions[0]!.templates).toHaveLength(0);
    expect(question.versions[0]!.testCases).toHaveLength(entries[0]!.testCases.length);
    const service = context.app.get(QuestionManagementService);
    await expect(service.publish(identity, question.id, randomUUID(), 1)).rejects.toMatchObject({
      status: 422,
    });
    await context.prisma.questionVersion.update({
      where: { id: question.versions[0]!.id },
      data: { title: 'Administrator edited this draft' },
    });
    await service.remove(identity, question.id, randomUUID(), 1);
    expect(await importProductionQuestionDrafts(context.prisma, entries, keys)).toMatchObject({
      created: 0,
      preserved: 3,
    });
    expect(
      (await context.prisma.question.findUniqueOrThrow({ where: { id: question.id } })).archivedAt,
    ).not.toBeNull();
    expect(
      (
        await context.prisma.questionVersion.findUniqueOrThrow({
          where: { id: question.versions[0]!.id },
        })
      ).title,
    ).toBe('Administrator edited this draft');
  });

  it('rolls back the entire production batch if testcase encryption fails', async () => {
    const entries = prepareQuestionBankDrafts(source.slice(0, 2)).map((entry) => ({
      ...entry,
      slug: `failed-${entry.slug}`,
    }));
    const encryption = jest.spyOn(keys, 'encrypt').mockImplementationOnce(() => {
      throw new Error('Simulated encryption failure');
    });
    try {
      await expect(importProductionQuestionDrafts(context.prisma, entries, keys)).rejects.toThrow(
        'Simulated encryption failure',
      );
    } finally {
      encryption.mockRestore();
    }
    expect(
      await context.prisma.question.count({
        where: { slug: { in: entries.map((entry) => entry.slug) } },
      }),
    ).toBe(0);
  });

  it('pins imported drafts without rewriting encrypted cases or edited/archived content, then validates and publishes them', async () => {
    const drafts = prepareQuestionBankDrafts(source.slice(0, 3)).map((entry) => ({
      ...entry,
      slug: `pin-${entry.slug}`,
    }));
    const configured = prepareQuestionBank(source.slice(0, 3), catalog).map((entry) => ({
      ...entry,
      slug: `pin-${entry.slug}`,
    }));
    await importProductionQuestionDrafts(context.prisma, drafts, keys);
    const before = await context.prisma.questionVersion.findMany({
      where: { question: { slug: { in: drafts.map((entry) => entry.slug) } } },
      include: { question: true, testCases: true },
    });
    await context.prisma.questionVersion.update({
      where: { id: before.find((v) => v.question.slug === drafts[1]!.slug)!.id },
      data: { title: 'Edited by admin', revision: { increment: 1 } },
    });
    await context.prisma.question.update({
      where: { slug: drafts[2]!.slug },
      data: { archivedAt: new Date() },
    });
    expect(await configureImportedDraftToolchains(context.prisma, configured)).toMatchObject({
      eligible: 1,
      configured: 0,
      preserved: 2,
    });
    expect(
      await context.prisma.questionTemplate.count({
        where: { questionVersionId: { in: before.map((v) => v.id) } },
      }),
    ).toBe(0);
    await context.database.exec('SET ROLE assessment_admin');
    try {
      expect(
        await configureImportedDraftToolchains(context.prisma, configured, true),
      ).toMatchObject({ configured: 1, preserved: 2, status: 'DRAFT' });
    } finally {
      await context.database.exec('RESET ROLE');
    }
    expect(await configureImportedDraftToolchains(context.prisma, configured, true)).toMatchObject({
      configured: 0,
    });
    const version = await context.prisma.questionVersion.findUniqueOrThrow({
      where: { id: before.find((v) => v.question.slug === drafts[0]!.slug)!.id },
      include: { testCases: { orderBy: { ordinal: 'asc' } }, templates: true },
    });
    expect(version.templates).toHaveLength(3);
    expect(version.revision).toBe(2);
    expect(
      version.testCases.map((c) => ({
        ordinal: c.ordinal,
        input: Buffer.from(c.inputCiphertext).toString('hex'),
        output: Buffer.from(c.expectedOutputCiphertext).toString('hex'),
      })),
    ).toEqual(
      before
        .find((v) => v.id === version.id)!
        .testCases.sort((a, b) => a.ordinal - b.ordinal)
        .map((c) => ({
          ordinal: c.ordinal,
          input: Buffer.from(c.inputCiphertext).toString('hex'),
          output: Buffer.from(c.expectedOutputCiphertext).toString('hex'),
        })),
    );
    const service = context.app.get(QuestionManagementService);
    expect(await service.validate(identity, version.questionId, 2)).toMatchObject({
      valid: true,
      executionValidated: false,
    });
    await expect(
      service.publish(identity, version.questionId, randomUUID(), 1),
    ).rejects.toMatchObject({ status: 409 });
    expect(await service.publish(identity, version.questionId, randomUUID(), 2)).toMatchObject({
      status: 'PUBLISHED',
    });
    await expect(
      service.publish(
        identity,
        before.find((v) => v.question.slug === drafts[2]!.slug)!.questionId,
        randomUUID(),
        1,
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
});
