import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// generate must work without DATABASE_URL (postinstall runs before .env exists)
const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
  datasource: databaseUrl ? { url: databaseUrl } : undefined,
});
