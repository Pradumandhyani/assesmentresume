import 'dotenv/config';
import { defineConfig } from 'prisma/config';
// Generation and validation do not connect. A runtime or migration must supply its own URL.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    url:
      process.env.DATABASE_URL ??
      'postgresql://assessment_dev:local-only@127.0.0.1:5432/assessment_dev',
  },
});
