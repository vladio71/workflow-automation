import 'server-only';
import { db } from './db';
import { dayKey } from './queries';
import { startOfDay } from './schedule';

/**
 * Справи-сесії: у справи є ціль на день (розіслати 10 резюме), кожен крок = рядок TaskTick.
 * Прогрес рахується за сьогодні, тож башта дня щоночі починається з нуля, а історія лишається для скайлайну.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** скільки днів показує скайлайн, разом із сьогодні */
export const SKYLINE_DAYS = 14;
export const MAX_TARGET = 100;

export interface TaskProgress {
  count: number;
  target: number;
}

export interface TowerTick {
  id: number;
  note: string;
  /** ISO-час, щоб передати в клієнт */
  at: string;
}

export interface TowerDay {
  /** "2026-10-01" */
  day: string;
  count: number;
}

export interface TowerData {
  taskId: number;
  title: string;
  target: number;
  count: number;
  ticks: TowerTick[];
  /** від найстаршого дня до сьогодні */
  history: TowerDay[];
}

export function clampTarget(target: number): number {
  if (!Number.isFinite(target)) return 0;
  return Math.min(MAX_TARGET, Math.max(0, Math.round(target)));
}

function isoDay(day: Date): string {
  return day.toISOString().slice(0, 10);
}

/** Кроки за сьогодні: taskId -> кількість. */
export async function todayTickCounts(taskIds: readonly number[], now: Date = new Date()): Promise<Map<number, number>> {
  if (taskIds.length === 0) return new Map();
  const rows = await db.taskTick.groupBy({
    by: ['taskId'],
    where: { taskId: { in: [...taskIds] }, day: dayKey(now) },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.taskId, row._count._all]));
}

/**
 * Башти на сьогодні: усі справи з ціллю, які ще живі (повторювані, відкриті разові або закриті сьогодні),
 * з сьогоднішніми кроками і скайлайном за останні дні.
 */
export async function getTowers(now: Date = new Date()): Promise<TowerData[]> {
  const today = dayKey(now);
  const tasks = await db.task.findMany({
    where: {
      target: { gt: 0 },
      // разова справа, закрита сьогодні, лишається: її башту видно до кінця дня
      OR: [{ repeat: { not: 'ONCE' } }, { doneAt: null }, { doneAt: { gte: startOfDay(now) } }],
    },
    orderBy: { createdAt: 'asc' },
  });
  if (tasks.length === 0) return [];

  // dayKey = UTC-північ локальної дати, тож дні назад рахуємо в UTC: перехід на зимовий час їх не зсуне
  const from = new Date(today.getTime() - (SKYLINE_DAYS - 1) * DAY_MS);
  const ticks = await db.taskTick.findMany({
    where: { taskId: { in: tasks.map((task) => task.id) }, day: { gte: from } },
    orderBy: { createdAt: 'asc' },
  });

  return tasks.map((task) => {
    const own = ticks.filter((tick) => tick.taskId === task.id);
    const todayTicks = own.filter((tick) => tick.day.getTime() === today.getTime());
    const history: TowerDay[] = [];
    for (let offset = SKYLINE_DAYS - 1; offset >= 0; offset -= 1) {
      const day = new Date(today.getTime() - offset * DAY_MS);
      history.push({ day: isoDay(day), count: own.filter((tick) => tick.day.getTime() === day.getTime()).length });
    }
    return {
      taskId: task.id,
      title: task.title,
      target: task.target,
      count: todayTicks.length,
      ticks: todayTicks.map((tick) => ({ id: tick.id, note: tick.note, at: tick.createdAt.toISOString() })),
      history,
    };
  });
}
