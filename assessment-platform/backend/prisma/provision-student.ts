import * as argon2 from 'argon2';
import { createHash } from 'node:crypto';
import { developmentDatabase } from './development-database';
async function main() {
  const db = developmentDatabase();
  try {
    const identifier = process.env.DEV_STUDENT_ID?.trim();
    const displayName = process.env.DEV_STUDENT_NAME?.trim();
    const password = process.env.DEV_STUDENT_PASSWORD;
    if (
      !identifier ||
      identifier.length > 128 ||
      !displayName ||
      displayName.length > 200 ||
      !password ||
      password.length < 12 ||
      Buffer.byteLength(password) > 1024
    )
      throw new Error(
        'Explicit development student ID, name and a password of at least 12 characters are required',
      );
    const existing = await db.student.findUnique({ where: { externalId: identifier } });
    if (existing) {
      console.log('Student already exists; identity, status and password were preserved.');
      return;
    }
    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1,
    });
    await db.user.create({
      data: {
        email: `${createHash('sha256').update(identifier).digest('hex')}@development-students.example.invalid`,
        role: 'STUDENT',
        passwordHash,
        student: { create: { externalId: identifier, displayName } },
      },
    });
    console.log(
      'Development student provisioned. Run db:seed to assign the development assessment.',
    );
  } finally {
    await db.$disconnect();
  }
}
void main().catch(() => {
  console.error(
    'Student provisioning failed. Check the development database and explicit credential fields.',
  );
  process.exitCode = 1;
});
