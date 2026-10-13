import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiException } from '../../common/http/api-error';
import type { Environment } from '../../config/environment';
import { Prisma } from '../../database/generated/client';
import { TestcaseKeyring, caseAad, caseHash } from '../../workers/judge/testcase-crypto';
import { ToolchainCatalog } from '../../workers/sandbox/toolchain-catalog';
import type { AuthIdentity } from '../auth/auth.types';
import { type QuestionInput, type PageInput } from './dto/management-input';
import {
  ManagementRepository,
  missing,
  immutable,
  conflict,
  digest,
} from './repositories/management.repository';

@Injectable()
export class QuestionAuthoringSecurity {
  private loadedKeys?: TestcaseKeyring;
  private loadedCatalog?: ToolchainCatalog;
  constructor(private readonly config: ConfigService<Environment, true>) {}
  available() {
    return (
      !!this.config.get('QUESTION_KEYRING_FILE', { infer: true }) &&
      !!this.config.get('SANDBOX_TOOLCHAIN_CATALOG', { infer: true })
    );
  }
  keys() {
    try {
      return (this.loadedKeys ??= TestcaseKeyring.fromFile(
        this.config.get('QUESTION_KEYRING_FILE', { infer: true })!,
        this.config.get('NODE_ENV', { infer: true }) === 'production',
        ['PUBLIC', 'HIDDEN'],
      ));
    } catch {
      throw new ApiException(503, 'SERVICE_UNAVAILABLE', 'Question encryption is not configured.');
    }
  }
  catalog() {
    try {
      return (this.loadedCatalog ??= ToolchainCatalog.fromFile(
        this.config.get('SANDBOX_TOOLCHAIN_CATALOG', { infer: true })!,
      ));
    } catch {
      throw new ApiException(503, 'SERVICE_UNAVAILABLE', 'Reviewed toolchains are not configured.');
    }
  }
}
const versionInclude = { templates: true, testCases: { orderBy: { ordinal: 'asc' as const } } };
@Injectable()
export class QuestionManagementService {
  constructor(
    private readonly repo: ManagementRepository,
    private readonly security: QuestionAuthoringSecurity,
  ) {}
  async list(query: PageInput) {
    await this.repo.now();
    const where: Prisma.QuestionWhereInput = {
      ...(query.search
        ? {
            OR: [
              { slug: { contains: query.search, mode: 'insensitive' } },
              { versions: { some: { title: { contains: query.search, mode: 'insensitive' } } } },
            ],
          }
        : {}),
      ...(query.status === 'ARCHIVED' ? { archivedAt: { not: null } } : { archivedAt: null }),
      ...(['DRAFT', 'PUBLISHED'].includes(query.status ?? '')
        ? { versions: { some: { status: query.status as 'DRAFT' | 'PUBLISHED' } } }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.repo.db.question.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          versions: {
            orderBy: { version: 'desc' },
            take: 1,
            ...(['DRAFT', 'PUBLISHED'].includes(query.status ?? '')
              ? { where: { status: query.status as 'DRAFT' | 'PUBLISHED' } }
              : {}),
          },
        },
      }),
      this.repo.db.question.count({ where }),
    ]);
    return {
      items: rows.map((q) => {
        const v = q.versions[0]!;
        return {
          id: q.id,
          slug: q.slug,
          archivedAt: q.archivedAt?.toISOString() ?? null,
          versionId: v.id,
          version: v.version,
          revision: v.revision,
          status: v.status,
          title: v.title,
          difficulty: v.difficulty,
          topics: v.topicSnapshot,
          maxScore: v.maxScore.toString(),
        };
      }),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }
  async detail(identity: AuthIdentity, id: string) {
    this.repo.db.assertConfigured();
    return this.repo.db.$transaction(async (tx) => {
      await this.repo.assertActor(identity, tx);
      const q = await tx.question.findUnique({
        where: { id },
        include: { versions: { orderBy: { version: 'desc' }, take: 1, include: versionInclude } },
      });
      if (!q?.versions[0]) throw missing();
      const v = q.versions[0],
        keys = this.security.keys();
      await this.repo.audit(tx, identity, 'question.authoring_viewed', 'Question', id, {
        versionId: v.id,
        containsHiddenCases: true,
      });
      return {
        ...this.publicVersion(v),
        id: q.id,
        slug: q.slug,
        archivedAt: q.archivedAt?.toISOString() ?? null,
        testCases: v.testCases.map((c) => ({
          ordinal: c.ordinal,
          visibility: c.visibility,
          weight: c.weight.toString(),
          input: keys.decrypt(
            c.inputCiphertext,
            c.encryptionKeyId,
            c.visibility,
            caseAad(v.id, c.ordinal, c.visibility, 'input'),
          ),
          expectedOutput: keys.decrypt(
            c.expectedOutputCiphertext,
            c.encryptionKeyId,
            c.visibility,
            caseAad(v.id, c.ordinal, c.visibility, 'expected'),
          ),
        })),
      };
    });
  }
  private publicVersion(v: Prisma.QuestionVersionGetPayload<{ include: typeof versionInclude }>) {
    return {
      versionId: v.id,
      version: v.version,
      revision: v.revision,
      status: v.status,
      title: v.title,
      difficulty: v.difficulty,
      topics: v.topicSnapshot,
      tags: v.tags,
      statement: v.statement,
      inputFormat: v.inputFormat,
      outputFormat: v.outputFormat,
      constraints: v.constraints,
      explanation: v.explanation ?? '',
      publicExamples: v.publicExamples ?? [],
      maxScore: v.maxScore.toString(),
      cpuTimeMs: v.cpuTimeMs,
      wallTimeMs: v.wallTimeMs,
      memoryLimitKiB: v.memoryLimitKiB,
      outputLimitBytes: v.outputLimitBytes,
      processLimit: v.processLimit,
      outputComparison: v.outputComparison,
      templates: v.templates.map((t) => ({
        language: t.language,
        starterCode: t.starterCode,
        toolchainId: t.toolchainId,
        executionAdapter: t.executionAdapter ?? { kind: 'STDIO' },
      })),
    };
  }
  private async write(tx: Prisma.TransactionClient, id: string, input: QuestionInput) {
    const keys = this.security.keys();
    // Only encrypted test data is persisted; expected outputs never enter logs/audit/idempotency bodies.
    await tx.questionTemplate.deleteMany({ where: { questionVersionId: id } });
    await tx.testCase.deleteMany({ where: { questionVersionId: id } });
    await tx.questionTemplate.createMany({
      data: input.templates.map((t) => ({
        questionVersionId: id,
        language: t.language,
        starterCode: t.starterCode,
        toolchainId: t.toolchainId,
        executionAdapter: t.executionAdapter ?? { kind: 'STDIO' },
      })),
    });
    for (const c of input.testCases) {
      const keyId = keys.id(c.visibility);
      await tx.testCase.create({
        data: {
          questionVersionId: id,
          ordinal: c.ordinal,
          visibility: c.visibility,
          weight: c.weight,
          encryptionKeyId: keyId,
          integrityHash: caseHash(c.input, c.expectedOutput),
          inputCiphertext: keys.encrypt(
            c.input,
            keyId,
            c.visibility,
            caseAad(id, c.ordinal, c.visibility, 'input'),
          ),
          expectedOutputCiphertext: keys.encrypt(
            c.expectedOutput,
            keyId,
            c.visibility,
            caseAad(id, c.ordinal, c.visibility, 'expected'),
          ),
        },
      });
    }
  }
  private data(input: QuestionInput) {
    return {
      title: input.title,
      difficulty: input.difficulty,
      statement: input.statement,
      inputFormat: input.inputFormat,
      outputFormat: input.outputFormat,
      constraints: input.constraints,
      explanation: input.explanation,
      topicSnapshot: [...new Set(input.topics)],
      tags: input.tags,
      publicExamples: input.publicExamples,
      maxScore: input.maxScore,
      cpuTimeMs: input.cpuTimeMs,
      wallTimeMs: input.wallTimeMs,
      memoryLimitKiB: input.memoryLimitKiB,
      outputLimitBytes: input.outputLimitBytes,
      processLimit: input.processLimit,
      outputComparison: input.outputComparison,
    };
  }
  async create(identity: AuthIdentity, key: string | undefined, input: QuestionInput) {
    if (input.templates.some((t) => t.executionAdapter?.kind === 'SOURCE_WRAPPER'))
      throw new ApiException(
        403,
        'FORBIDDEN',
        'Source wrappers require trusted deployment review.',
      );
    return this.repo.mutate(identity, 'admin:question:create', key, input, async (tx) => {
      const adminId = await this.repo.adminId(identity, tx),
        q = await tx.question.create({
          data: {
            slug: input.slug,
            topics: { create: [...new Set(input.topics)].map((topic) => ({ topic })) },
          },
        });
      const v = await tx.questionVersion.create({
        data: { questionId: q.id, version: 1, createdById: adminId, ...this.data(input) },
      });
      await this.write(tx, v.id, input);
      await this.repo.audit(tx, identity, 'question.created', 'Question', q.id, {
        versionId: v.id,
      });
      return { id: q.id, versionId: v.id, revision: v.revision, status: v.status };
    });
  }
  private async lock(tx: Prisma.TransactionClient, id: string, revision: number) {
    await tx.$queryRaw`SELECT id FROM questions WHERE id=${id}::uuid FOR UPDATE`;
    const q = await tx.question.findUnique({
      where: { id },
      include: { versions: { orderBy: { version: 'desc' }, take: 1, include: versionInclude } },
    });
    if (!q?.versions[0]) throw missing();
    const v = q.versions[0];
    if (v.revision !== revision) throw conflict();
    return { q, v };
  }
  async update(identity: AuthIdentity, id: string, key: string | undefined, input: QuestionInput) {
    if (!input.revision) throw conflict();
    return this.repo.mutate(identity, `admin:question:update:${id}`, key, input, async (tx) => {
      const { q, v } = await this.lock(tx, id, input.revision!);
      if (v.status !== 'DRAFT') throw immutable();
      for (const template of input.templates) {
        const original = v.templates.find(
          (t) => t.language === template.language,
        )?.executionAdapter;
        const previousWrapper =
          original &&
          typeof original === 'object' &&
          !Array.isArray(original) &&
          original.kind === 'SOURCE_WRAPPER';
        if (
          (previousWrapper || template.executionAdapter?.kind === 'SOURCE_WRAPPER') &&
          digest(original) !== digest(template.executionAdapter)
        )
          throw new ApiException(
            403,
            'FORBIDDEN',
            'Trusted source wrappers cannot be changed through the browser.',
          );
      }
      if (q.slug !== input.slug)
        throw new ApiException(400, 'VALIDATION_FAILED', 'Question slugs cannot be changed.');
      await tx.questionVersion.update({
        where: { id: v.id },
        data: { ...this.data(input), revision: { increment: 1 } },
      });
      await tx.questionTopic.deleteMany({ where: { questionId: id } });
      await tx.questionTopic.createMany({
        data: [...new Set(input.topics)].map((topic) => ({ questionId: id, topic })),
      });
      await this.write(tx, v.id, input);
      await this.repo.audit(tx, identity, 'question.draft_updated', 'Question', id, {
        versionId: v.id,
      });
      return { id, versionId: v.id, revision: v.revision + 1, status: 'DRAFT' };
    });
  }
  async draft(identity: AuthIdentity, id: string, key: string | undefined, revision: number) {
    return this.repo.mutate(
      identity,
      `admin:question:draft:${id}`,
      key,
      { revision },
      async (tx) => {
        const { v } = await this.lock(tx, id, revision);
        if (v.status === 'DRAFT')
          return { id, versionId: v.id, revision: v.revision, status: 'DRAFT' };
        const keys = this.security.keys();
        const next = await tx.questionVersion.create({
          data: {
            questionId: id,
            version: v.version + 1,
            createdById: await this.repo.adminId(identity, tx),
            title: v.title,
            difficulty: v.difficulty,
            statement: v.statement,
            inputFormat: v.inputFormat,
            outputFormat: v.outputFormat,
            constraints: v.constraints,
            explanation: v.explanation,
            topicSnapshot: v.topicSnapshot,
            tags: v.tags,
            publicExamples: v.publicExamples ?? Prisma.JsonNull,
            maxScore: v.maxScore,
            cpuTimeMs: v.cpuTimeMs,
            wallTimeMs: v.wallTimeMs,
            memoryLimitKiB: v.memoryLimitKiB,
            outputLimitBytes: v.outputLimitBytes,
            processLimit: v.processLimit,
            outputComparison: v.outputComparison,
          },
        });
        for (const t of v.templates)
          await tx.questionTemplate.create({
            data: {
              questionVersionId: next.id,
              language: t.language,
              starterCode: t.starterCode,
              toolchainId: t.toolchainId,
              executionAdapter: t.executionAdapter ?? Prisma.JsonNull,
            },
          });
        for (const c of v.testCases) {
          const keyId = keys.id(c.visibility),
            input = keys.decrypt(
              c.inputCiphertext,
              c.encryptionKeyId,
              c.visibility,
              caseAad(v.id, c.ordinal, c.visibility, 'input'),
            ),
            expected = keys.decrypt(
              c.expectedOutputCiphertext,
              c.encryptionKeyId,
              c.visibility,
              caseAad(v.id, c.ordinal, c.visibility, 'expected'),
            );
          await tx.testCase.create({
            data: {
              questionVersionId: next.id,
              ordinal: c.ordinal,
              visibility: c.visibility,
              weight: c.weight,
              encryptionKeyId: keyId,
              integrityHash: caseHash(input, expected),
              inputCiphertext: keys.encrypt(
                input,
                keyId,
                c.visibility,
                caseAad(next.id, c.ordinal, c.visibility, 'input'),
              ),
              expectedOutputCiphertext: keys.encrypt(
                expected,
                keyId,
                c.visibility,
                caseAad(next.id, c.ordinal, c.visibility, 'expected'),
              ),
            },
          });
        }
        await this.repo.audit(tx, identity, 'question.version_drafted', 'Question', id, {
          previousVersionId: v.id,
          versionId: next.id,
        });
        return { id, versionId: next.id, revision: next.revision, status: 'DRAFT' };
      },
    );
  }
  private issues(v: Prisma.QuestionVersionGetPayload<{ include: typeof versionInclude }>) {
    const issues: string[] = [],
      catalog = this.security.catalog(),
      keys = this.security.keys();
    for (const t of v.templates) {
      try {
        if (catalog.get(t.toolchainId).language !== t.language)
          issues.push('Toolchain language mismatch.');
      } catch {
        issues.push('An unreviewed toolchain is selected.');
      }
    }
    for (const c of v.testCases) {
      const input = keys.decrypt(
          c.inputCiphertext,
          c.encryptionKeyId,
          c.visibility,
          caseAad(v.id, c.ordinal, c.visibility, 'input'),
        ),
        output = keys.decrypt(
          c.expectedOutputCiphertext,
          c.encryptionKeyId,
          c.visibility,
          caseAad(v.id, c.ordinal, c.visibility, 'expected'),
        );
      if (caseHash(input, output) !== c.integrityHash) issues.push('Test integrity mismatch.');
      if (Buffer.byteLength(output) > Math.min(65536, v.outputLimitBytes))
        issues.push('Expected output exceeds its runtime output limit.');
    }
    for (const visibility of ['PUBLIC', 'HIDDEN']) {
      const count = v.testCases.filter((c) => c.visibility === visibility).length;
      if (!count || count > 32 || count * v.wallTimeMs + 30000 > 120000)
        issues.push('Evaluation exceeds bounded test budget.');
    }
    if (v.templates.length !== 3) issues.push('Three supported language templates are required.');
    const publicCases = v.testCases.filter((c) => c.visibility === 'PUBLIC');
    if (!Array.isArray(v.publicExamples) || !v.publicExamples.length)
      issues.push('At least one public example is required.');
    if (Array.isArray(v.publicExamples))
      for (const example of v.publicExamples) {
        if (!example || typeof example !== 'object' || Array.isArray(example)) {
          issues.push('Invalid public example.');
          continue;
        }
        const c = publicCases.find((c) => c.ordinal === example.ordinal);
        if (
          !c ||
          keys.decrypt(
            c.inputCiphertext,
            c.encryptionKeyId,
            'PUBLIC',
            caseAad(v.id, c.ordinal, 'PUBLIC', 'input'),
          ) !== example.input ||
          keys.decrypt(
            c.expectedOutputCiphertext,
            c.encryptionKeyId,
            'PUBLIC',
            caseAad(v.id, c.ordinal, 'PUBLIC', 'expected'),
          ) !== example.expectedOutput
        )
          issues.push('Examples must match public test cases.');
      }
    return [...new Set(issues)];
  }
  async validate(identity: AuthIdentity, id: string, revision: number) {
    this.repo.db.assertConfigured();
    return this.repo.db.$transaction(async (tx) => {
      await this.repo.assertActor(identity, tx);
      const { v } = await this.lock(tx, id, revision),
        issues = this.issues(v);
      await this.repo.audit(tx, identity, 'question.structure_validated', 'Question', id, {
        versionId: v.id,
        valid: issues.length === 0,
      });
      return {
        valid: !issues.length,
        issues,
        executionValidated: false,
        message:
          'Schema, encryption, examples and pinned toolchains validated. Runtime/reference validation requires the isolated Linux judge gate.',
      };
    });
  }
  async publish(identity: AuthIdentity, id: string, key: string | undefined, revision: number) {
    return this.repo.mutate(
      identity,
      `admin:question:publish:${id}`,
      key,
      { revision },
      async (tx) => {
        const { v } = await this.lock(tx, id, revision);
        if (v.status === 'PUBLISHED')
          return { id, versionId: v.id, revision: v.revision, status: v.status };
        if (this.issues(v).length)
          throw new ApiException(
            422,
            'VALIDATION_FAILED',
            'Question validation failed. Review the draft.',
          );
        await tx.questionVersion.update({
          where: { id: v.id },
          data: {
            status: 'PUBLISHED',
            publishedAt: (await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0]!
              .now,
            contentHash: digest({
              version: this.publicVersion(v),
              cases: v.testCases.map((c) => ({
                ordinal: c.ordinal,
                visibility: c.visibility,
                hash: c.integrityHash,
                weight: c.weight.toString(),
              })),
            }),
          },
        });
        await this.repo.audit(tx, identity, 'question.published', 'Question', id, {
          versionId: v.id,
          version: v.version,
        });
        return { id, versionId: v.id, revision: v.revision, status: 'PUBLISHED' };
      },
    );
  }
  async archive(identity: AuthIdentity, id: string, key: string | undefined, revision: number) {
    return this.repo.mutate(
      identity,
      `admin:question:archive:${id}`,
      key,
      { revision },
      async (tx) => {
        await this.lock(tx, id, revision);
        await tx.question.update({
          where: { id },
          data: {
            archivedAt: (await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0]!
              .now,
          },
        });
        await this.repo.audit(tx, identity, 'question.archived', 'Question', id);
        return { id, archived: true };
      },
    );
  }
}
