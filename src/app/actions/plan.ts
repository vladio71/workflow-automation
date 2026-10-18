'use server';

import { db } from '@/lib/db';
import { dayKey } from '@/lib/queries';
import { generateDayPlan, isGeminiConfigured, reviewDay } from '@/lib/gemini';
import {
  DEFAULT_BUDGET, buildCandidates, getTodayPlan, parsePlanItems, rulePlan, todayRecallSummary, withStatus,
  type PlanCandidate, type PlanItem, type PlanItemKind,
} from '@/lib/planner';
import {
  addToDraft, clampMinutes, enforceMandatory, keepDone, momentumOrder, moveInDraft, moveToIndex, removeFromDraft, setMinutesInDraft, toPlanItem,
  type MoveDirection,
} from '@/lib/plan-order';
import { getStudyPlans } from '@/lib/study-plan';
import { logActivity } from '@/lib/activity';
import { scanLevels } from '@/lib/levels';
import { LEVELS_FOCUS, NO_FOCUS, planFocus } from '@/lib/day-focus';
import type { ActivityKind } from '@/generated/prisma/enums';
import { refresh, toJson } from './shared';

/**
 * The day plan, from "Generate" to the evening review.
 *
 *   generatePlan   prepare -> draft (LLM, or rules) -> finalize order -> save
 *   editDraft      every edit before "Start the day" goes through it
 *   startDay, setPlanItemDone, skipPlanItem   the day itself
 *   reviewToday    the evening check
 */

export type PlanActionResult = { ok: true; note?: string } | { ok: false; error: string };

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_BUDGET = 30;
const MAX_BUDGET = 720;
const MAX_WISH_LENGTH = 300;

// ─── Generating the plan ─────────────────────────────────────────────────────

export interface PlanSetup {
  budget: number;
  /** Focus of the day: '' (none), 'levels' or 'plan:<sourceId>', see day-focus.ts. */
  focus: string;
  /** Free-text wish for the day. */
  wish: string;
  /** Live status of the Gemini request: /api/ai/status?job=<id>. */
  jobId?: string;
}

interface ResolvedFocus {
  key: string;
  name: string | null;
}

/** Everything the plan is built from, computed once per generation. */
interface PlanRequest {
  now: Date;
  day: Date;
  minutesBudget: number;
  wish: string;
  focus: ResolvedFocus;
  candidates: PlanCandidate[];
  yesterdayUndone: string[];
  jobId?: string;
}

interface PlanDraft {
  items: PlanItem[];
  summary: string;
  /** Why Gemini did not build the plan; stored with the plan so the red line survives a reload. */
  aiError: string;
}

/**
 * Build (or rebuild) today's plan. The result is always a draft that can be edited until "Start the day".
 * A rebuild after the start keeps the items already done. Without a key, or when Gemini fails: a rule-based plan.
 */
export async function generatePlan(setup: PlanSetup): Promise<PlanActionResult> {
  const request = await preparePlanRequest(setup);
  const draft = await draftPlan(request);
  const items = await finalizeOrder(draft.items, request.now);
  await saveDraft(request, draft, items);
  refresh();
  return { ok: true, note: emptyPlanNote(request.candidates) };
}

async function preparePlanRequest(setup: PlanSetup): Promise<PlanRequest> {
  const now = new Date();
  const minutesBudget = Math.min(MAX_BUDGET, Math.max(MIN_BUDGET, Math.round(setup.budget)));
  const focus = await resolveFocus(setup.focus);
  const candidates = await buildCandidates(now, { focus: focus.key, budget: minutesBudget });
  return {
    now,
    day: dayKey(now),
    minutesBudget,
    wish: setup.wish.trim().slice(0, MAX_WISH_LENGTH),
    focus,
    candidates,
    yesterdayUndone: await loadYesterdayUndone(now),
    jobId: setup.jobId,
  };
}

/** The focus from the client is verified: only an existing study plan, or levels when there are any. The name goes into the prompt. */
async function resolveFocus(focus: string): Promise<ResolvedFocus> {
  if (focus === LEVELS_FOCUS) {
    const scan = await scanLevels();
    return scan.levels.length > 0 ? { key: LEVELS_FOCUS, name: 'Live code (рівні)' } : { key: NO_FOCUS, name: null };
  }
  const studyPlans = await getStudyPlans();
  const plan = studyPlans.find((studyPlan) => planFocus(studyPlan.source.id) === focus);
  return plan ? { key: focus, name: plan.source.planName || plan.source.repo } : { key: NO_FOCUS, name: null };
}

async function loadYesterdayUndone(now: Date): Promise<string[]> {
  const yesterday = new Date(now.getTime() - DAY_MS);
  const plan = await db.dailyPlan.findUnique({ where: { day: dayKey(yesterday) } });
  if (!plan) return [];
  const items = await withStatus(parsePlanItems(plan.items), yesterday);
  return items.filter((item) => !item.done).map((item) => item.title);
}

/** The LLM picks and orders when it is configured and answers well; otherwise plain rules. */
async function draftPlan(request: PlanRequest): Promise<PlanDraft> {
  if (!isGeminiConfigured()) return { ...rulePlan(request.candidates, request.minutesBudget), aiError: '' };
  try {
    return await draftPlanWithGemini(request);
  } catch (error) {
    console.error(error);
    return { ...rulePlan(request.candidates, request.minutesBudget), aiError: error instanceof Error ? error.message : 'невідома помилка' };
  }
}

async function draftPlanWithGemini(request: PlanRequest): Promise<PlanDraft> {
  const result = await generateDayPlan({
    weekday: request.now.toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' }),
    minutesBudget: request.minutesBudget,
    focus: request.focus.name,
    wish: request.wish,
    candidates: request.candidates.map(({ id, kind, title, defaultMinutes, mandatory, hint }) => ({
      id,
      kind,
      title,
      defaultMinutes,
      mandatory: mandatory === true,
      // For tasks the note says how many days a one-off task has been postponed.
      note: kind === 'TASK' ? hint ?? '' : '',
    })),
    yesterdayUndone: request.yesterdayUndone,
  }, request.jobId);

  const items = itemsFromPicks(result.items, request.candidates);
  if (items.length === 0) throw new Error('Gemini вибрав пункти, яких нема серед кандидатів');
  return {
    items: enforceMandatory(items, request.candidates, request.minutesBudget),
    summary: result.summary,
    aiError: '',
  };
}

/** The model may only pick from the candidates: unknown ids and duplicates are dropped. */
function itemsFromPicks(picks: { id: string; minutes: number; why: string }[], candidates: PlanCandidate[]): PlanItem[] {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const seen = new Set<string>();
  const items: PlanItem[] = [];
  for (const picked of picks) {
    const candidate = byId.get(picked.id);
    if (!candidate || seen.has(picked.id)) continue;
    seen.add(picked.id);
    items.push({ ...candidate, minutes: picked.minutes, why: picked.why, manualDone: false });
  }
  return items;
}

/** Warm-up first, the boss right after it: a rule of the code the model cannot override (the draft can be reordered by hand). */
async function finalizeOrder(drafted: PlanItem[], now: Date): Promise<PlanItem[]> {
  const items = momentumOrder(drafted);
  // A rebuild after the start keeps what was done today.
  const current = await getTodayPlan(now);
  return current?.startedAt ? keepDone(current.items, items) : items;
}

async function saveDraft(request: PlanRequest, draft: PlanDraft, items: PlanItem[]): Promise<void> {
  const shared = {
    items: toJson(items),
    summary: draft.summary,
    focus: request.focus.key,
    wish: request.wish,
    budget: request.minutesBudget,
    startedAt: null,
    aiError: draft.aiError,
  };
  await db.dailyPlan.upsert({
    where: { day: request.day },
    create: { day: request.day, ...shared },
    update: { ...shared, review: '' },
  });
}

/** An almost empty plan says why, instead of leaving the user guessing. */
function emptyPlanNote(candidates: PlanCandidate[]): string | undefined {
  const hasStudyPlan = candidates.some((candidate) => candidate.mandatory === true);
  const hasCycle = candidates.some((candidate) => candidate.kind === 'CYCLE');
  const hasLevels = candidates.some((candidate) => candidate.kind === 'LEVEL');
  if (hasStudyPlan || hasCycle || hasLevels) return undefined;
  return 'Мало пунктів: немає кроків навчального плану (додай репо з learn/plan.md на Sources) і немає активного циклу (Cycles).';
}

// ─── Editing the draft ───────────────────────────────────────────────────────

/** An edit of the draft. After "Start the day" the plan does not change: only ticks, or a rebuild. */
async function editDraft(change: (items: PlanItem[]) => PlanItem[] | Promise<PlanItem[]>): Promise<PlanActionResult> {
  const day = dayKey(new Date());
  const plan = await db.dailyPlan.findUnique({ where: { day } });
  if (!plan) return { ok: false, error: 'Спершу склади план на сьогодні' };
  if (plan.startedAt) return { ok: false, error: 'День уже почато: план можна тільки перепланувати' };
  const items = await change(parsePlanItems(plan.items));
  await db.dailyPlan.update({ where: { day }, data: { items: toJson(items) } });
  refresh();
  return { ok: true };
}

export async function removePlanItem(itemId: string): Promise<PlanActionResult> {
  return editDraft((items) => removeFromDraft(items, itemId));
}

export async function movePlanItem(itemId: string, direction: MoveDirection): Promise<PlanActionResult> {
  return editDraft((items) => moveInDraft(items, itemId, direction));
}

/** Drag and drop in the draft: the item lands at `toIndex`. */
export async function reorderPlanItem(itemId: string, toIndex: number): Promise<PlanActionResult> {
  let blocked = false;
  const result = await editDraft((items) => {
    const moved = moveToIndex(items, itemId, toIndex);
    if (moved === null) blocked = true;
    return moved ?? items;
  });
  if (result.ok && blocked) return { ok: false, error: 'Кроки одного навчального плану йдуть по порядку: місцями їх не поміняти' };
  return result;
}

export async function setPlanItemMinutes(itemId: string, minutes: number): Promise<PlanActionResult> {
  return editDraft((items) => setMinutesInDraft(items, itemId, minutes));
}

/** Add a candidate the plan did not take (with the same focus and budget the plan was built with). */
export async function addPlanItem(candidateId: string): Promise<PlanActionResult> {
  const now = new Date();
  const plan = await db.dailyPlan.findUnique({ where: { day: dayKey(now) } });
  const candidates = await buildCandidates(now, {
    focus: plan?.focus ?? NO_FOCUS,
    budget: plan?.budget || DEFAULT_BUDGET,
  });
  return editDraft((items) => addToDraft(items, candidateId, candidates));
}

/** A new one-off task straight from the draft: it goes into the plan and into Tasks (undone, the plan offers it again tomorrow). */
export async function addPlanTask(title: string, minutes: number): Promise<PlanActionResult> {
  const text = title.trim().slice(0, 200);
  if (!text) return { ok: false, error: 'Напиши, що за справа' };
  return editDraft(async (items) => {
    const task = await db.task.create({ data: { title: text, minutes: clampMinutes(minutes), repeat: 'ONCE', status: 'TODO' } });
    return [...items, toPlanItem({
      id: `task:${task.id}`, kind: 'TASK', title: task.title, href: '/tasks', topicId: null,
      defaultMinutes: task.minutes, hint: 'Разова справа, додана сьогодні.', group: 'tasks',
    })];
  });
}

const LIVE_CODING_COUNT = 3;
const LIVE_CODING_TITLE = 'Live code next problem';
const LIVE_CODING_MINUTES = 40;

/** The "+ 3 live coding" button: three one-off tasks at the top of the draft, no description. */
export async function addLiveCodingTasks(): Promise<PlanActionResult> {
  return editDraft(async (items) => {
    const added: PlanItem[] = [];
    for (let index = 0; index < LIVE_CODING_COUNT; index += 1) {
      const task = await db.task.create({ data: { title: LIVE_CODING_TITLE, minutes: LIVE_CODING_MINUTES, repeat: 'ONCE' } });
      added.push(toPlanItem({
        id: `task:${task.id}`, kind: 'TASK', title: task.title, href: '/tasks', topicId: null,
        defaultMinutes: task.minutes, group: 'tasks',
      }));
    }
    return [...added, ...items];
  });
}

// ─── The day itself ──────────────────────────────────────────────────────────

export async function startDay(): Promise<PlanActionResult> {
  const day = dayKey(new Date());
  const plan = await db.dailyPlan.findUnique({ where: { day } });
  if (!plan) return { ok: false, error: 'Спершу склади план на сьогодні' };
  if (plan.startedAt) return { ok: true };
  if (parsePlanItems(plan.items).length === 0) return { ok: false, error: 'План порожній: додай хоча б один пункт' };
  await db.dailyPlan.update({ where: { day }, data: { startedAt: new Date() } });
  refresh();
  return { ok: true };
}

export async function setPlanItemDone(itemId: string, done: boolean): Promise<void> {
  if (itemId.startsWith('plan:')) {
    await setPlanStepDone(Number(itemId.replace('plan:', '')), done);
  }
  if (itemId.startsWith('task:')) {
    // A one-off task is closed in Tasks too; a recurring one lives only in the day plan.
    const task = await db.task.findUnique({ where: { id: Number(itemId.replace('task:', '')) } });
    if (task?.repeat === 'ONCE') await db.task.update({ where: { id: task.id }, data: { doneAt: done ? new Date() : null } });
  }
  const day = dayKey(new Date());
  const plan = await db.dailyPlan.findUnique({ where: { day } });
  if (!plan) return;
  const parsed = parsePlanItems(plan.items);
  const items = parsed.map((item) => (item.id === itemId ? { ...item, manualDone: done } : item));
  await db.dailyPlan.update({ where: { day }, data: { items: toJson(items) } });
  const item = parsed.find((candidate) => candidate.id === itemId);
  if (item) await syncPlanItemTime(item, done, day);
  refresh();
}

/** A manual tick in the day plan logs the item's minutes into Stats; unticking removes the entry. */
const PLAN_KIND_TO_ACTIVITY: Record<PlanItemKind, ActivityKind> = {
  ANKI: 'CARDS', CARDS: 'CARDS', RECALL: 'RECALL', QUESTIONS: 'QUESTIONS', MOCK: 'MOCK', LEVEL: 'DRILL',
  CYCLE: 'STUDY', SYSTEM_DESIGN: 'STUDY', OUT_LOUD: 'STUDY', PLAN: 'STUDY', INBOX: 'OTHER', TASK: 'OTHER',
};

async function syncPlanItemTime(item: PlanItem, done: boolean, day: Date): Promise<void> {
  const note = `plan-item:${item.id}`;
  const existing = await db.activityLog.findFirst({ where: { day, note } });
  if (done && !existing) {
    await logActivity({ minutes: item.minutes, kind: PLAN_KIND_TO_ACTIVITY[item.kind], topicId: item.topicId, track: null, note });
  }
  if (!done && existing) {
    await db.activityLog.delete({ where: { id: existing.id } });
  }
}

/** Skip the current node of the map: it moves to the end of the day. Mandatory study steps do not move. */
export async function skipPlanItem(itemId: string): Promise<void> {
  const day = dayKey(new Date());
  const plan = await db.dailyPlan.findUnique({ where: { day } });
  if (!plan) return;
  const items = parsePlanItems(plan.items);
  const index = items.findIndex((item) => item.id === itemId);
  const item = items[index];
  if (!item || item.mandatory === true) return;
  items.splice(index, 1);
  items.push(item);
  await db.dailyPlan.update({ where: { day }, data: { items: toJson(items) } });
  refresh();
}

export async function setPlanStepDone(stepId: number, done: boolean): Promise<void> {
  await db.planStep.update({ where: { id: stepId }, data: { doneAt: done ? new Date() : null } });
  refresh();
}

// ─── Evening review ──────────────────────────────────────────────────────────

/** The evening check: the app counts what is done, Gemini writes a short review. */
export async function reviewToday(jobId?: string): Promise<PlanActionResult> {
  const now = new Date();
  const plan = await getTodayPlan(now);
  if (!plan) return { ok: false, error: 'Спершу склади план на сьогодні' };

  const done = plan.items.filter((item) => item.done);
  const undone = plan.items.filter((item) => !item.done);
  let review = `Зроблено ${done.length} з ${plan.items.length}.` +
    (undone.length ? ` Не зроблено: ${undone.map((item) => item.title).join('; ')}.` : ' Все виконано.');

  let note: string | undefined;
  if (isGeminiConfigured()) {
    try {
      review = await reviewDay({
        items: plan.items.map((item) => ({ title: item.title, minutes: item.minutes, done: item.done })),
        recalls: await todayRecallSummary(now),
      }, jobId);
    } catch (error) {
      console.error(error);
      review += ' (огляд без AI)';
      note = `Gemini не написав огляд: ${error instanceof Error ? error.message : 'помилка'}`;
    }
  }
  await db.dailyPlan.update({ where: { day: dayKey(now) }, data: { review } });
  refresh();
  return { ok: true, note };
}
