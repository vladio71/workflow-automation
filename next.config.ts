import type { NextConfig } from 'next';

const config: NextConfig = {
  // Prisma 7 + pg are server-only, keep them out of the client bundle
  serverExternalPackages: ['@prisma/client', '@prisma/adapter-pg', 'pg'],
};

export default config;
