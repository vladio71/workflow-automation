import 'server-only';
import type { PlanStep, Source, Topic } from '@/generated/prisma/client';
import { db } from '@/lib/db';
import { endOfDay, startOfDay } from '@/lib/schedule';
import { refUrl } from '@/lib/sync';

/**
 * Навчальний план з learn/plan.md (зараз system-design-reps).
 * Кроки йдуть строго по порядку; апка щодня відбирає наступні кроки в межах ліміту плану (dailyMinutes):
 *   1. спершу переробки задач, у яких настав термін (максимум 2, по 45 хв);
 *   2. далі наступні кроки плану, поки влазять у ліміт;
 *   3. максимум одна НОВА задача на день (ATTEMPT або EXAM): пам'яті потрібен час між задачами.
 * Переробка = recall теми-задачі: після спроби ставиш колір, і розклад 2/7/21 днів робить решту.
 */

/** переробка задачі з нуля: 45 хв, як співбесіда */
export const REDO_MINUTES = 45;
const MAX_REDOS_PER_DAY = 2;

export interface StudyPlan {
  source: Source;
  steps: PlanStep[];
  /** тема-задача для кожної папки, на яку посилаються кроки */
  topicByPath: Map<string, Topic>;
}

export interface PlanProgress {
  done: number;
  total: number;
  /** група поточного кроку ("Тиждень 2") */
  group: string;
  next: PlanStep | null;
}

export interface TodaySelection {
  redos: Topic[];
  steps: PlanStep[];
}

export async function getStudyPlans(): Promise<StudyPlan[]> {
  const sources = await db.source.findMany({
    where: { planDailyMinutes: { gt: 0 } },
    include: { planSteps: { orderBy: { position: 'asc' } } },
    orderBy: { id: 'asc' },
  });
  const plans: StudyPlan[] = [];
  for (const { planSteps, ...source } of sources) {
    if (planSteps.length === 0) continue;
    const paths = [...new Set(planSteps.map((step) => step.topicPath).filter((path) => path !== ''))];
    const topics = await db.topic.findMany({ where: { sourceId: source.id, sourcePath: { in: paths } } });
    plans.push({ source, steps: planSteps, topicByPath: new Map(topics.map((topic) => [topic.sourcePath, topic])) });
  }
  return plans;
}

export function planProgress(plan: StudyPlan): PlanProgress {
  const done = plan.steps.filter((step) => step.doneAt !== null).length;
  const next = plan.steps.find((step) => step.doneAt === null) ?? null;
  return { done, total: plan.steps.length, group: next?.group ?? 'done', next };
}

/** Куди веде крок: спроба -> recall теми-задачі, посилання -> файл у репо чи сайт, інакше сторінка плану. */
export function stepHref(plan: StudyPlan, step: PlanStep): string {
  const topic = plan.topicByPath.get(step.topicPath);
  if (step.kind === 'ATTEMPT' && topic) return `/recall/${topic.id}`;
  if (step.link) return refUrl(plan.source, step.link);
  if (topic) return `/topics/${topic.id}`;
  return '/plan';
}

/** Теми-задачі плану (ті, на які посилаються ATTEMPT-кроки). */
export function problemTopicIds(plan: StudyPlan): Set<number> {
  const ids = new Set<number>();
  for (const step of plan.steps) {
    if (step.kind !== 'ATTEMPT') continue;
    const topic = plan.topicByPath.get(step.topicPath);
    if (topic) ids.add(topic.id);
  }
  return ids;
}

/**
 * Що з плану робити сьогодні. dueTopics уже відсортовані (червоні, потім найстаріші).
 * Кроки, зроблені сьогодні, теж входять: інакше повторне "Re-plan" увечері видавало б понад ліміт.
 */
export function selectToday(plan: StudyPlan, dueTopics: Topic[], now: Date): TodaySelection {
  const from = startOfDay(now);
  const to = endOfDay(now);
  const problemIds = problemTopicIds(plan);
  // переробка тільки за розкладом: червона тема в загальному списку "due" одразу, а задачу переробляємо через 2 дні
  const redos = dueTopics
    .filter((topic) => problemIds.has(topic.id) && topic.nextReviewAt !== null && topic.nextReviewAt <= to)
    .slice(0, MAX_REDOS_PER_DAY);

  let remaining = plan.source.planDailyMinutes - redos.length * REDO_MINUTES;
  let attempts = 0;
  const steps: PlanStep[] = [];

  for (const step of plan.steps) {
    const doneToday = step.doneAt !== null && step.doneAt >= from && step.doneAt <= to;
    if (step.doneAt !== null && !doneToday) continue; // зроблено раніше

    const isProblem = step.kind === 'ATTEMPT' || step.kind === 'EXAM';
    if (isProblem && attempts >= 1) break; // одна нова задача на день
    const fits = step.minutes <= remaining;
    // перший крок дня беремо, навіть якщо він довший за ліміт, інакше план застрягне назавжди
    const firstOfDay = steps.length === 0 && redos.length === 0;
    if (!fits && !firstOfDay) break;

    steps.push(step);
    remaining -= step.minutes;
    if (isProblem) attempts += 1;
  }
  return { redos, steps };
}


/** Спроба задачі зараховується сама: пройшов recall її теми, тоді перший незроблений ATTEMPT з цією темою = зроблено. */
export async function markAttemptDone(topic: Pick<Topic, 'sourceId' | 'sourcePath'>, now: Date): Promise<void> {
  if (topic.sourceId === null || topic.sourcePath === '') return;
  const step = await db.planStep.findFirst({
    where: { sourceId: topic.sourceId, topicPath: topic.sourcePath, kind: 'ATTEMPT', doneAt: null },
    orderBy: { position: 'asc' },
  });
  if (step) await db.planStep.update({ where: { id: step.id }, data: { doneAt: now } });
}
