'use server';

import { db } from '@/lib/db';
import { dayKey } from '@/lib/queries';
import { clampMinutes } from '@/lib/plan-order';
import { clampTarget, todayTickCounts } from '@/lib/task-sessions';
import { MAX_NOTES, clampPriority, updateBacklogTask } from '@/lib/task-backlog';
import type { TaskRepeat, TaskStatus } from '@/generated/prisma/enums';
import { refresh } from './shared';

// ─── Tasks outside study ─────────────────────────────────────────────────────

const TASK_REPEATS: readonly TaskRepeat[] = ['ONCE', 'DAILY', 'WEEKDAYS'];

/** "2026-10-19" from an input type="date" -> a day key for the DATE column (like dayKey); empty or malformed -> null. */
function parseDateField(value: FormDataEntryValue | null): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function createTask(formData: FormData): Promise<void> {
  const title = String(formData.get('title') ?? '').trim().slice(0, 200);
  if (!title) return;
  const repeatValue = String(formData.get('repeat') ?? 'ONCE');
  const repeat = TASK_REPEATS.find((value) => value === repeatValue) ?? 'ONCE';
  const target = clampTarget(Number(formData.get('target') ?? 0));
  const until = parseDateField(formData.get('until'));
  const priority = clampPriority(Number(formData.get('priority') ?? 3));
  // From the Tasks form a one-off task goes to the backlog; a recurring one is in progress at once, a backlog makes no sense for it.
  const status: TaskStatus = repeat === 'ONCE' ? 'BACKLOG' : 'TODO';
  await db.task.create({ data: { title, minutes: clampMinutes(Number(formData.get('minutes') ?? 30)), repeat, target, until, status, priority } });
  refresh();
}

/** Move a task between board columns. 'DONE' sets doneAt, any other status clears it. */
export async function setTaskStatus(id: number, status: TaskStatus | 'DONE'): Promise<void> {
  await updateBacklogTask(id, { status });
  refresh();
}

/** The task modal form: title, notes, priority, minutes, target, until which day. */
export async function updateTaskForm(id: number, formData: FormData): Promise<void> {
  const title = String(formData.get('title') ?? '').trim().slice(0, 200);
  if (!title) return;
  const untilRaw = String(formData.get('until') ?? '');
  await db.task.update({
    where: { id },
    data: {
      title,
      notes: String(formData.get('notes') ?? '').trim().slice(0, MAX_NOTES),
      priority: clampPriority(Number(formData.get('priority') ?? 3)),
      minutes: clampMinutes(Number(formData.get('minutes') ?? 30)),
      target: clampTarget(Number(formData.get('target') ?? 0)),
      until: untilRaw ? parseDateField(untilRaw) : null,
    },
  });
  refresh();
}

export async function setTaskPriority(id: number, formData: FormData): Promise<void> {
  await db.task.update({ where: { id }, data: { priority: clampPriority(Number(formData.get('priority') ?? 3)) } });
  refresh();
}

/** Daily target: 0 = a regular task with a checkbox, more = a session with a counter and a tower. */
export async function setTaskTarget(id: number, formData: FormData): Promise<void> {
  await db.task.update({ where: { id }, data: { target: clampTarget(Number(formData.get('target') ?? 0)) } });
  refresh();
}

export async function setTaskDone(id: number, done: boolean): Promise<void> {
  await db.task.update({ where: { id }, data: { doneAt: done ? new Date() : null } });
  refresh();
}

export async function deleteTask(id: number): Promise<void> {
  await db.task.delete({ where: { id } });
  refresh();
}

// ─── Session ticks (+1 / -1) ─────────────────────────────────────────────────

export type TickResult = { ok: true; count: number; target: number } | { ok: false; error: string };

const MAX_TICK_NOTE = 300;

/** +1 in a session, e.g. one resume sent. note = company or link, may be empty. */
export async function tickTask(taskId: number, note: string): Promise<TickResult> {
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task || task.target <= 0) return { ok: false, error: 'Це не справа-сесія: постав їй ціль у Tasks' };
  const now = new Date();
  await db.taskTick.create({ data: { taskId, day: dayKey(now), note: note.trim().slice(0, MAX_TICK_NOTE) } });
  const count = (await todayTickCounts([taskId], now)).get(taskId) ?? 0;
  const result = await syncOnceDone(taskId, count);
  refresh();
  return result;
}

/** +1 from the Tasks page: a form without a note. */
export async function tickTaskForm(taskId: number): Promise<void> {
  await tickTask(taskId, '');
}

/** -1: remove today's last tick (an extra click). */
export async function untickTask(taskId: number): Promise<TickResult> {
  const now = new Date();
  const last = await db.taskTick.findFirst({ where: { taskId, day: dayKey(now) }, orderBy: { createdAt: 'desc' } });
  if (last) await db.taskTick.delete({ where: { id: last.id } });
  const count = (await todayTickCounts([taskId], now)).get(taskId) ?? 0;
  const result = await syncOnceDone(taskId, count);
  refresh();
  return result;
}

/** A one-off session task closes when today's count reaches the target and reopens when a -1 drops below it. */
async function syncOnceDone(taskId: number, count: number): Promise<TickResult> {
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task) return { ok: false, error: 'Справу не знайдено' };
  if (task.repeat === 'ONCE' && task.target > 0) {
    const reached = count >= task.target;
    if (reached && task.doneAt === null) await db.task.update({ where: { id: taskId }, data: { doneAt: new Date() } });
    if (!reached && task.doneAt !== null) await db.task.update({ where: { id: taskId }, data: { doneAt: null } });
  }
  return { ok: true, count, target: task.target };
}
