import 'server-only';
import { db } from './db';
import { endOfDay, startOfDay } from './schedule';
import type { Cycle, Topic } from '@/generated/prisma/client';

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
 * Що повторювати сьогодні: термін настав або тема червона. Спершу червоні, потім найстаріші.
 * Виняток: задачі з навчального плану (теми ATTEMPT-кроків) тільки за розкладом, навіть червоні:
 * задачу, розв'язану сьогодні на червоне, переробляють через 2 дні, а не того ж вечора.
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

/** Ключ дня для колонки DATE: опівніч UTC тієї ж календарної дати, що й локальна. */
export function dayKey(date: Date): Date {
  const local = startOfDay(date);
  return new Date(Date.UTC(local.getFullYear(), local.getMonth(), local.getDate()));
}
