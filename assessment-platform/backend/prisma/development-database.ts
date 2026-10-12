import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/database/generated/client';
export function developmentDatabase() {
  const value = process.env.DATABASE_URL;
  if (process.env.NODE_ENV !== 'development' || !value)
    throw new Error(
      'Development scripts require NODE_ENV=development and an explicit DATABASE_URL',
    );
  const url = new URL(value);
  if (!/(^|[_-])(dev|test)([_-]|$)/i.test(url.pathname.slice(1)))
    throw new Error('Development seeding requires a database name containing dev or test');
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: value, max: 1 }) });
}
