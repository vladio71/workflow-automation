/**
 * Seed data: one GraphQL topic with the notes, linked to the vladio71/graphql-base repo.
 * Cards come only from learn/ in the repo: the first Sync (or opening Today) pulls them in.
 * Other topics and cycles are added by hand. Run: npm run db:seed.
 * WARNING: wipes all data (topics, questions, cycles, logs, plans, mock, inbox, level attempts, tasks). Run once at the start.
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
    db.inboxItem.deleteMany(),
    db.dailyLog.deleteMany(),
    db.activityLog.deleteMany(),
    db.dailyPlan.deleteMany(),
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
