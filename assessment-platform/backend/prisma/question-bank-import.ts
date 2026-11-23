import { z } from 'zod';
import type { PrismaClient } from '../src/database/generated/client';
import {
  questionDraftImportInput,
  questionInput,
  type QuestionInput,
} from '../src/modules/admin/dto/management-input';
import { digest } from '../src/modules/admin/repositories/management.repository';
import { TestcaseKeyring, caseAad, caseHash } from '../src/workers/judge/testcase-crypto';
import { ToolchainCatalog } from '../src/workers/sandbox/toolchain-catalog';

const sourceCase = z.object({
  input: z.string(),
  expected_output: z.string(),
  is_hidden: z.boolean(),
});
const sourceQuestion = z.object({
  question_id: z.string().regex(/^[A-Za-z0-9]+$/),
  title: z.string(),
  topic: z.string(),
  subtopic: z.string(),
  difficulty: z.enum(['Easy', 'Medium', 'Hard']),
  problem_statement: z.string(),
  input_format: z.string(),
  output_format: z.string(),
  constraints: z.string(),
  explanation: z.string(),
  test_cases: z.array(sourceCase),
  edge_cases: z.array(sourceCase.extend({ is_hidden: z.boolean().default(true) })).default([]),
});

/** Validate the entire file before writing. Reference solutions never become student templates. */
export function prepareQuestionBank(source: unknown, catalog: ToolchainCatalog): QuestionInput[] {
  return prepareBank(source, catalog);
}

/** Draft content can be reviewed before production runtimes are configured. */
export function prepareQuestionBankDrafts(source: unknown): QuestionInput[] {
  return prepareBank(source);
}

function prepareBank(source: unknown, catalog?: ToolchainCatalog): QuestionInput[] {
  const rows = z.array(sourceQuestion).min(1).parse(source);
  const ids = new Set<string>();
  return rows.map((row) => {
    const slug = `question-bank-${row.question_id.toLowerCase()}`;
    if (ids.has(slug)) throw new Error(`Duplicate question ID: ${row.question_id}`);
    ids.add(slug);
    const testCases = [...row.test_cases, ...row.edge_cases].map((test, index) => ({
      ordinal: index + 1,
      visibility: test.is_hidden ? ('HIDDEN' as const) : ('PUBLIC' as const),
      input: test.input,
      expectedOutput: test.expected_output,
      weight: '1.00',
    }));
    const templates = catalog
      ? (['PYTHON', 'JAVA', 'CPP'] as const).map((language) => {
          const toolchain = [...catalog.entries]
            .reverse()
            .find((entry) => entry.language === language);
          if (!toolchain) throw new Error(`Missing reviewed toolchain: ${language}`);
          return {
            language,
            toolchainId: toolchain.id,
            executionAdapter: { kind: 'STDIO' as const },
            starterCode:
              language === 'PYTHON'
                ? 'import sys\n\ndef solve():\n    # Read standard input and print the answer.\n    pass\n\nif __name__ == "__main__":\n    solve()\n'
                : language === 'JAVA'
                  ? 'import java.io.*;\nimport java.util.*;\n\npublic class Main {\n    public static void main(String[] args) throws Exception {\n        // Read standard input and print the answer.\n    }\n}\n'
                  : '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n    // Read standard input and print the answer.\n    return 0;\n}\n',
          };
        })
      : [];
    try {
      return (catalog ? questionInput : questionDraftImportInput).parse({
        slug,
        title: row.title,
        difficulty: row.difficulty.toUpperCase(),
        topics: [row.topic],
        tags: ['question-bank', row.question_id.toLowerCase(), row.subtopic],
        statement: row.problem_statement,
        inputFormat: row.input_format,
        outputFormat: row.output_format,
        constraints: row.constraints,
        explanation: row.explanation,
        publicExamples: testCases
          .filter((test) => test.visibility === 'PUBLIC')
          .map((test) => ({
            ordinal: test.ordinal,
            input: test.input,
            expectedOutput: test.expectedOutput,
          })),
        maxScore:
          row.difficulty === 'Easy' ? '10.00' : row.difficulty === 'Medium' ? '20.00' : '30.00',
        cpuTimeMs: 2000,
        wallTimeMs: 5000,
        memoryLimitKiB: 262144,
        outputLimitBytes: 65536,
        processLimit: 32,
        outputComparison: 'TOKENS',
        templates,
        testCases,
      });
    } catch (error) {
      throw new Error(`Invalid question ${row.question_id}`, { cause: error });
    }
  });
}

/** Reruns preserve deletions and create a new version only when imported content changes. */
export async function importQuestionBank(
  db: PrismaClient,
  questions: QuestionInput[],
  keys: TestcaseKeyring,
  createdById: string,
) {
  const counts = { created: 0, updated: 0, unchanged: 0, archived: 0 };
  for (const input of questions) {
    const result = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.slug})::bigint)`;
      const existing = await tx.question.findUnique({
        where: { slug: input.slug },
        include: {
          versions: { orderBy: { version: 'desc' }, select: { version: true, contentHash: true } },
        },
      });
      if (existing?.archivedAt) return 'archived';
      const contentHash = digest(input);
      // Preserve administrator edits/drafts when the source revision was already imported.
      if (existing?.versions.some((version) => version.contentHash === contentHash))
        return 'unchanged';
      const question = existing ?? (await tx.question.create({ data: { slug: input.slug } }));
      await tx.questionTopic.deleteMany({ where: { questionId: question.id } });
      await tx.questionTopic.createMany({
        data: input.topics.map((topic) => ({ questionId: question.id, topic })),
      });
      const { templates, testCases } = input;
      const version = await tx.questionVersion.create({
        data: {
          title: input.title,
          difficulty: input.difficulty,
          statement: input.statement,
          inputFormat: input.inputFormat,
          outputFormat: input.outputFormat,
          constraints: input.constraints,
          explanation: input.explanation,
          tags: input.tags,
          publicExamples: input.publicExamples,
          maxScore: input.maxScore,
          cpuTimeMs: input.cpuTimeMs,
          wallTimeMs: input.wallTimeMs,
          memoryLimitKiB: input.memoryLimitKiB,
          outputLimitBytes: input.outputLimitBytes,
          processLimit: input.processLimit,
          outputComparison: input.outputComparison,
          questionId: question.id,
          createdById,
          version: (existing?.versions[0]?.version ?? 0) + 1,
          topicSnapshot: input.topics,
          templates: {
            create: templates.map((template) => ({
              ...template,
              executionAdapter: template.executionAdapter ?? { kind: 'STDIO' },
            })),
          },
        },
      });
      await tx.testCase.createMany({
        data: testCases.map((test) => {
          const keyId = keys.id(test.visibility);
          return {
            questionVersionId: version.id,
            ordinal: test.ordinal,
            visibility: test.visibility,
            weight: test.weight,
            encryptionKeyId: keyId,
            integrityHash: caseHash(test.input, test.expectedOutput),
            inputCiphertext: keys.encrypt(
              test.input,
              keyId,
              test.visibility,
              caseAad(version.id, test.ordinal, test.visibility, 'input'),
            ),
            expectedOutputCiphertext: keys.encrypt(
              test.expectedOutput,
              keyId,
              test.visibility,
              caseAad(version.id, test.ordinal, test.visibility, 'expected'),
            ),
          };
        }),
      });
      await tx.questionVersion.update({
        where: { id: version.id },
        data: { status: 'PUBLISHED', publishedAt: new Date(), contentHash },
      });
      return existing ? 'updated' : 'created';
    });
    counts[result]++;
  }
  return counts;
}
