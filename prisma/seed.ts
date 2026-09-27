/**
 * Стартові дані: одна тема GraphQL з твоїми матеріалами (нотатки + 32 питання з колоди Anki),
 * прив'язана до репо vladio71/graphql-base: перший Sync (або відкриття Today) підтягне картки з learn/.
 * Решту тем і циклів додаєш сам. Запуск: npm run db:seed.
 * УВАГА: чистить усі дані (теми, питання, цикли, логи, плани, mock, inbox). Запускай один раз на старті.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

/** Прості HTML-теги з карток Anki -> markdown. */
function htmlToMarkdown(html: string): string {
  return html
    .replace(/<b>(.*?)<\/b>/g, '**$1**')
    .replace(/<code>(.*?)<\/code>/g, '`$1`')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

async function main(): Promise<void> {
  await db.$transaction([
    db.mockSession.deleteMany(),
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

  const cards = readFileSync('seed/anki-graphql.txt', 'utf8')
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('#'));

  for (const card of cards) {
    const [question, answer] = card.split('\t');
    if (!question || !answer) continue;
    await db.question.create({
      data: { question, reference: htmlToMarkdown(answer), inAnki: true, topicId: graphql.id },
    });
  }

  console.log(`Seeded: topic "GraphQL" with ${await db.question.count()} questions. Cards from learn/ arrive on the first Sync. Add your own topics and cycles in the app.`);
}

await main();
await db.$disconnect();
