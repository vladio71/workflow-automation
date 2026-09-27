import 'server-only';
import { db } from './db';
import { endOfDay, startOfDay } from './schedule';
import type { Cycle, DailyLog, Topic } from '@/generated/prisma/client';

export interface CycleWithProgress extends Cycle {
  topicCount: number;
  greenCount: number;
}

export async function getActiveCycle(): Promise<CycleWithProgress | null> {
  const cycle = await db.cycle.findFirst({ where: { status: 'ACTIVE' }, orderBy: { number: 'asc' } });
  if (!cycle) return null;
  const [topicCount, greenCount] = await Promise.all([
    db.topic.count({ where: { cycleId: cycle.id } }),
    db.topic.count({ where: { cycleId: cycle.id, confidence: 'GREEN' } }),
  ]);
  return { ...cycle, topicCount, greenCount };
}

/** Що повторювати сьогодні: термін настав або тема червона. Спершу червоні, потім найстаріші. */
export async function getDueTopics(now: Date = new Date()): Promise<Topic[]> {
  const due = await db.topic.findMany({
    where: {
      OR: [
        { nextReviewAt: { lte: endOfDay(now) } },
        { confidence: 'RED' },
      ],
    },
  });
  const rank = (topic: Topic): number => (topic.confidence === 'RED' ? 0 : 1);
  return due.sort((a, b) => {
    const byColor = rank(a) - rank(b);
    if (byColor !== 0) return byColor;
    return (a.lastRecallAt?.getTime() ?? 0) - (b.lastRecallAt?.getTime() ?? 0);
  });
}

export async function getDueCount(): Promise<number> {
  return db.topic.count({
    where: { OR: [{ nextReviewAt: { lte: endOfDay(new Date()) } }, { confidence: 'RED' }] },
  });
}

export async function getTodayLog(now: Date = new Date()): Promise<DailyLog> {
  const day = dayKey(now);
  return (await db.dailyLog.findUnique({ where: { day } })) ?? {
    day, ankiDone: false, recallDone: false, outLoud: false, note: '',
  };
}

/** Ключ дня для колонки DATE: опівніч UTC тієї ж календарної дати, що й локальна. */
export function dayKey(date: Date): Date {
  const local = startOfDay(date);
  return new Date(Date.UTC(local.getFullYear(), local.getMonth(), local.getDate()));
}

/** Наступний розділ праймера: перший не розпочатий, інакше найдавніше повторений. */
export async function getNextSystemDesignTopic(): Promise<Topic | null> {
  const notStarted = await db.topic.findFirst({
    where: { track: 'SYSTEM_DESIGN', confidence: 'NOT_STARTED' },
    orderBy: { id: 'asc' },
  });
  if (notStarted) return notStarted;
  return db.topic.findFirst({ where: { track: 'SYSTEM_DESIGN' }, orderBy: { lastRecallAt: 'asc' } });
}
