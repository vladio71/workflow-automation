import 'server-only';
import { db } from './db';
import { dayKey } from './queries';
import { startOfDay } from './schedule';

/**
 * Session tasks: a task has a daily target (send 10 resumes), each step = a TaskTick row.
 * Progress is counted for today, so the day's tower restarts from zero every night while history stays for the skyline.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** days shown in the skyline, today included */
export const SKYLINE_DAYS = 14;
export const MAX_TARGET = 100;

export interface TaskProgress {
  count: number;
  target: number;
}

export interface TowerTick {
  id: number;
  note: string;
  /** ISO time, serializable for the client */
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
  /** oldest day to today */
  history: TowerDay[];
}

export function clampTarget(target: number): number {
  if (!Number.isFinite(target)) return 0;
  return Math.min(MAX_TARGET, Math.max(0, Math.round(target)));
}

function isoDay(day: Date): string {
  return day.toISOString().slice(0, 10);
}

/** Today's steps: taskId -> count. */
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
 * Today's towers: all tasks with a target that are still alive (repeating, open one-offs or closed today),
 * with today's steps and a skyline of the last days.
 */
export async function getTowers(now: Date = new Date()): Promise<TowerData[]> {
  const today = dayKey(now);
  const tasks = await db.task.findMany({
    where: {
      target: { gt: 0 },
      // a one-off task closed today stays: its tower is visible until the end of the day
      OR: [{ repeat: { not: 'ONCE' } }, { doneAt: null }, { doneAt: { gte: startOfDay(now) } }],
    },
    orderBy: { createdAt: 'asc' },
  });
  if (tasks.length === 0) return [];

  // dayKey is UTC midnight of the local date, so days back are counted in UTC: a DST switch cannot shift them
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
