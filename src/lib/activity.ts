import 'server-only';
import { db } from './db';
import { dayKey } from './queries';
import type { ActivityKind, Track } from '@/generated/prisma/enums';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface LogActivityInput {
  minutes: number;
  kind: ActivityKind;
  topicId: number | null;
  track: Track | null;
  note: string;
  at?: Date;
}

/** One time entry. The track is taken from the topic when one is given. */
export async function logActivity(input: LogActivityInput): Promise<void> {
  const minutes = Math.round(input.minutes);
  if (minutes <= 0) return;
  let track = input.track;
  if (input.topicId !== null && track === null) {
    const topic = await db.topic.findUnique({ where: { id: input.topicId }, select: { track: true } });
    track = topic?.track ?? null;
  }
  await db.activityLog.create({
    data: {
      day: dayKey(input.at ?? new Date()),
      minutes: Math.min(minutes, 12 * 60),
      kind: input.kind,
      topicId: input.topicId,
      track,
      note: input.note.trim(),
    },
  });
}

// ------------------------------------------------------------------ streak

/** Day key (YYYY-MM-DD) from a DATE column, which holds midnight UTC. */
function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export interface Streak {
  current: number;
  best: number;
  activeToday: boolean;
}

/**
 * Active day = at least one time entry or one tick in the daily checklist.
 * The current streak does not break when nothing is done yet today: it is counted up to yesterday.
 */
export async function getStreak(now: Date = new Date()): Promise<Streak> {
  const [logDays, dailyDays, checkDays] = await Promise.all([
    db.activityLog.findMany({ distinct: ['day'], select: { day: true } }),
    db.dailyLog.findMany({
      where: { OR: [{ cardsDone: true }, { recallDone: true }, { outLoud: true }] },
      select: { day: true },
    }),
    // ticks of user-added Daily items
    db.dailyCheck.findMany({ distinct: ['day'], select: { day: true } }),
  ]);
  const days = new Set<string>([...logDays, ...dailyDays, ...checkDays].map((row) => isoDay(row.day)));

  const today = dayKey(now);
  const activeToday = days.has(isoDay(today));
  let cursor = activeToday ? today : new Date(today.getTime() - DAY_MS);
  let current = 0;
  while (days.has(isoDay(cursor))) {
    current++;
    cursor = new Date(cursor.getTime() - DAY_MS);
  }

  const sorted = [...days].sort();
  let best = 0;
  let run = 0;
  let previous: number | null = null;
  for (const day of sorted) {
    const time = new Date(`${day}T00:00:00Z`).getTime();
    run = previous !== null && time - previous === DAY_MS ? run + 1 : 1;
    best = Math.max(best, run);
    previous = time;
  }
  return { current, best: Math.max(best, current), activeToday };
}

// ------------------------------------------------------------------ analytics

export interface DayMinutes {
  day: string;
  minutes: number;
}

export interface NamedMinutes {
  id: string;
  label: string;
  minutes: number;
}

export interface Analytics {
  streak: Streak;
  totalMinutes: number;
  weekMinutes: number;
  todayMinutes: number;
  activeDays: number;
  recalls: number;
  greenRecalls: number;
  questions: number;
  mocks: number;
  /** last N days, oldest to today, zeros for empty days */
  daily: DayMinutes[];
  byTrack: NamedMinutes[];
  byTopic: NamedMinutes[];
  byKind: NamedMinutes[];
}

export async function getAnalytics(days: number, now: Date = new Date()): Promise<Analytics> {
  const today = dayKey(now);
  const from = new Date(today.getTime() - (days - 1) * DAY_MS);
  const weekFrom = new Date(today.getTime() - 6 * DAY_MS);

  const [streak, logs, recalls, greenRecalls, questions, mocks, activeDays] = await Promise.all([
    getStreak(now),
    db.activityLog.findMany({ include: { topic: { select: { id: true, name: true } } } }),
    db.recallLog.count(),
    db.recallLog.count({ where: { confidenceAfter: 'GREEN' } }),
    db.question.count(),
    db.mockSession.count(),
    db.activityLog.findMany({ distinct: ['day'], select: { day: true } }),
  ]);

  const perDay = new Map<string, number>();
  const perTrack = new Map<string, number>();
  const perTopic = new Map<string, { label: string; minutes: number }>();
  const perKind = new Map<string, number>();
  let totalMinutes = 0;
  let weekMinutes = 0;
  let todayMinutes = 0;

  for (const log of logs) {
    totalMinutes += log.minutes;
    if (log.day >= weekFrom) weekMinutes += log.minutes;
    if (log.day.getTime() === today.getTime()) todayMinutes += log.minutes;
    if (log.day >= from) perDay.set(isoDay(log.day), (perDay.get(isoDay(log.day)) ?? 0) + log.minutes);
    const track = log.track ?? 'OTHER';
    perTrack.set(track, (perTrack.get(track) ?? 0) + log.minutes);
    perKind.set(log.kind, (perKind.get(log.kind) ?? 0) + log.minutes);
    const topicKey = log.topic ? String(log.topic.id) : 'none';
    const topicLabel = log.topic?.name ?? 'Without topic';
    const current = perTopic.get(topicKey) ?? { label: topicLabel, minutes: 0 };
    perTopic.set(topicKey, { label: topicLabel, minutes: current.minutes + log.minutes });
  }

  const daily: DayMinutes[] = [];
  for (let i = 0; i < days; i++) {
    const day = isoDay(new Date(from.getTime() + i * DAY_MS));
    daily.push({ day, minutes: perDay.get(day) ?? 0 });
  }

  const sortDesc = (items: NamedMinutes[]): NamedMinutes[] => items.sort((a, b) => b.minutes - a.minutes);

  return {
    streak,
    totalMinutes,
    weekMinutes,
    todayMinutes,
    activeDays: activeDays.length,
    recalls,
    greenRecalls,
    questions,
    mocks,
    daily,
    byTrack: sortDesc([...perTrack].map(([id, minutes]) => ({ id, label: id, minutes }))),
    byTopic: sortDesc([...perTopic].map(([id, value]) => ({ id, label: value.label, minutes: value.minutes }))),
    byKind: sortDesc([...perKind].map(([id, minutes]) => ({ id, label: id, minutes }))),
  };
}

export async function getRecentLogs(limit: number) {
  return db.activityLog.findMany({ orderBy: [{ day: 'desc' }, { createdAt: 'desc' }], take: limit, include: { topic: { select: { id: true, name: true } } } });
}

export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}
