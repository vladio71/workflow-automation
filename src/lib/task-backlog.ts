import 'server-only';
import { z } from 'zod';
import { db } from './db';
import { clampMinutes } from './plan-order';
import { clampTarget } from './task-sessions';
import type { Task, TaskRepeat, TaskStatus } from '@/generated/prisma/client';

/**
 * Беклог справ як у Jira. Колонки: BACKLOG → TODO → IN_PROGRESS → Done (doneAt).
 * У план дня йдуть лише TODO та IN_PROGRESS. BACKLOG лежить, поки не витягнеш.
 */

export const TASK_STATUSES: readonly TaskStatus[] = ['BACKLOG', 'TODO', 'IN_PROGRESS'];
export const TASK_REPEATS: readonly TaskRepeat[] = ['ONCE', 'DAILY', 'WEEKDAYS'];
export const MIN_PRIORITY = 1;
export const MAX_PRIORITY = 4;
export const MAX_TITLE = 200;
export const MAX_NOTES = 2000;

export const PRIORITY_LABEL: Record<number, string> = { 1: 'high', 2: 'med+', 3: 'med', 4: 'low' };

/** Статуси, при яких справа потрапляє в план дня. */
export const ACTIVE_STATUSES: readonly TaskStatus[] = ['TODO', 'IN_PROGRESS'];

export function clampPriority(value: number): number {
  if (!Number.isFinite(value)) return 3;
  return Math.min(MAX_PRIORITY, Math.max(MIN_PRIORITY, Math.round(value)));
}

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

/** "2026-10-19" -> ключ дня для колонки DATE (опівніч UTC) */
export function toDateKey(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

export const CreateTaskSchema = z.object({
  title: z.string().trim().min(1).max(MAX_TITLE),
  minutes: z.number().int().optional(),
  repeat: z.enum(['ONCE', 'DAILY', 'WEEKDAYS']).optional(),
  target: z.number().int().optional(),
  until: dateKey.nullable().optional(),
  status: z.enum(['BACKLOG', 'TODO', 'IN_PROGRESS']).optional(),
  priority: z.number().int().optional(),
  notes: z.string().max(MAX_NOTES).optional(),
});
export type CreateTaskInput = z.infer<typeof CreateTaskSchema>;

/** PATCH: усе необов'язкове; status: "DONE" ставить doneAt, будь-який інший статус його знімає */
export const UpdateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(MAX_TITLE),
    minutes: z.number().int(),
    repeat: z.enum(['ONCE', 'DAILY', 'WEEKDAYS']),
    target: z.number().int(),
    until: dateKey.nullable(),
    status: z.enum(['BACKLOG', 'TODO', 'IN_PROGRESS', 'DONE']),
    priority: z.number().int(),
    notes: z.string().max(MAX_NOTES),
  })
  .partial();
export type UpdateTaskInput = z.infer<typeof UpdateTaskSchema>;

export interface TaskJson {
  id: number;
  title: string;
  status: TaskStatus | 'DONE';
  priority: number;
  minutes: number;
  repeat: TaskRepeat;
  target: number;
  until: string | null;
  notes: string;
  doneAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function taskToJson(task: Task): TaskJson {
  return {
    id: task.id,
    title: task.title,
    status: task.doneAt !== null ? 'DONE' : task.status,
    priority: task.priority,
    minutes: task.minutes,
    repeat: task.repeat,
    target: task.target,
    until: task.until ? task.until.toISOString().slice(0, 10) : null,
    notes: task.notes,
    doneAt: task.doneAt ? task.doneAt.toISOString() : null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

export async function createBacklogTask(input: CreateTaskInput): Promise<Task> {
  return db.task.create({
    data: {
      title: input.title,
      minutes: clampMinutes(input.minutes ?? 30),
      repeat: input.repeat ?? 'ONCE',
      target: clampTarget(input.target ?? 0),
      until: input.until ? toDateKey(input.until) : null,
      // повторювані справи одразу в роботі: беклог для них не має сенсу
      status: input.status ?? (input.repeat && input.repeat !== 'ONCE' ? 'TODO' : 'BACKLOG'),
      priority: clampPriority(input.priority ?? 3),
      notes: (input.notes ?? '').trim(),
    },
  });
}

export async function updateBacklogTask(id: number, input: UpdateTaskInput): Promise<Task | null> {
  const existing = await db.task.findUnique({ where: { id } });
  if (!existing) return null;
  const data: Parameters<typeof db.task.update>[0]['data'] = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.minutes !== undefined) data.minutes = clampMinutes(input.minutes);
  if (input.repeat !== undefined) data.repeat = input.repeat;
  if (input.target !== undefined) data.target = clampTarget(input.target);
  if (input.until !== undefined) data.until = input.until ? toDateKey(input.until) : null;
  if (input.priority !== undefined) data.priority = clampPriority(input.priority);
  if (input.notes !== undefined) data.notes = input.notes.trim();
  if (input.status !== undefined) {
    if (input.status === 'DONE') {
      data.doneAt = existing.doneAt ?? new Date();
    } else {
      data.status = input.status;
      data.doneAt = null;
    }
  }
  return db.task.update({ where: { id }, data });
}

export type TaskListFilter = { status?: TaskStatus | 'DONE' };

export async function listTasks(filter: TaskListFilter): Promise<Task[]> {
  const where = filter.status === 'DONE' ? { doneAt: { not: null } } : filter.status ? { status: filter.status, doneAt: null } : {};
  return db.task.findMany({ where, orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }] });
}

/** Наступна колонка для кнопки "→" на борді. IN_PROGRESS → done. */
export function nextStatus(status: TaskStatus): TaskStatus | 'DONE' {
  if (status === 'BACKLOG') return 'TODO';
  if (status === 'TODO') return 'IN_PROGRESS';
  return 'DONE';
}

export function prevStatus(status: TaskStatus): TaskStatus | null {
  if (status === 'IN_PROGRESS') return 'TODO';
  if (status === 'TODO') return 'BACKLOG';
  return null;
}
