import * as argon2 from 'argon2';
import { developmentDatabase } from './development-database';
async function main() {
  const db = developmentDatabase();
  try {
    const email = process.env.DEV_ADMIN_EMAIL?.trim().toLowerCase(),
      displayName = process.env.DEV_ADMIN_NAME?.trim(),
      password = process.env.DEV_ADMIN_PASSWORD;
    if (
      !email ||
      !/^\S+@\S+\.\S+$/.test(email) ||
      email.length > 320 ||
      !displayName ||
      displayName.length > 200 ||
      !password ||
      password.length < 12 ||
      Buffer.byteLength(password) > 1024
    )
      throw new Error('Explicit development administrator credentials required');
    const existing = await db.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });
    if (existing) {
      if (
        existing.role !== 'ADMIN' ||
        !(await db.admin.findUnique({ where: { userId: existing.id } }))
      )
        throw new Error('Existing identity has a different role');
      console.log('Administrator already exists; credentials and status preserved.');
      return;
    }
    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1,
    });
    await db.user.create({
      data: { email, passwordHash, role: 'ADMIN', admin: { create: { displayName } } },
    });
    console.log('Development administrator provisioned.');
  } finally {
    await db.$disconnect();
  }
}
void main().catch(() => {
  console.error(
    'Administrator provisioning failed. Check the development database and explicit private credential fields.',
  );
  process.exitCode = 1;
});
