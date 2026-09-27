import type { NextConfig } from 'next';

const config: NextConfig = {
  // Prisma 7 + pg працюють лише на сервері, не бандлимо їх у клієнт
  serverExternalPackages: ['@prisma/client', '@prisma/adapter-pg', 'pg'],
};

export default config;
