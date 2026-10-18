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

/**
 * What to review today: due or red topics. Red first, then the oldest.
 * Exception: study plan problems (topics of ATTEMPT steps) only by schedule, even when red:
 * a problem solved red today is redone in 2 days, not the same evening.
 */
export async function getDueTopics(now: Date = new Date()): Promise<Topic[]> {
  const until = endOfDay(now);
  const [due, attemptSteps] = await Promise.all([
    db.topic.findMany({
      where: {
        OR: [
          { nextReviewAt: { lte: until } },
          { confidence: 'RED' },
        ],
      },
    }),
    db.planStep.findMany({ where: { kind: 'ATTEMPT' }, select: { sourceId: true, topicPath: true } }),
  ]);
  const problemKeys = new Set(attemptSteps.map((step) => `${step.sourceId}:${step.topicPath}`));
  const isScheduledLater = (topic: Topic): boolean =>
    topic.sourceId !== null &&
    problemKeys.has(`${topic.sourceId}:${topic.sourcePath}`) &&
    (topic.nextReviewAt === null || topic.nextReviewAt > until);

  const rank = (topic: Topic): number => (topic.confidence === 'RED' ? 0 : 1);
  return due
    .filter((topic) => !isScheduledLater(topic))
    .sort((a, b) => {
      const byColor = rank(a) - rank(b);
      if (byColor !== 0) return byColor;
      return (a.lastRecallAt?.getTime() ?? 0) - (b.lastRecallAt?.getTime() ?? 0);
    });
}

export async function getDueCount(): Promise<number> {
  return (await getDueTopics()).length;
}

export async function getTodayLog(now: Date = new Date()): Promise<DailyLog> {
  const day = dayKey(now);
  return (await db.dailyLog.findUnique({ where: { day } })) ?? {
    day, cardsDone: false, recallDone: false, outLoud: false, note: '',
  };
}

/** Day key for a DATE column: midnight UTC of the same calendar date as local. */
export function dayKey(date: Date): Date {
  const local = startOfDay(date);
  return new Date(Date.UTC(local.getFullYear(), local.getMonth(), local.getDate()));
}

/** Next primer chapter: the first not started one, otherwise the least recently reviewed. */
export async function getNextSystemDesignTopic(): Promise<Topic | null> {
  const notStarted = await db.topic.findFirst({
    where: { track: 'SYSTEM_DESIGN', confidence: 'NOT_STARTED' },
    orderBy: { id: 'asc' },
  });
  if (notStarted) return notStarted;
  return db.topic.findFirst({ where: { track: 'SYSTEM_DESIGN' }, orderBy: { lastRecallAt: 'asc' } });
}
