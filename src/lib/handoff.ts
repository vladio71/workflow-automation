import 'server-only';
import { db } from './db';
import { dayKey } from './queries';

/** Вечірня передача дня: "завтра починаю з ...". Один рядок на день (Handoff.day = день, на який крок). */

export const MAX_FIRST_STEP = 200;
export const DAY_MS = 24 * 60 * 60 * 1000;
/** до цієї години "завтра" ще означає сьогодні: натиснув "кінець дня" о пів на першу ночі */
export const LATE_NIGHT_HOUR = 5;

/** Перший крок на день now ('' якщо не записано). */
export async function getFirstStep(now: Date = new Date()): Promise<string> {
  const row = await db.handoff.findUnique({ where: { day: dayKey(now) } });
  return row?.firstStep ?? '';
}

/** День, на який пишеться вечірня передача: завтра, а після опівночі (до 5:00) ще сьогодні. */
export function handoffDay(now: Date = new Date()): Date {
  const target = now.getHours() < LATE_NIGHT_HOUR ? now : new Date(now.getTime() + DAY_MS);
  return dayKey(target);
}

/** Записати перший крок на наступний день. Порожній текст стирає запис. Повертає день, на який записано. */
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
