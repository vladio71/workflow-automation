/**
 * Стартові дані: одна тема GraphQL з твоїми нотатками, прив'язана до репо vladio71/graphql-base.
 * Картки приходять тільки з learn/ у репо: перший Sync (або відкриття Today) їх підтягне.
 * Решту тем і циклів додаєш сам. Запуск: npm run db:seed.
 * УВАГА: чистить усі дані (теми, питання, цикли, логи, плани, mock, inbox, спроби рівнів, справи). Запускай один раз на старті.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function main(): Promise<void> {
  await db.$transaction([
    db.mockSession.deleteMany(),
    db.levelAttempt.deleteMany(),
    db.taskTick.deleteMany(),
    db.task.deleteMany(),
    db.parkingItem.deleteMany(),
    db.cellProgress.deleteMany(),
    db.drillAttempt.deleteMany(),
    db.spokenAnswer.deleteMany(),
    db.dailyLog.deleteMany(),
    db.activityLog.deleteMany(),
    db.cellRedo.deleteMany(),
    db.recallLog.deleteMany(),
    db.question.deleteMany(),
    db.topic.deleteMany(),
    db.cycle.deleteMany(),
    db.source.deleteMany(),
  ]);

  const repo = await db.source.create({ data: { repo: 'vladio71/graphql-base', branch: 'main' } });

  const graphql = await db.topic.create({
    data: {
      name: 'GraphQL',
      track: 'GRAPHQL',
      drill: 'drills',
      source: 'https://github.com/vladio71/graphql-base',
      sourceId: repo.id,
      notes: readFileSync('seed/graphql-notes.md', 'utf8'),
    },
  });

  console.log('Seeded: topic "GraphQL" linked to vladio71/graphql-base. Cards arrive on the first Sync.');
}

await main();
await db.$disconnect();
