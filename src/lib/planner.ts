import 'server-only';
import { z } from 'zod';
import { db } from './db';
import { dayKey, getActiveCycle, getDueTopics, getNextSystemDesignTopic, getTodayLog } from './queries';
import { endOfDay, startOfDay } from './schedule';
import { REDO_MINUTES, getStudyPlans, problemTopicIds, selectToday, stepHref } from './study-plan';
import { getCardQueue } from './cards';

/**
 * План дня. Принцип: AI НЕ вигадує, що вчити. Кандидати беруться з твоїх даних
 * (що прострочене, який цикл, навчальний план з репо), а AI лише вибирає, впорядковує і пояснює.
 * Кроки навчального плану (PLAN) і переробки задач відбирає код, а не AI: вони обов'язкові і йдуть по порядку.
 */
/** ANKI лишився тільки для старих планів у БД; нові плани мають CARDS. */
export type PlanItemKind = 'ANKI' | 'CARDS' | 'RECALL' | 'CYCLE' | 'QUESTIONS' | 'SYSTEM_DESIGN' | 'MOCK' | 'OUT_LOUD' | 'INBOX' | 'PLAN';

export interface PlanCandidate {
  id: string;
  kind: PlanItemKind;
  title: string;
  href: string;
  topicId: number | null;
  defaultMinutes: number;
  /** пояснення за замовчуванням (коли план без AI) */
  hint?: string;
  /** частина навчального плану на сьогодні: AI не може її викинути чи переставити */
  mandatory?: boolean;
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
  kind: z.enum(['ANKI', 'CARDS', 'RECALL', 'CYCLE', 'QUESTIONS', 'SYSTEM_DESIGN', 'MOCK', 'OUT_LOUD', 'INBOX', 'PLAN']),
  title: z.string(),
  href: z.string(),
  topicId: z.number().nullable(),
  defaultMinutes: z.number(),
  minutes: z.number(),
  why: z.string(),
  manualDone: z.boolean(),
  hint: z.string().optional(),
  mandatory: z.boolean().optional(),
});

export function parsePlanItems(json: unknown): PlanItem[] {
  return z.array(PlanItemSchema).parse(json);
}

export async function buildCandidates(now: Date = new Date()): Promise<PlanCandidate[]> {
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const [due, cycle, sdTopic, inboxCount, lastMock, recentSdRecall, studyPlans, cardQueue] = await Promise.all([
    getDueTopics(now),
    getActiveCycle(),
    getNextSystemDesignTopic(),
    db.inboxItem.count(),
    db.mockSession.findFirst({ orderBy: { startedAt: 'desc' } }),
    db.recallLog.findFirst({ where: { createdAt: { gte: weekAgo }, topic: { track: 'SYSTEM_DESIGN' } } }),
    getStudyPlans(),
    getCardQueue(now),
  ]);

  const candidates: PlanCandidate[] = [];
  const cardsToday = cardQueue.due.length + cardQueue.fresh.length;
  if (cardsToday > 0) {
    // ~30 с на картку
    const parts = [
      cardQueue.due.length > 0 ? `${cardQueue.due.length} due` : '',
      cardQueue.fresh.length > 0 ? `${cardQueue.fresh.length} new` : '',
    ].filter((part) => part !== '');
    candidates.push({
      id: 'cards',
      kind: 'CARDS',
      title: `Cards: ${parts.join(' + ')}`,
      href: '/cards',
      topicId: null,
      defaultMinutes: Math.max(5, Math.ceil(cardsToday / 2)),
      hint: 'Картки, у яких настав термін, і кілька нових.',
    });
  }
  candidates.push(
    { id: 'out-loud', kind: 'OUT_LOUD', title: 'Explain 1 question out loud in a minute', href: '/cards?tab=all', topicId: null, defaultMinutes: 5 },
  );

  // навчальний план: переробки задач і наступні кроки, відібрані кодом (обов'язкові)
  const problemIds = new Set<number>();
  for (const plan of studyPlans) {
    for (const id of problemTopicIds(plan)) problemIds.add(id);
    const { redos, steps } = selectToday(plan, due, now);
    for (const topic of redos) {
      candidates.push({
        id: `recall:${topic.id}`,
        kind: 'RECALL',
        title: `Redo з нуля: ${topic.name}`,
        href: `/recall/${topic.id}`,
        topicId: topic.id,
        defaultMinutes: REDO_MINUTES,
        hint: 'Настав термін переробки: 45 хв з таймером, потім звір з минулою спробою.',
        mandatory: true,
      });
    }
    for (const step of steps) {
      candidates.push({
        id: `plan:${step.id}`,
        kind: 'PLAN',
        title: step.title,
        href: stepHref(plan, step),
        topicId: plan.topicByPath.get(step.topicPath)?.id ?? null,
        defaultMinutes: step.minutes,
        hint: `${plan.source.planName} · ${step.group} · крок ${step.position + 1}/${plan.steps.length}`,
        mandatory: true,
      });
    }
  }

  // задачі плану повторюються тільки як Redo (45 хв), не як звичайний 15-хвилинний recall
  for (const topic of due.filter((dueTopic) => !problemIds.has(dueTopic.id)).slice(0, 6)) {
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

  // старий ритм "system design раз на тиждень" і тижневий mock: тільки якщо навчального плану немає
  if (studyPlans.length === 0 && sdTopic && !recentSdRecall) {
    candidates.push({
      id: `sd:${sdTopic.id}`,
      kind: 'SYSTEM_DESIGN',
      title: `System design primer: ${sdTopic.name.replace(/^SD /, '')}`,
      href: `/topics/${sdTopic.id}`,
      topicId: sdTopic.id,
      defaultMinutes: 45,
    });
  }

  if (studyPlans.length === 0 && (!lastMock || lastMock.startedAt < weekAgo)) {
    candidates.push({ id: 'mock', kind: 'MOCK', title: 'System design mock, 45 min', href: '/mock', topicId: null, defaultMinutes: 45 });
  }

  if (inboxCount >= 5 || (inboxCount > 0 && now.getDay() === 0)) {
    candidates.push({ id: 'inbox', kind: 'INBOX', title: `Clear the Inbox (${inboxCount})`, href: '/inbox', topicId: null, defaultMinutes: 10 });
  }

  return candidates;
}

/** План без AI (нема ключа або Gemini впав): прості правила. */
export function rulePlan(candidates: PlanCandidate[], minutesBudget: number): { items: PlanItem[]; summary: string } {
  const mandatory = candidates.filter((c) => c.mandatory === true);
  const pick = (kind: PlanItemKind, limit: number): PlanCandidate[] =>
    candidates.filter((c) => c.kind === kind && c.mandatory !== true).slice(0, limit);
  const ordered = [
    ...pick('CARDS', 1),
    ...mandatory,
    ...pick('RECALL', 2),
    ...pick('CYCLE', 1),
    ...pick('QUESTIONS', 1),
    ...pick('SYSTEM_DESIGN', 1),
    ...pick('OUT_LOUD', 1),
  ];
  const items: PlanItem[] = [];
  let used = 0;
  let planCut = false;
  for (const candidate of ordered) {
    const fits = used + candidate.defaultMinutes <= minutesBudget;
    if (candidate.mandatory === true) {
      // кроки плану йдуть строго по порядку: не влізла один, наступні теж не беремо
      if (planCut || (!fits && items.length >= 3)) {
        planCut = true;
        continue;
      }
    } else if (!fits && items.length >= 3) {
      continue;
    }
    used += candidate.defaultMinutes;
    items.push({ ...candidate, minutes: candidate.defaultMinutes, why: candidate.hint ?? '', manualDone: false });
  }
  const summary = mandatory.length > 0
    ? 'План за правилами (без AI): картки, кроки навчального плану по порядку, повторення, решта в цикл.'
    : 'План за правилами (без AI): картки, прострочені повторення, робота по циклу, system design.';
  return { items, summary };
}

/** Що апка бачить сама: recall-логи, нові питання, mock, чекліст дня. */
export async function withStatus(items: PlanItem[], now: Date = new Date()): Promise<PlanItemWithStatus[]> {
  const from = startOfDay(now);
  const to = endOfDay(now);
  const planStepIds = items.filter((item) => item.kind === 'PLAN').map((item) => Number(item.id.replace('plan:', '')));
  const [log, recalls, questions, mockToday, inboxCount, planSteps] = await Promise.all([
    getTodayLog(now),
    db.recallLog.findMany({ where: { createdAt: { gte: from, lte: to } }, select: { topicId: true } }),
    db.question.findMany({ where: { createdAt: { gte: from, lte: to } }, select: { topicId: true } }),
    db.mockSession.count({ where: { startedAt: { gte: from, lte: to } } }),
    db.inboxItem.count(),
    db.planStep.findMany({ where: { id: { in: planStepIds } } }),
  ]);
  const recalled = new Set(recalls.map((r) => r.topicId));
  const stepById = new Map(planSteps.map((step) => [step.id, step]));
  const questionsByTopic = new Map<number, number>();
  for (const q of questions) if (q.topicId) questionsByTopic.set(q.topicId, (questionsByTopic.get(q.topicId) ?? 0) + 1);

  return items.map((item) => {
    const topicId = item.topicId ?? -1;
    let autoDone = false;
    switch (item.kind) {
      case 'ANKI':
      case 'CARDS': autoDone = log.cardsDone; break;
      case 'OUT_LOUD': autoDone = log.outLoud; break;
      case 'RECALL': autoDone = recalled.has(topicId); break;
      case 'QUESTIONS': autoDone = (questionsByTopic.get(topicId) ?? 0) >= 3; break;
      case 'CYCLE':
      // робота над темою = recall або нові питання до неї; просте редагування (колір, назва) не рахується
      case 'SYSTEM_DESIGN': autoDone = recalled.has(topicId) || questionsByTopic.has(topicId); break;
      case 'MOCK': autoDone = mockToday > 0; break;
      case 'INBOX': autoDone = inboxCount === 0; break;
      case 'PLAN': {
        // прогрес кроку живе в PlanStep: галочка тут, на сторінці плану або автоматично після спроби задачі
        const step = stepById.get(Number(item.id.replace('plan:', '')));
        if (step) {
          const attemptDone = step.kind === 'ATTEMPT' && recalled.has(topicId);
          return { ...item, autoDone: attemptDone, done: step.doneAt !== null || attemptDone };
        }
        break;
      }
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
