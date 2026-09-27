/**
 * Початкові дані: теми з notion-topics.csv, питання з колоди Anki, 5 циклів.
 * Запуск: npm run db:seed. Безпечно повторювати: чистить таблиці і заливає знову.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import type { Track } from '../src/generated/prisma/enums.ts';

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

// ---------- CSV (з лапками і комами всередині) ----------
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const input = text.replace(/^﻿/, '');
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const TRACK_BY_LABEL: Record<string, Track> = {
  GraphQL: 'GRAPHQL',
  'System design': 'SYSTEM_DESIGN',
  Node: 'NODE',
  AI: 'AI',
  Python: 'PYTHON',
};

/** Прості HTML-теги з карток Anki -> markdown. */
function htmlToMarkdown(html: string): string {
  return html
    .replace(/<b>(.*?)<\/b>/g, '**$1**')
    .replace(/<code>(.*?)<\/code>/g, '`$1`')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

const CYCLES = [
  { number: 1, name: 'Node: pool, retries, races', goal: 'Вмію налаштувати пул, пояснити ретраї з backoff і прибрати гонку умовним апдейтом.' },
  { number: 2, name: 'AI / TS: streaming + tools', goal: 'Вмію стрімити відповідь LLM і дати моделі викликати мої функції.' },
  { number: 3, name: 'AI / TS: RAG + evals', goal: 'Вмію зібрати RAG і виміряти якість на наборі питань.' },
  { number: 4, name: 'Python: RAG on FastAPI', goal: 'Переписав RAG на FastAPI + pydantic.' },
  { number: 5, name: 'Reds from the table', goal: 'Всі червоні теми стали жовтими або зеленими.' },
];
const FIRST_CYCLE_START = new Date('2026-09-28T00:00:00Z'); // понеділок

async function main(): Promise<void> {
  await db.$transaction([
    db.recallLog.deleteMany(),
    db.question.deleteMany(),
    db.topic.deleteMany(),
    db.cycle.deleteMany(),
  ]);

  // ---------- цикли ----------
  const cycleIdByNumber = new Map<number, number>();
  for (const cycle of CYCLES) {
    const startsOn = addDays(FIRST_CYCLE_START, (cycle.number - 1) * 14);
    const created = await db.cycle.create({
      data: {
        ...cycle,
        startsOn,
        endsOn: addDays(startsOn, 13),
        status: cycle.number === 1 ? 'ACTIVE' : 'PLANNED',
      },
    });
    cycleIdByNumber.set(cycle.number, created.id);
  }

  // ---------- теми ----------
  const [header, ...rows] = parseCsv(readFileSync('seed/notion-topics.csv', 'utf8'));
  if (!header) throw new Error('Empty CSV');
  const column = (name: string): number => header.indexOf(name);
  const topicIdByDrillNumber = new Map<string, number>();

  for (const row of rows) {
    const name = row[column('Name')];
    const trackLabel = row[column('Track')];
    if (!name || !trackLabel) continue;
    const track = TRACK_BY_LABEL[trackLabel];
    if (!track) throw new Error(`Unknown track ${trackLabel}`);
    const cycleNumber = Number(row[column('Cycle')] || 0);

    const topic = await db.topic.create({
      data: {
        name,
        track,
        drill: row[column('Drill / file')] ?? '',
        source: row[column('Source')] ?? '',
        cycleId: cycleIdByNumber.get(cycleNumber) ?? null,
      },
    });
    const drillNumber = name.match(/^GraphQL (\d{2})\./)?.[1];
    if (drillNumber) topicIdByDrillNumber.set(drillNumber, topic.id);
  }

  // ---------- питання з колоди Anki ----------
  const cards = readFileSync('seed/anki-graphql.txt', 'utf8')
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('#'));

  for (const card of cards) {
    const [question, answer, tags] = card.split('\t');
    if (!question || !answer) continue;
    const drillNumber = tags?.match(/drill(\d{2})/)?.[1];
    await db.question.create({
      data: {
        question,
        reference: htmlToMarkdown(answer),
        inAnki: true,
        topicId: drillNumber ? topicIdByDrillNumber.get(drillNumber) ?? null : null,
      },
    });
  }

  const [topics, questions] = await Promise.all([db.topic.count(), db.question.count()]);
  console.log(`Seeded: ${CYCLES.length} cycles, ${topics} topics, ${questions} questions`);
}

await main();
await db.$disconnect();
