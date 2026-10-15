import 'server-only';
import { z } from 'zod';
import { db } from './db';
import { dayKey, getActiveCycle, getDueTopics, getNextSystemDesignTopic, getTodayLog } from './queries';
import { endOfDay, startOfDay } from './schedule';
import {
  FOCUS_BUDGET_SHARE, REDO_MINUTES, getStudyPlans, problemTopicIds, selectToday, stepHref, todayLimits, type FocusRole,
} from './study-plan';
import { getCardQueue } from './cards';
import { getLevelsWithProgress, type LevelWithProgress } from './levels';
import { LEVELS_FOCUS, NO_FOCUS, planFocus } from './day-focus';
import { pickMandatory, toPlanItem } from './plan-order';
import { todayTickCounts, type TaskProgress } from './task-sessions';

/**
 * План дня. Принцип: AI НЕ вигадує, що вчити. Кандидати беруться з твоїх даних
 * (що прострочене, який цикл, навчальний план з репо, твої справи), а AI лише вибирає, впорядковує і пояснює.
 * Кроки навчального плану (PLAN) і переробки задач відбирає код, а не AI: вони обов'язкові і йдуть по порядку.
 * Повторювані справи (TASK) теж обов'язкові; разові AI пропонує, поки ти їх не зробиш.
 */
/** ANKI лишився тільки для старих планів у БД; нові плани мають CARDS. */
export type PlanItemKind = 'ANKI' | 'CARDS' | 'RECALL' | 'CYCLE' | 'QUESTIONS' | 'SYSTEM_DESIGN' | 'MOCK' | 'OUT_LOUD' | 'INBOX' | 'PLAN' | 'LEVEL' | 'TASK';

export interface PlanCandidate {
  id: string;
  kind: PlanItemKind;
  title: string;
  href: string;
  topicId: number | null;
  defaultMinutes: number;
  /** пояснення за замовчуванням (коли план без AI) */
  hint?: string;
  /** частина навчального плану на сьогодні або повторювана справа: AI не може її викинути */
  mandatory?: boolean;
  /** навчальний план, з якого пункт ("plan:<sourceId>"): кроки одного плану йдуть строго по порядку */
  group?: string;
  /** позиція кроку в плані (тільки PLAN) */
  order?: number;
}

export interface CandidateOptions {
  /** фокус дня: '' (нема), 'levels' або 'plan:<sourceId>', див. day-focus.ts */
  focus: string;
  /** бюджет дня в хвилинах: від нього рахується частка фокусу */
  budget: number;
}

export const DEFAULT_BUDGET = 300;
const DEFAULT_OPTIONS: CandidateOptions = { focus: NO_FOCUS, budget: DEFAULT_BUDGET };

export interface PlanItem extends PlanCandidate {
  minutes: number;
  why: string;
  /** позначив руками (для того, що апка не бачить сама) */
  manualDone: boolean;
}

export interface PlanItemWithStatus extends PlanItem {
  done: boolean;
  /** справа-сесія: скільки сьогодні з цілі (3/10); вузол закривається сам на цілі */
  progress?: TaskProgress;
  /** true = апка сама побачила виконання (recall, питання, mock), false = тільки ручна галочка */
  autoDone: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** рівні live-code на день: повтори в термін і нові по порядку */
const MAX_LEVEL_REDOS = 2;
const MAX_NEW_LEVELS = 2;
/** день з фокусом на live-code: рівні беруть до ~60% бюджету (вправи по 15-30 хв, тож нових до 6) */
const MAX_FOCUS_LEVEL_REDOS = 4;
const MAX_FOCUS_NEW_LEVELS = 6;

/** items лежать у БД як JSON: при читанні перевіряємо форму, а не кастимо наосліп. */
const PlanItemSchema = z.object({
  id: z.string(),
  kind: z.enum(['ANKI', 'CARDS', 'RECALL', 'CYCLE', 'QUESTIONS', 'SYSTEM_DESIGN', 'MOCK', 'OUT_LOUD', 'INBOX', 'PLAN', 'LEVEL', 'TASK']),
  title: z.string(),
  href: z.string(),
  topicId: z.number().nullable(),
  defaultMinutes: z.number(),
  minutes: z.number(),
  why: z.string(),
  manualDone: z.boolean(),
  hint: z.string().optional(),
  mandatory: z.boolean().optional(),
  group: z.string().optional(),
  order: z.number().optional(),
});

export function parsePlanItems(json: unknown): PlanItem[] {
  return z.array(PlanItemSchema).parse(json);
}

/** Повторювана справа сьогодні в плані? WEEKDAYS = пн-пт. */
function isTaskDueToday(repeat: 'ONCE' | 'DAILY' | 'WEEKDAYS', now: Date): boolean {
  if (repeat === 'DAILY') return true;
  if (repeat === 'WEEKDAYS') return now.getDay() >= 1 && now.getDay() <= 5;
  return false;
}

function daysSince(from: Date, now: Date): number {
  return Math.floor((startOfDay(now).getTime() - startOfDay(from).getTime()) / DAY_MS);
}

async function buildTaskCandidates(now: Date): Promise<{ recurring: PlanCandidate[]; once: PlanCandidate[] }> {
  // разова справа, зроблена сьогодні, лишається кандидатом: інакше перепланування ввечері її загубить.
  // Справа з кінцевою датою (until) після неї в план не йде.
  const tasks = await db.task.findMany({
    where: {
      AND: [
        { OR: [{ repeat: { not: 'ONCE' } }, { doneAt: null }, { doneAt: { gte: startOfDay(now) } }] },
        { OR: [{ until: null }, { until: { gte: dayKey(now) } }] },
      ],
    },
    orderBy: { createdAt: 'asc' },
  });
  const recurring: PlanCandidate[] = [];
  const once: PlanCandidate[] = [];
  for (const task of tasks) {
    const base = { id: `task:${task.id}`, kind: 'TASK' as const, title: task.title, href: '/tasks', topicId: null, defaultMinutes: task.minutes, group: 'tasks' };
    if (task.repeat === 'ONCE') {
      const days = daysSince(task.createdAt, now);
      once.push({ ...base, hint: days === 0 ? 'Разова справа, додана сьогодні.' : `Разова справа, висить ${days} дн.` });
    } else if (isTaskDueToday(task.repeat, now)) {
      const every = task.repeat === 'DAILY' ? 'Щоденна справа' : 'Справа по буднях';
      recurring.push({ ...base, hint: task.target > 0 ? `${every}, сесія: ${task.target} за день.` : `${every}.`, mandatory: true });
    }
  }
  return { recurring, once };
}

function levelCandidate(level: LevelWithProgress, redo: boolean): PlanCandidate {
  return {
    id: `level:${level.key}`,
    kind: 'LEVEL',
    title: redo ? `Level redo: ${level.title}` : `Level: ${level.title}`,
    href: `/levels/${level.key}`,
    topicId: null,
    defaultMinutes: level.minutes,
    hint: redo ? 'Настав термін повтору: та сама вправа з нуля, без еталону.' : `${level.groupTitle}: наступна вправа live-code по порядку.`,
  };
}

/**
 * Рівні live-code: спершу повтори, в яких настав термін, потім наступні нові вправи по порядку репо.
 * У день фокусу на live-code рівні обов'язкові, поки влазять у ~60% бюджету (повтори першими); решта лишається на вибір.
 */
function levelCandidates(levels: LevelWithProgress[], focused: boolean, budget: number): PlanCandidate[] {
  const redos = levels
    .filter((level) => level.progress.status === 'DUE' && !level.progress.passedToday)
    .sort((a, b) => (a.progress.dueAt?.getTime() ?? 0) - (b.progress.dueAt?.getTime() ?? 0))
    .slice(0, focused ? MAX_FOCUS_LEVEL_REDOS : MAX_LEVEL_REDOS)
    .map((level) => levelCandidate(level, true));
  const fresh = levels
    .filter((level) => level.progress.status === 'NEW')
    .slice(0, focused ? MAX_FOCUS_NEW_LEVELS : MAX_NEW_LEVELS)
    .map((level) => levelCandidate(level, false));
  const all = [...redos, ...fresh];
  if (!focused) return all;

  const limit = Math.round(budget * FOCUS_BUDGET_SHARE);
  let used = 0;
  return all.map((candidate, index) => {
    if (index > 0 && used + candidate.defaultMinutes > limit) return candidate;
    used += candidate.defaultMinutes;
    return { ...candidate, mandatory: true, group: LEVELS_FOCUS, hint: `Фокус дня · ${candidate.hint ?? ''}` };
  });
}

export async function buildCandidates(now: Date = new Date(), options: CandidateOptions = DEFAULT_OPTIONS): Promise<PlanCandidate[]> {
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const [due, cycle, sdTopic, inboxCount, lastMock, recentSdRecall, allStudyPlans, cardQueue, levelsState, tasks] = await Promise.all([
    getDueTopics(now),
    getActiveCycle(),
    getNextSystemDesignTopic(),
    db.inboxItem.count(),
    db.mockSession.findFirst({ orderBy: { startedAt: 'desc' } }),
    db.recallLog.findFirst({ where: { createdAt: { gte: weekAgo }, topic: { track: 'SYSTEM_DESIGN' } } }),
    getStudyPlans(),
    getCardQueue(now),
    getLevelsWithProgress(now),
    buildTaskCandidates(now),
  ]);
  // план у фокусі йде першим: його кроки першими займають бюджет, решта планів у залишок
  const isFocused = (sourceId: number): boolean => options.focus === planFocus(sourceId);
  const studyPlans = [...allStudyPlans].sort((a, b) => Number(isFocused(b.source.id)) - Number(isFocused(a.source.id)));

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

  // рівні live-code (у день фокусу на них обов'язкові і стоять перед кроками навчальних планів)
  candidates.push(...levelCandidates(levelsState.levels, options.focus === LEVELS_FOCUS, options.budget));

  // навчальний план: переробки задач і наступні кроки, відібрані кодом (обов'язкові)
  const problemIds = new Set<number>();
  // день з фокусом: решта планів ділить між собою те, що лишається після частки фокусу (~40%), по черзі;
  // кому не лишилось, той сьогодні відпочиває
  let otherMinutesLeft = Math.round(options.budget * (1 - FOCUS_BUDGET_SHARE));
  for (const plan of studyPlans) {
    for (const id of problemTopicIds(plan)) problemIds.add(id);
    const focused = isFocused(plan.source.id);
    const role: FocusRole = focused ? 'this' : options.focus === NO_FOCUS ? 'none' : 'other';
    if (role === 'other' && otherMinutesLeft <= 0) continue;
    const group = `plan:${plan.source.id}`;
    const limits = todayLimits(plan, role, options.budget);
    const { redos, steps } = selectToday(plan, due, now, role === 'other' ? { ...limits, minutes: Math.min(limits.minutes, otherMinutesLeft) } : limits);
    if (role === 'other') otherMinutesLeft -= redos.length * REDO_MINUTES + steps.reduce((sum, step) => sum + step.minutes, 0);
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
        group,
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
        hint: `${focused ? 'Фокус дня · ' : ''}${plan.source.planName} · ${step.group} · крок ${step.position + 1}/${plan.steps.length}`,
        mandatory: true,
        group,
        order: step.position,
      });
    }
  }

  // справи поза навчанням: повторювані обов'язкові, разові пропонуються, поки не зробиш (найстаріші першими)
  candidates.push(...tasks.recurring, ...tasks.once);

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
  const pick = (kind: PlanItemKind, limit: number): PlanCandidate[] =>
    candidates.filter((c) => c.kind === kind && c.mandatory !== true).slice(0, limit);
  const cards = pick('CARDS', 1);
  const tasks = candidates.filter((c) => c.mandatory === true && c.kind === 'TASK');
  const reserved = [...cards, ...tasks].reduce((sum, c) => sum + c.defaultMinutes, 0);
  // кроки планів по порядку (план у фокусі першим), поки влазять; не вліз крок, наступні цього плану теж ні
  const study = pickMandatory(candidates.filter((c) => c.mandatory === true && c.kind !== 'TASK'), minutesBudget - reserved);

  const items: PlanItem[] = [...cards, ...study, ...tasks].map(toPlanItem);
  let used = items.reduce((sum, item) => sum + item.minutes, 0);
  const optional = [
    ...pick('LEVEL', 2),
    ...pick('RECALL', 2),
    ...pick('CYCLE', 1),
    ...pick('QUESTIONS', 1),
    ...pick('SYSTEM_DESIGN', 1),
    ...pick('TASK', 1),
    ...pick('OUT_LOUD', 1),
  ];
  for (const candidate of optional) {
    const fits = used + candidate.defaultMinutes <= minutesBudget;
    if (!fits && items.length >= 3) continue;
    used += candidate.defaultMinutes;
    items.push(toPlanItem(candidate));
  }
  const summary = study.length > 0
    ? 'План за правилами (без AI): картки, кроки навчального плану по порядку, справи, повторення, решта в цикл.'
    : 'План за правилами (без AI): картки, справи, прострочені повторення, робота по циклу, system design.';
  return { items, summary };
}

/** Що апка бачить сама: recall-логи, нові питання, mock, чекліст дня. */
export async function withStatus(items: PlanItem[], now: Date = new Date()): Promise<PlanItemWithStatus[]> {
  const from = startOfDay(now);
  const to = endOfDay(now);
  const planStepIds = items.filter((item) => item.kind === 'PLAN').map((item) => Number(item.id.replace('plan:', '')));
  const taskIds = items.filter((item) => item.kind === 'TASK').map((item) => Number(item.id.replace('task:', '')));
  const [log, recalls, questions, mockToday, inboxCount, planSteps, levelPasses, tasks] = await Promise.all([
    getTodayLog(now),
    db.recallLog.findMany({ where: { createdAt: { gte: from, lte: to } }, select: { topicId: true } }),
    db.question.findMany({ where: { createdAt: { gte: from, lte: to } }, select: { topicId: true } }),
    db.mockSession.count({ where: { startedAt: { gte: from, lte: to } } }),
    db.inboxItem.count(),
    db.planStep.findMany({ where: { id: { in: planStepIds } } }),
    db.levelAttempt.findMany({ where: { passed: true, createdAt: { gte: from, lte: to } }, select: { levelKey: true } }),
    db.task.findMany({ where: { id: { in: taskIds } } }),
  ]);
  const tickCounts = await todayTickCounts(tasks.filter((task) => task.target > 0).map((task) => task.id), now);
  const passedLevels = new Set(levelPasses.map((attempt) => attempt.levelKey));
  const recalled = new Set(recalls.map((r) => r.topicId));
  const stepById = new Map(planSteps.map((step) => [step.id, step]));
  const taskById = new Map(tasks.map((task) => [task.id, task]));
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
      case 'LEVEL': autoDone = passedLevels.has(item.id.replace('level:', '')); break;
      case 'PLAN': {
        // прогрес кроку живе в PlanStep: галочка тут, на сторінці плану або автоматично після спроби задачі
        const step = stepById.get(Number(item.id.replace('plan:', '')));
        if (step) {
          const attemptDone = step.kind === 'ATTEMPT' && recalled.has(topicId);
          return { ...item, autoDone: attemptDone, done: step.doneAt !== null || attemptDone };
        }
        break;
      }
      case 'TASK': {
        // разову справу можна закрити і на сторінці Tasks; справа-сесія закривається сама, коли дійшла до цілі
        const task = taskById.get(Number(item.id.replace('task:', '')));
        const closedOnce = task !== undefined && task.repeat === 'ONCE' && task.doneAt !== null;
        if (task && task.target > 0) {
          const progress: TaskProgress = { count: tickCounts.get(task.id) ?? 0, target: task.target };
          const reached = progress.count >= progress.target;
          return { ...item, progress, autoDone: reached, done: reached || item.manualDone || closedOnce };
        }
        return { ...item, autoDone: false, done: item.manualDone || closedOnce };
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
