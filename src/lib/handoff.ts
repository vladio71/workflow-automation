import 'server-only';
import { db } from './db';
import { dayKey } from './queries';

/** Evening handoff: "tomorrow I start with ...". One row per day (Handoff.day = the day the step is for). */

export const MAX_FIRST_STEP = 200;
export const DAY_MS = 24 * 60 * 60 * 1000;
/** before this hour "tomorrow" still means today: "end of day" pressed at half past midnight */
export const LATE_NIGHT_HOUR = 5;

/** First step for the day of now ('' when none was recorded). */
export async function getFirstStep(now: Date = new Date()): Promise<string> {
  const row = await db.handoff.findUnique({ where: { day: dayKey(now) } });
  return row?.firstStep ?? '';
}

/** Day the evening handoff is written for: tomorrow, but after midnight (before 5:00) still today. */
export function handoffDay(now: Date = new Date()): Date {
  const target = now.getHours() < LATE_NIGHT_HOUR ? now : new Date(now.getTime() + DAY_MS);
  return dayKey(target);
}

/** Record the first step for the next day. Empty text clears the record. Returns the day it was written for. */
export async function setFirstStep(text: string, now: Date = new Date()): Promise<Date> {
  const day = handoffDay(now);
  const firstStep = text.trim().slice(0, MAX_FIRST_STEP);
  if (!firstStep) {
    await db.handoff.deleteMany({ where: { day } });
    return day;
  }
  await db.handoff.upsert({ where: { day }, create: { day, firstStep }, update: { firstStep } });
  return day;
}
