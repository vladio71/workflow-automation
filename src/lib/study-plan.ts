import 'server-only';
import type { PlanStep, Source, Topic } from '@/generated/prisma/client';
import { db } from '@/lib/db';
import { endOfDay, startOfDay } from '@/lib/schedule';
import { refUrl } from '@/lib/sync';

/**
 * Study plan from learn/plan.md (currently system-design-reps).
 * Steps go strictly in order; every day the app picks the next steps within the plan limit (dailyMinutes):
 *   1. first the redos of problems that are due (at most 2, 45 min each);
 *   2. then the next plan steps while they fit the limit;
 *   3. at most one NEW problem per day (ATTEMPT or EXAM): memory needs time between problems.
 * On a day focused on the plan: limit = at least 60% of the day budget and up to 2 new problems.
 * Redo = recall of the problem topic: after the attempt a colour is set and the 2/7/21-day schedule does the rest.
 */

/** redo of a problem from scratch: 45 min, like an interview */
export const REDO_MINUTES = 45;
const MAX_REDOS_PER_DAY = 2;
/** the summary closes the problem the same day while the reference is fresh: it may exceed the limit by this many minutes */
const SUMMARY_OVERFLOW_MINUTES = 30;

export interface StudyPlan {
  source: Source;
  steps: PlanStep[];
  /** problem topic for every folder the steps refer to */
  topicByPath: Map<string, Topic>;
}

export interface PlanProgress {
  done: number;
  total: number;
  /** group of the current step ("Week 2") */
  group: string;
  next: PlanStep | null;
}

export interface TodaySelection {
  redos: Topic[];
  steps: PlanStep[];
}

export interface TodayLimits {
  /** minutes the plan takes today; defaults to the plan limit from plan.md (dailyMinutes) */
  minutes: number;
  /** NEW problems (ATTEMPT or EXAM) per day; 2 on a day focused on this plan, otherwise 1 */
  newProblems: number;
}

/** Focus day: whatever is in focus takes at least this share of the day budget. */
export const FOCUS_BUDGET_SHARE = 0.6;
const FOCUS_NEW_PROBLEMS = 2;

/** 'this' = this plan is in focus, 'other' = something else is (another plan or levels), 'none' = no focus. */
export type FocusRole = 'this' | 'other' | 'none';

export function todayLimits(plan: StudyPlan, role: FocusRole, dayBudgetMinutes: number): TodayLimits {
  const daily = plan.source.planDailyMinutes;
  if (role === 'this') {
    return { minutes: Math.max(daily, Math.round(dayBudgetMinutes * FOCUS_BUDGET_SHARE)), newProblems: FOCUS_NEW_PROBLEMS };
  }
  // something else is in focus: the plan runs in maintenance mode, at most what is left of the budget after the focus share
  if (role === 'other') return { minutes: Math.min(daily, Math.round(dayBudgetMinutes * (1 - FOCUS_BUDGET_SHARE))), newProblems: 1 };
  return { minutes: daily, newProblems: 1 };
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

/** Where a step leads: attempt -> recall of the problem topic, link -> repo file or website, otherwise the plan page. */
export function stepHref(plan: StudyPlan, step: PlanStep): string {
  const topic = plan.topicByPath.get(step.topicPath);
  if (step.kind === 'ATTEMPT' && topic) return `/recall/${topic.id}`;
  if (step.link) return refUrl(plan.source, step.link);
  if (topic) return `/topics/${topic.id}`;
  return '/plan';
}

/** Problem topics of the plan (those referenced by ATTEMPT steps). */
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
 * What to do from the plan today. dueTopics are already sorted (red, then the oldest).
 * Steps done today are included too: otherwise an evening "Re-plan" would hand out more than the limit.
 */
export function selectToday(
  plan: StudyPlan,
  dueTopics: Topic[],
  now: Date,
  limits: TodayLimits = { minutes: plan.source.planDailyMinutes, newProblems: 1 },
): TodaySelection {
  const from = startOfDay(now);
  const to = endOfDay(now);
  const problemIds = problemTopicIds(plan);
  // redo only by schedule: a red topic is "due" right away in the general list, but a problem is redone in 2 days
  const redos = dueTopics
    .filter((topic) => problemIds.has(topic.id) && topic.nextReviewAt !== null && topic.nextReviewAt <= to)
    .slice(0, MAX_REDOS_PER_DAY);

  let remaining = limits.minutes - redos.length * REDO_MINUTES;
  let attempts = 0;
  const steps: PlanStep[] = [];

  for (const step of plan.steps) {
    const doneToday = step.doneAt !== null && step.doneAt >= from && step.doneAt <= to;
    if (step.doneAt !== null && !doneToday) continue; // done earlier

    const isProblem = step.kind === 'ATTEMPT' || step.kind === 'EXAM';
    if (isProblem && attempts >= limits.newProblems) break; // new problems per day: 1, on a focus day 2
    const allowance = step.kind === 'SUMMARY' ? SUMMARY_OVERFLOW_MINUTES : 0;
    const fits = step.minutes <= remaining + allowance;
    // the first step of the day is taken even if it is longer than the limit, otherwise the plan would be stuck forever
    const firstOfDay = steps.length === 0 && redos.length === 0;
    if (!fits && !firstOfDay) break;

    steps.push(step);
    remaining -= step.minutes;
    if (isProblem) attempts += 1;
  }
  return { redos, steps };
}


/** A problem attempt counts itself: after a recall of its topic, the first undone ATTEMPT with that topic is done. */
export async function markAttemptDone(topic: Pick<Topic, 'sourceId' | 'sourcePath'>, now: Date): Promise<void> {
  if (topic.sourceId === null || topic.sourcePath === '') return;
  const step = await db.planStep.findFirst({
    where: { sourceId: topic.sourceId, topicPath: topic.sourcePath, kind: 'ATTEMPT', doneAt: null },
    orderBy: { position: 'asc' },
  });
  if (step) await db.planStep.update({ where: { id: step.id }, data: { doneAt: now } });
}
