import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// generate працює і без DATABASE_URL (postinstall до створення .env)
const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
  datasource: databaseUrl ? { url: databaseUrl } : undefined,
});
