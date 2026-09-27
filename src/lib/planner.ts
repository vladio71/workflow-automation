import 'server-only';
import { z } from 'zod';
import { db } from './db';
import { dayKey, getActiveCycle, getDueTopics, getNextSystemDesignTopic, getTodayLog } from './queries';
import { endOfDay, startOfDay } from './schedule';

/**
 * План дня. Принцип: AI НЕ вигадує, що вчити. Кандидати беруться з твоїх даних
 * (що прострочене, який цикл, коли був mock), а AI лише вибирає, впорядковує і пояснює.
 */
export type PlanItemKind = 'ANKI' | 'RECALL' | 'CYCLE' | 'QUESTIONS' | 'SYSTEM_DESIGN' | 'MOCK' | 'OUT_LOUD' | 'INBOX';

export interface PlanCandidate {
  id: string;
  kind: PlanItemKind;
  title: string;
  href: string;
  topicId: number | null;
  defaultMinutes: number;
}

export interface PlanItem extends PlanCandidate {
  minutes: number;
  why: string;
  /** позначив руками (для того, що апка не бачить сама) */
  manualDone: boolean;
}

export interface PlanItemWithStatus extends PlanItem {
  done: boolean;
  /** true = апка сама побачила виконання (recall, питання, mock), false = тільки ручна галочка */
  autoDone: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** items лежать у БД як JSON: при читанні перевіряємо форму, а не кастимо наосліп. */
const PlanItemSchema = z.object({
  id: z.string(),
  kind: z.enum(['ANKI', 'RECALL', 'CYCLE', 'QUESTIONS', 'SYSTEM_DESIGN', 'MOCK', 'OUT_LOUD', 'INBOX']),
  title: z.string(),
  href: z.string(),
  topicId: z.number().nullable(),
  defaultMinutes: z.number(),
  minutes: z.number(),
  why: z.string(),
  manualDone: z.boolean(),
});

export function parsePlanItems(json: unknown): PlanItem[] {
  return z.array(PlanItemSchema).parse(json);
}

export async function buildCandidates(now: Date = new Date()): Promise<PlanCandidate[]> {
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const [due, cycle, sdTopic, inboxCount, lastMock, recentSdRecall] = await Promise.all([
    getDueTopics(now),
    getActiveCycle(),
    getNextSystemDesignTopic(),
    db.inboxItem.count(),
    db.mockSession.findFirst({ orderBy: { startedAt: 'desc' } }),
    db.recallLog.findFirst({ where: { createdAt: { gte: weekAgo }, topic: { track: 'SYSTEM_DESIGN' } } }),
  ]);

  const candidates: PlanCandidate[] = [
    { id: 'anki', kind: 'ANKI', title: 'Anki: 10-15 cards', href: '/', topicId: null, defaultMinutes: 10 },
    { id: 'out-loud', kind: 'OUT_LOUD', title: 'Explain 1 question out loud in a minute', href: '/questions', topicId: null, defaultMinutes: 5 },
  ];

  for (const topic of due.slice(0, 6)) {
    candidates.push({
      id: `recall:${topic.id}`,
      kind: 'RECALL',
      title: `Recall: ${topic.name}`,
      href: `/recall/${topic.id}`,
      topicId: topic.id,
      defaultMinutes: 15,
    });
  }

  if (cycle) {
    const cycleTopics = await db.topic.findMany({
      where: { cycleId: cycle.id, confidence: { not: 'GREEN' } },
      include: { _count: { select: { questions: true } } },
      orderBy: { id: 'asc' },
    });
    for (const topic of cycleTopics) {
      candidates.push({
        id: `cycle:${topic.id}`,
        kind: 'CYCLE',
        title: `Cycle ${cycle.number}: work on "${topic.name}" (${topic.drill || 'build the drill'})`,
        href: `/topics/${topic.id}`,
        topicId: topic.id,
        defaultMinutes: 60,
      });
      if (topic._count.questions < 3) {
        candidates.push({
          id: `questions:${topic.id}`,
          kind: 'QUESTIONS',
          title: `Write 3-5 questions for "${topic.name}" (closed book)`,
          href: `/topics/${topic.id}`,
          topicId: topic.id,
          defaultMinutes: 15,
        });
      }
    }
  }

  if (sdTopic && !recentSdRecall) {
    candidates.push({
      id: `sd:${sdTopic.id}`,
      kind: 'SYSTEM_DESIGN',
      title: `System design primer: ${sdTopic.name.replace(/^SD /, '')}`,
      href: `/topics/${sdTopic.id}`,
      topicId: sdTopic.id,
      defaultMinutes: 45,
    });
  }

  if (!lastMock || lastMock.startedAt < weekAgo) {
    candidates.push({ id: 'mock', kind: 'MOCK', title: 'System design mock, 45 min', href: '/mock', topicId: null, defaultMinutes: 45 });
  }

  if (inboxCount >= 5 || (inboxCount > 0 && now.getDay() === 0)) {
    candidates.push({ id: 'inbox', kind: 'INBOX', title: `Clear the Inbox (${inboxCount})`, href: '/inbox', topicId: null, defaultMinutes: 10 });
  }

  return candidates;
}

/** План без AI (нема ключа або Gemini впав): прості правила. */
export function rulePlan(candidates: PlanCandidate[], minutesBudget: number): { items: PlanItem[]; summary: string } {
  const pick = (kind: PlanItemKind, limit: number): PlanCandidate[] => candidates.filter((c) => c.kind === kind).slice(0, limit);
  const ordered = [
    ...pick('ANKI', 1),
    ...pick('RECALL', 2),
    ...pick('CYCLE', 1),
    ...pick('QUESTIONS', 1),
    ...pick('SYSTEM_DESIGN', 1),
    ...pick('OUT_LOUD', 1),
  ];
  const items: PlanItem[] = [];
  let used = 0;
  for (const candidate of ordered) {
    if (used + candidate.defaultMinutes > minutesBudget && items.length >= 3) continue;
    used += candidate.defaultMinutes;
    items.push({ ...candidate, minutes: candidate.defaultMinutes, why: '', manualDone: false });
  }
  return { items, summary: 'План за правилами (без AI): Anki, прострочені повторення, робота по циклу, system design.' };
}

/** Що апка бачить сама: recall-логи, нові питання, mock, чекліст дня. */
export async function withStatus(items: PlanItem[], now: Date = new Date()): Promise<PlanItemWithStatus[]> {
  const from = startOfDay(now);
  const to = endOfDay(now);
  const [log, recalls, questions, mockToday, inboxCount] = await Promise.all([
    getTodayLog(now),
    db.recallLog.findMany({ where: { createdAt: { gte: from, lte: to } }, select: { topicId: true } }),
    db.question.findMany({ where: { createdAt: { gte: from, lte: to } }, select: { topicId: true } }),
    db.mockSession.count({ where: { startedAt: { gte: from, lte: to } } }),
    db.inboxItem.count(),
  ]);
  const recalled = new Set(recalls.map((r) => r.topicId));
  const questionsByTopic = new Map<number, number>();
  for (const q of questions) if (q.topicId) questionsByTopic.set(q.topicId, (questionsByTopic.get(q.topicId) ?? 0) + 1);

  return items.map((item) => {
    const topicId = item.topicId ?? -1;
    let autoDone = false;
    switch (item.kind) {
      case 'ANKI': autoDone = log.ankiDone; break;
      case 'OUT_LOUD': autoDone = log.outLoud; break;
      case 'RECALL': autoDone = recalled.has(topicId); break;
      case 'QUESTIONS': autoDone = (questionsByTopic.get(topicId) ?? 0) >= 3; break;
      case 'CYCLE':
      // робота над темою = recall або нові питання до неї; просте редагування (колір, назва) не рахується
      case 'SYSTEM_DESIGN': autoDone = recalled.has(topicId) || questionsByTopic.has(topicId); break;
      case 'MOCK': autoDone = mockToday > 0; break;
      case 'INBOX': autoDone = inboxCount === 0; break;
    }
    return { ...item, autoDone, done: autoDone || item.manualDone };
  });
}

export async function getTodayPlan(now: Date = new Date()) {
  const plan = await db.dailyPlan.findUnique({ where: { day: dayKey(now) } });
  if (!plan) return null;
  const items = await withStatus(parsePlanItems(plan.items), now);
  return { ...plan, items };
}

/** Факти для вечірнього огляду: що повторив і з яким кольором. */
export async function todayRecallSummary(now: Date = new Date()): Promise<string[]> {
  const recalls = await db.recallLog.findMany({
    where: { createdAt: { gte: startOfDay(now), lte: endOfDay(now) } },
    include: { topic: true },
    orderBy: { createdAt: 'asc' },
  });
  return recalls.map((r) => `${r.topic.name}: ${r.confidenceAfter}`);
}
