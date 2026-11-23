import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import { developmentDatabase } from './development-database';
import { importQuestionBank, prepareQuestionBank } from './question-bank-import';
import { TestcaseKeyring } from '../src/workers/judge/testcase-crypto';
import { ToolchainCatalog } from '../src/workers/sandbox/toolchain-catalog';

async function main() {
  const db = developmentDatabase();
  try {
    const keyFile = process.env.QUESTION_KEYRING_FILE ?? process.env.TESTCASE_KEYRING_FILE;
    const catalogFile = process.env.SANDBOX_TOOLCHAIN_CATALOG;
    if (!keyFile || !catalogFile)
      throw new Error('Question keyring and toolchain catalog are required');
    const keys = TestcaseKeyring.fromFile(keyFile, false, ['PUBLIC', 'HIDDEN']);
    const catalog = ToolchainCatalog.fromFile(catalogFile);
    const sourceFile = resolve(process.argv[2] ?? '../../Questions/question_bank.json');
    const questions = prepareQuestionBank(JSON.parse(readFileSync(sourceFile, 'utf8')), catalog);
    const email = 'question-bank-import@example.invalid';
    let owner = await db.admin.findFirst({ where: { user: { email } } });
    if (!owner) {
      const user = await db.user.create({
        data: {
          email,
          role: 'ADMIN',
          isActive: false,
          passwordHash: await argon2.hash(randomBytes(32).toString('hex')),
          admin: { create: { displayName: 'Question bank import' } },
        },
        include: { admin: true },
      });
      owner = user.admin!;
    }
    const result = await importQuestionBank(db, questions, keys, owner.id);
    console.log(JSON.stringify({ source: sourceFile, total: questions.length, ...result }));
  } finally {
    await db.$disconnect();
  }
}
void main().catch((error: unknown) => {
  // Do not print private testcase content, database URLs or encryption keys.
  console.error(
    error instanceof Error && error.message.startsWith('Invalid question ')
      ? error.message
      : 'Question bank import failed. Check source structure, local database, keyring and toolchains.',
  );
  process.exitCode = 1;
});
