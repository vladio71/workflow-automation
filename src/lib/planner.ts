import 'server-only';
import { z } from 'zod';
import type { PlanStep, Topic } from '@/generated/prisma/client';
import { db } from './db';
import { dayKey, getActiveCycle, getDueTopics, getNextSystemDesignTopic, getTodayLog, type CycleWithProgress } from './queries';
import { endOfDay, startOfDay } from './schedule';
import {
  FOCUS_BUDGET_SHARE, REDO_MINUTES, getStudyPlans, problemTopicIds, selectToday, stepHref, todayLimits,
  type FocusRole, type StudyPlan,
} from './study-plan';
import { getCardQueue, type CardQueue } from './cards';
import { getLevelsWithProgress, type LevelWithProgress } from './levels';
import { LEVELS_FOCUS, NO_FOCUS, planFocus } from './day-focus';
import { pickMandatory, toPlanItem } from './plan-order';
import { todayTickCounts, type TaskProgress } from './task-sessions';

/**
 * Daily plan.
 *
 * The LLM never decides *what* to work on. Candidates come from the user's own data
 * (overdue reviews, the active cycle, study plans synced from Git, their tasks); the model only
 * picks, orders and explains. Study-plan steps (PLAN) and problem redos are selected by code and
 * are mandatory, in order. Recurring tasks (TASK) are mandatory too; one-off tasks are offered
 * until they are done.
 *
 * Reading order: types, `buildCandidates` (what could go into today), `rulePlan` (a plan without
 * the LLM), `withStatus` (what is already done), then the stored-plan helpers.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/** ANKI is kept only for plans already stored in the DB; new plans use CARDS. */
export type PlanItemKind = 'ANKI' | 'CARDS' | 'RECALL' | 'CYCLE' | 'QUESTIONS' | 'SYSTEM_DESIGN' | 'MOCK' | 'OUT_LOUD' | 'INBOX' | 'PLAN' | 'LEVEL' | 'TASK';

export interface PlanCandidate {
  id: string;
  kind: PlanItemKind;
  title: string;
  href: string;
  topicId: number | null;
  defaultMinutes: number;
  /** Default explanation, used when the plan is built without the LLM. */
  hint?: string;
  /** Part of today's study plan or a recurring task: the LLM cannot drop it. */
  mandatory?: boolean;
  /** Study plan this item belongs to ("plan:<sourceId>"); steps of one plan keep their order. */
  group?: string;
  /** Step position within its plan (PLAN only). */
  order?: number;
}

export interface CandidateOptions {
  /** Focus of the day: '' (none), 'levels' or 'plan:<sourceId>', see day-focus.ts. */
  focus: string;
  /** Day budget in minutes; the focus share is derived from it. */
  budget: number;
}

export const DEFAULT_BUDGET = 300;
const DEFAULT_OPTIONS: CandidateOptions = { focus: NO_FOCUS, budget: DEFAULT_BUDGET };

export interface PlanItem extends PlanCandidate {
  minutes: number;
  why: string;
  /** Ticked by hand, for items the app cannot detect on its own. */
  manualDone: boolean;
}

export interface PlanItemWithStatus extends PlanItem {
  done: boolean;
  /** Session task: today's count against the target (3/10); closes itself when the target is reached. */
  progress?: TaskProgress;
  /** true = the app detected completion itself (recall, questions, mock); false = manual tick only. */
  autoDone: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Live-code levels per day: due redos first, then new ones in repo order. */
const MAX_LEVEL_REDOS = 2;
const MAX_NEW_LEVELS = 2;
/** On a live-code focus day levels may take ~60% of the budget (15-30 min each, so up to 6 new). */
const MAX_FOCUS_LEVEL_REDOS = 4;
const MAX_FOCUS_NEW_LEVELS = 6;

const MAX_PLAIN_RECALLS = 6;
const RECALL_MINUTES = 15;
const CYCLE_MINUTES = 60;
const QUESTIONS_MINUTES = 15;
const MIN_QUESTIONS_PER_TOPIC = 3;
const INBOX_ALERT_COUNT = 5;

// ─── Building today's candidates ─────────────────────────────────────────────

/** A topic of the active cycle that still needs work. */
interface CycleTopic {
  id: number;
  name: string;
  drill: string | null;
  questionCount: number;
}

/** Everything `buildCandidates` needs, loaded once up front. */
interface TodayData {
  now: Date;
  weekAgo: Date;
  dueTopics: Topic[];
  cycle: CycleWithProgress | null;
  cycleTopics: CycleTopic[];
  systemDesignTopic: Topic | null;
  recalledSystemDesignThisWeek: boolean;
  lastMockAt: Date | null;
  inboxCount: number;
  /** Focused plan first: its steps take the budget before the other plans. */
  studyPlans: StudyPlan[];
  /** Topic ids of study-plan problems; they repeat only as redos, never as plain recalls. */
  problemTopicIds: Set<number>;
  cardQueue: CardQueue;
  levels: LevelWithProgress[];
  recurringTasks: PlanCandidate[];
  onceTasks: PlanCandidate[];
}

export async function buildCandidates(now: Date = new Date(), options: CandidateOptions = DEFAULT_OPTIONS): Promise<PlanCandidate[]> {
  const data = await gatherTodayData(now, options);
  return [
    ...cardCandidates(data),
    outLoudCandidate(),
    ...levelCandidates(data.levels, options.focus === LEVELS_FOCUS, options.budget),
    ...studyPlanCandidates(data, options),
    ...data.recurringTasks,
    ...data.onceTasks,
    ...plainRecallCandidates(data),
    ...cycleCandidates(data),
    ...legacyRhythmCandidates(data),
    ...inboxCandidate(data),
  ];
}

async function gatherTodayData(now: Date, options: CandidateOptions): Promise<TodayData> {
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const [dueTopics, cycle, systemDesignTopic, inboxCount, lastMock, recentSystemDesignRecall, allStudyPlans, cardQueue, levelsState, tasks] = await Promise.all([
    getDueTopics(now),
    getActiveCycle(),
    getNextSystemDesignTopic(),
    db.inboxItem.count(),
    db.mockSession.findFirst({ orderBy: { startedAt: 'desc' } }),
    db.recallLog.findFirst({ where: { createdAt: { gte: weekAgo }, topic: { track: 'SYSTEM_DESIGN' } } }),
    getStudyPlans(),
    getCardQueue(now),
    getLevelsWithProgress(now),
    loadTaskCandidates(now),
  ]);

  const isFocused = (plan: StudyPlan): boolean => options.focus === planFocus(plan.source.id);
  const studyPlans = [...allStudyPlans].sort((a, b) => Number(isFocused(b)) - Number(isFocused(a)));
  const problemIds = new Set<number>();
  for (const plan of studyPlans) for (const id of problemTopicIds(plan)) problemIds.add(id);

  return {
    now,
    weekAgo,
    dueTopics,
    cycle,
    cycleTopics: cycle ? await loadCycleTopics(cycle.id) : [],
    systemDesignTopic,
    recalledSystemDesignThisWeek: recentSystemDesignRecall !== null,
    lastMockAt: lastMock?.startedAt ?? null,
    inboxCount,
    studyPlans,
    problemTopicIds: problemIds,
    cardQueue,
    levels: levelsState.levels,
    recurringTasks: tasks.recurring,
    onceTasks: tasks.once,
  };
}

async function loadCycleTopics(cycleId: number): Promise<CycleTopic[]> {
  const topics = await db.topic.findMany({
    where: { cycleId, confidence: { not: 'GREEN' } },
    include: { _count: { select: { questions: true } } },
    orderBy: { id: 'asc' },
  });
  return topics.map((topic) => ({ id: topic.id, name: topic.name, drill: topic.drill, questionCount: topic._count.questions }));
}

/** Is a recurring task due today? WEEKDAYS = Mon-Fri. */
function isTaskDueToday(repeat: 'ONCE' | 'DAILY' | 'WEEKDAYS', now: Date): boolean {
  if (repeat === 'DAILY') return true;
  if (repeat === 'WEEKDAYS') return now.getDay() >= 1 && now.getDay() <= 5;
  return false;
}

function daysSince(from: Date, now: Date): number {
  return Math.floor((startOfDay(now).getTime() - startOfDay(from).getTime()) / DAY_MS);
}

async function loadTaskCandidates(now: Date): Promise<{ recurring: PlanCandidate[]; once: PlanCandidate[] }> {
  // A one-off task done today stays a candidate, otherwise an evening re-plan would lose it.
  // A task with an end date (until) is not planned after that date.
  const tasks = await db.task.findMany({
    where: {
      AND: [
        // Backlog items are not planned until pulled into TODO.
        { status: { in: ['TODO', 'IN_PROGRESS'] } },
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

function cardCandidates(data: TodayData): PlanCandidate[] {
  const cardsToday = data.cardQueue.due.length + data.cardQueue.fresh.length;
  if (cardsToday === 0) return [];
  const parts = [
    data.cardQueue.due.length > 0 ? `${data.cardQueue.due.length} due` : '',
    data.cardQueue.fresh.length > 0 ? `${data.cardQueue.fresh.length} new` : '',
  ].filter((part) => part !== '');
  return [{
    id: 'cards',
    kind: 'CARDS',
    title: `Cards: ${parts.join(' + ')}`,
    href: '/cards',
    topicId: null,
    // ~30 s per card
    defaultMinutes: Math.max(5, Math.ceil(cardsToday / 2)),
    hint: 'Картки, у яких настав термін, і кілька нових.',
  }];
}

function outLoudCandidate(): PlanCandidate {
  return { id: 'out-loud', kind: 'OUT_LOUD', title: 'Explain 1 question out loud in a minute', href: '/cards?tab=all', topicId: null, defaultMinutes: 5 };
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
 * Live-code levels: due redos first, then the next new exercises in repo order.
 * On a live-code focus day they are mandatory while they fit in ~60% of the budget (redos first);
 * the rest stays optional.
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

/**
 * Study plans: problem redos and next steps, selected by code, all mandatory.
 * On a focus day the other plans share what is left after the focus share (~40%), in turn;
 * a plan that gets nothing rests today.
 */
function studyPlanCandidates(data: TodayData, options: CandidateOptions): PlanCandidate[] {
  const candidates: PlanCandidate[] = [];
  let otherMinutesLeft = Math.round(options.budget * (1 - FOCUS_BUDGET_SHARE));
  for (const plan of data.studyPlans) {
    const focused = options.focus === planFocus(plan.source.id);
    const role: FocusRole = focused ? 'this' : options.focus === NO_FOCUS ? 'none' : 'other';
    if (role === 'other' && otherMinutesLeft <= 0) continue;

    const limits = todayLimits(plan, role, options.budget);
    const { redos, steps } = selectToday(
      plan,
      data.dueTopics,
      data.now,
      role === 'other' ? { ...limits, minutes: Math.min(limits.minutes, otherMinutesLeft) } : limits,
    );
    if (role === 'other') otherMinutesLeft -= redos.length * REDO_MINUTES + steps.reduce((sum, step) => sum + step.minutes, 0);

    const group = `plan:${plan.source.id}`;
    for (const topic of redos) candidates.push(redoCandidate(topic, group));
    for (const step of steps) candidates.push(stepCandidate(plan, step, group, focused));
  }
  return candidates;
}

function redoCandidate(topic: Topic, group: string): PlanCandidate {
  return {
    id: `recall:${topic.id}`,
    kind: 'RECALL',
    title: `Redo з нуля: ${topic.name}`,
    href: `/recall/${topic.id}`,
    topicId: topic.id,
    defaultMinutes: REDO_MINUTES,
    hint: 'Настав термін переробки: 45 хв з таймером, потім звір з минулою спробою.',
    mandatory: true,
    group,
  };
}

function stepCandidate(plan: StudyPlan, step: PlanStep, group: string, focused: boolean): PlanCandidate {
  return {
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
  };
}

/** Overdue topics outside study plans. Plan problems repeat only as a 45-min redo, never as a 15-min recall. */
function plainRecallCandidates(data: TodayData): PlanCandidate[] {
  return data.dueTopics
    .filter((topic) => !data.problemTopicIds.has(topic.id))
    .slice(0, MAX_PLAIN_RECALLS)
    .map((topic) => ({
      id: `recall:${topic.id}`,
      kind: 'RECALL',
      title: `Recall: ${topic.name}`,
      href: `/recall/${topic.id}`,
      topicId: topic.id,
      defaultMinutes: RECALL_MINUTES,
    }));
}

function cycleCandidates(data: TodayData): PlanCandidate[] {
  const cycle = data.cycle;
  if (!cycle) return [];
  const candidates: PlanCandidate[] = [];
  for (const topic of data.cycleTopics) {
    candidates.push({
      id: `cycle:${topic.id}`,
      kind: 'CYCLE',
      title: `Cycle ${cycle.number}: work on "${topic.name}" (${topic.drill || 'build the drill'})`,
      href: `/topics/${topic.id}`,
      topicId: topic.id,
      defaultMinutes: CYCLE_MINUTES,
    });
    if (topic.questionCount < MIN_QUESTIONS_PER_TOPIC) {
      candidates.push({
        id: `questions:${topic.id}`,
        kind: 'QUESTIONS',
        title: `Write 3-5 questions for "${topic.name}" (closed book)`,
        href: `/topics/${topic.id}`,
        topicId: topic.id,
        defaultMinutes: QUESTIONS_MINUTES,
      });
    }
  }
  return candidates;
}

/** The older rhythm (weekly system design primer + weekly mock) applies only when there is no study plan. */
function legacyRhythmCandidates(data: TodayData): PlanCandidate[] {
  if (data.studyPlans.length > 0) return [];
  const candidates: PlanCandidate[] = [];
  if (data.systemDesignTopic && !data.recalledSystemDesignThisWeek) {
    candidates.push({
      id: `sd:${data.systemDesignTopic.id}`,
      kind: 'SYSTEM_DESIGN',
      title: `System design primer: ${data.systemDesignTopic.name.replace(/^SD /, '')}`,
      href: `/topics/${data.systemDesignTopic.id}`,
      topicId: data.systemDesignTopic.id,
      defaultMinutes: 45,
    });
  }
  if (data.lastMockAt === null || data.lastMockAt < data.weekAgo) {
    candidates.push({ id: 'mock', kind: 'MOCK', title: 'System design mock, 45 min', href: '/mock', topicId: null, defaultMinutes: 45 });
  }
  return candidates;
}

/** The inbox is planned when it piles up, or on Sunday when anything is in it. */
function inboxCandidate(data: TodayData): PlanCandidate[] {
  const sunday = data.now.getDay() === 0;
  if (data.inboxCount >= INBOX_ALERT_COUNT || (data.inboxCount > 0 && sunday)) {
    return [{ id: 'inbox', kind: 'INBOX', title: `Clear the Inbox (${data.inboxCount})`, href: '/inbox', topicId: null, defaultMinutes: 10 }];
  }
  return [];
}

// ─── A plan without the LLM ──────────────────────────────────────────────────

/** Plan without the LLM (no API key or every model failed): plain rules. */
export function rulePlan(candidates: PlanCandidate[], minutesBudget: number): { items: PlanItem[]; summary: string } {
  const reserved = reserveMandatory(candidates, minutesBudget);
  const items = fillWithOptional(reserved.items, candidates, minutesBudget);
  return { items, summary: ruleSummary(reserved.hasStudySteps) };
}

interface ReservedPlan {
  items: PlanItem[];
  hasStudySteps: boolean;
}

/** Cards, then study-plan steps in order (focused plan first) while they fit, then recurring tasks. */
function reserveMandatory(candidates: PlanCandidate[], minutesBudget: number): ReservedPlan {
  const cards = optionalOfKind(candidates, 'CARDS', 1);
  const tasks = candidates.filter((candidate) => candidate.mandatory === true && candidate.kind === 'TASK');
  const reservedMinutes = [...cards, ...tasks].reduce((sum, candidate) => sum + candidate.defaultMinutes, 0);
  // Once a step does not fit, the rest of that plan is skipped; other plans may still fit.
  const study = pickMandatory(candidates.filter((candidate) => candidate.mandatory === true && candidate.kind !== 'TASK'), minutesBudget - reservedMinutes);
  return { items: [...cards, ...study, ...tasks].map(toPlanItem), hasStudySteps: study.length > 0 };
}

/** Optional candidates in a fixed order of kinds; a plan keeps at least 3 items even over budget. */
function fillWithOptional(items: PlanItem[], candidates: PlanCandidate[], minutesBudget: number): PlanItem[] {
  const result = [...items];
  let used = result.reduce((sum, item) => sum + item.minutes, 0);
  const optional = [
    ...optionalOfKind(candidates, 'LEVEL', 2),
    ...optionalOfKind(candidates, 'RECALL', 2),
    ...optionalOfKind(candidates, 'CYCLE', 1),
    ...optionalOfKind(candidates, 'QUESTIONS', 1),
    ...optionalOfKind(candidates, 'SYSTEM_DESIGN', 1),
    ...optionalOfKind(candidates, 'TASK', 1),
    ...optionalOfKind(candidates, 'OUT_LOUD', 1),
  ];
  for (const candidate of optional) {
    const fits = used + candidate.defaultMinutes <= minutesBudget;
    if (!fits && result.length >= 3) continue;
    used += candidate.defaultMinutes;
    result.push(toPlanItem(candidate));
  }
  return result;
}

function optionalOfKind(candidates: PlanCandidate[], kind: PlanItemKind, limit: number): PlanCandidate[] {
  return candidates.filter((candidate) => candidate.kind === kind && candidate.mandatory !== true).slice(0, limit);
}

function ruleSummary(hasStudySteps: boolean): string {
  return hasStudySteps
    ? 'План за правилами (без AI): картки, кроки навчального плану по порядку, справи, повторення, решта в цикл.'
    : 'План за правилами (без AI): картки, справи, прострочені повторення, робота по циклу, system design.';
}

// ─── What is already done ────────────────────────────────────────────────────

interface PlanStepState {
  kind: string;
  doneAt: Date | null;
}

interface TaskState {
  repeat: string;
  doneAt: Date | null;
  target: number;
}

/** Today's evidence the app can see on its own: recall logs, new questions, mocks, passed levels, the day checklist. */
interface TodayEvidence {
  cardsDone: boolean;
  outLoudDone: boolean;
  recalledTopicIds: Set<number>;
  questionsByTopic: Map<number, number>;
  mockDone: boolean;
  inboxEmpty: boolean;
  passedLevelKeys: Set<string>;
  planStepById: Map<number, PlanStepState>;
  taskById: Map<number, TaskState>;
  tickCountByTask: Map<number, number>;
}

export async function withStatus(items: PlanItem[], now: Date = new Date()): Promise<PlanItemWithStatus[]> {
  const evidence = await loadTodayEvidence(items, now);
  return items.map((item) => markItem(item, evidence));
}

async function loadTodayEvidence(items: PlanItem[], now: Date): Promise<TodayEvidence> {
  const from = startOfDay(now);
  const to = endOfDay(now);
  const planStepIds = items.filter((item) => item.kind === 'PLAN').map((item) => numericId(item.id, 'plan:'));
  const taskIds = items.filter((item) => item.kind === 'TASK').map((item) => numericId(item.id, 'task:'));
  const [log, recalls, questions, mocksToday, inboxCount, planSteps, levelPasses, tasks] = await Promise.all([
    getTodayLog(now),
    db.recallLog.findMany({ where: { createdAt: { gte: from, lte: to } }, select: { topicId: true } }),
    db.question.findMany({ where: { createdAt: { gte: from, lte: to } }, select: { topicId: true } }),
    db.mockSession.count({ where: { startedAt: { gte: from, lte: to } } }),
    db.inboxItem.count(),
    db.planStep.findMany({ where: { id: { in: planStepIds } } }),
    db.levelAttempt.findMany({ where: { passed: true, createdAt: { gte: from, lte: to } }, select: { levelKey: true } }),
    db.task.findMany({ where: { id: { in: taskIds } } }),
  ]);
  const tickCountByTask = await todayTickCounts(tasks.filter((task) => task.target > 0).map((task) => task.id), now);

  const questionsByTopic = new Map<number, number>();
  for (const question of questions) {
    if (question.topicId) questionsByTopic.set(question.topicId, (questionsByTopic.get(question.topicId) ?? 0) + 1);
  }
  return {
    cardsDone: log.cardsDone,
    outLoudDone: log.outLoud,
    recalledTopicIds: new Set(recalls.map((recall) => recall.topicId)),
    questionsByTopic,
    mockDone: mocksToday > 0,
    inboxEmpty: inboxCount === 0,
    passedLevelKeys: new Set(levelPasses.map((attempt) => attempt.levelKey)),
    planStepById: new Map(planSteps.map((step) => [step.id, step])),
    taskById: new Map(tasks.map((task) => [task.id, task])),
    tickCountByTask,
  };
}

function numericId(id: string, prefix: string): number {
  return Number(id.replace(prefix, ''));
}

function markItem(item: PlanItem, evidence: TodayEvidence): PlanItemWithStatus {
  const topicId = item.topicId ?? -1;
  switch (item.kind) {
    case 'PLAN': return markPlanStep(item, evidence, topicId);
    case 'TASK': return markTask(item, evidence);
    default: return markAuto(item, autoDoneFor(item, evidence, topicId));
  }
}

function autoDoneFor(item: PlanItem, evidence: TodayEvidence, topicId: number): boolean {
  switch (item.kind) {
    case 'ANKI':
    case 'CARDS': return evidence.cardsDone;
    case 'OUT_LOUD': return evidence.outLoudDone;
    case 'RECALL': return evidence.recalledTopicIds.has(topicId);
    case 'QUESTIONS': return (evidence.questionsByTopic.get(topicId) ?? 0) >= MIN_QUESTIONS_PER_TOPIC;
    // Working on a topic = a recall or new questions for it; editing color or name does not count.
    case 'CYCLE':
    case 'SYSTEM_DESIGN': return evidence.recalledTopicIds.has(topicId) || evidence.questionsByTopic.has(topicId);
    case 'MOCK': return evidence.mockDone;
    case 'INBOX': return evidence.inboxEmpty;
    case 'LEVEL': return evidence.passedLevelKeys.has(item.id.replace('level:', ''));
    default: return false;
  }
}

function markAuto(item: PlanItem, autoDone: boolean): PlanItemWithStatus {
  return { ...item, autoDone, done: autoDone || item.manualDone };
}

/** Step progress lives in PlanStep: ticked here, on the plan page, or automatically after a problem attempt. */
function markPlanStep(item: PlanItem, evidence: TodayEvidence, topicId: number): PlanItemWithStatus {
  const step = evidence.planStepById.get(numericId(item.id, 'plan:'));
  if (!step) return markAuto(item, false);
  const attemptDone = step.kind === 'ATTEMPT' && evidence.recalledTopicIds.has(topicId);
  return { ...item, autoDone: attemptDone, done: step.doneAt !== null || attemptDone };
}

/** A one-off task can also be closed on the Tasks page; a session task closes itself at the target. */
function markTask(item: PlanItem, evidence: TodayEvidence): PlanItemWithStatus {
  const taskId = numericId(item.id, 'task:');
  const task = evidence.taskById.get(taskId);
  const closedOnce = task !== undefined && task.repeat === 'ONCE' && task.doneAt !== null;
  if (task && task.target > 0) {
    const progress: TaskProgress = { count: evidence.tickCountByTask.get(taskId) ?? 0, target: task.target };
    const reached = progress.count >= progress.target;
    return { ...item, progress, autoDone: reached, done: reached || item.manualDone || closedOnce };
  }
  return { ...item, autoDone: false, done: item.manualDone || closedOnce };
}

// ─── Stored plan ─────────────────────────────────────────────────────────────

/** Items are stored as JSON; validate the shape on read instead of casting blindly. */
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

export async function getTodayPlan(now: Date = new Date()) {
  const plan = await db.dailyPlan.findUnique({ where: { day: dayKey(now) } });
  if (!plan) return null;
  const items = await withStatus(parsePlanItems(plan.items), now);
  return { ...plan, items };
}

/** Facts for the evening review: what was recalled and with which confidence. */
export async function todayRecallSummary(now: Date = new Date()): Promise<string[]> {
  const recalls = await db.recallLog.findMany({
    where: { createdAt: { gte: startOfDay(now), lte: endOfDay(now) } },
    include: { topic: true },
    orderBy: { createdAt: 'asc' },
  });
  return recalls.map((recall) => `${recall.topic.name}: ${recall.confidenceAfter}`);
}
