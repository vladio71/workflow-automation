import type { Confidence } from '@/generated/prisma/enums';

/**
 * Review intervals (days). As on the wall chart: 0 (done) -> +2 -> +7 -> +21, then doubling.
 *   GREEN (from memory, no hints) -> next step
 *   AMBER (small gaps)            -> same step
 *   RED   (stuck)                 -> back to 2 days
 */
export const INTERVAL_LADDER: readonly number[] = [2, 7, 21, 42, 84];
const FIRST_STEP = 2;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ScheduleResult {
  intervalDays: number;
  nextReviewAt: Date;
}

export function nextInterval(current: number, confidence: Confidence): number {
  if (confidence === 'RED' || confidence === 'NOT_STARTED') return FIRST_STEP;
  if (confidence === 'AMBER') return Math.max(current, FIRST_STEP);
  const next = INTERVAL_LADDER.find((days) => days > current);
  return next ?? INTERVAL_LADDER[INTERVAL_LADDER.length - 1] ?? FIRST_STEP;
}

export function schedule(current: number, confidence: Confidence, recalledAt: Date): ScheduleResult {
  const intervalDays = nextInterval(current, confidence);
  return { intervalDays, nextReviewAt: new Date(startOfDay(recalledAt).getTime() + intervalDays * DAY_MS) };
}

export function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function endOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

/** "today", "in 3d", "2d ago" */
export function relativeDay(date: Date | null, now: Date = new Date()): string {
  if (!date) return '';
  const diff = Math.round((startOfDay(date).getTime() - startOfDay(now).getTime()) / DAY_MS);
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff === -1) return 'yesterday';
  return diff > 0 ? `in ${diff}d` : `${-diff}d ago`;
}
