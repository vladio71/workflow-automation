'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { dayKey, getDueTopics } from '@/lib/queries';
import { endOfDay, schedule, startOfDay } from '@/lib/schedule';
import {
  checkModels, generateDayPlan, gradeAnswer, isGeminiConfigured, reviewDay, type GradeInput, type GradeResult, type ModelCheck,
} from '@/lib/gemini';
import { DEFAULT_BUDGET, buildCandidates, getTodayPlan, parsePlanItems, rulePlan, todayRecallSummary, withStatus, type PlanItem, type PlanItemKind } from '@/lib/planner';
import {
  addToDraft, clampMinutes, enforceMandatory, keepDone, momentumOrder, moveInDraft, moveToIndex, removeFromDraft, setMinutesInDraft, toPlanItem,
  type MoveDirection,
} from '@/lib/plan-order';
import { getStudyPlans, markAttemptDone } from '@/lib/study-plan';
import {
  createCard, createCategory, deleteCard, getCardCounts, reviewCard, setCardCategory, setCategoryDeadline, updateCard,
  type CardTextInput, type CategoryChoice, type NewCardInput, type ReviewInput,
} from '@/lib/cards';
import { isDateKey } from '@/lib/learn-format';
import { ImportError, finishImport, importCards, previewImport, type ImportPreview, type ImportResult, type ImportTarget } from '@/lib/import-cards';
import { createDailyItem, deleteDailyItem, renameDailyItem, reorderDailyItems, setDailyItemChecked } from '@/lib/daily';
import { logActivity } from '@/lib/activity';
import { normalizeRepo, syncAll, syncSource, type SyncResult } from '@/lib/sync';
import { findLevel, getLevelDetails, levelsDir, scanLevels } from '@/lib/levels';
import { LEVELS_FOCUS, NO_FOCUS, planFocus } from '@/lib/day-focus';
import { runLevel } from '@/lib/level-runner';
import { clampTarget, todayTickCounts } from '@/lib/task-sessions';
import { clampPriority, updateBacklogTask } from '@/lib/task-backlog';
import type { ActivityKind, Confidence, CycleStatus, TaskRepeat, TaskStatus, Track } from '@/generated/prisma/enums';

/** Після будь-якої зміни перебудовуємо всі сторінки: апка маленька, так простіше і без багів з кешем. */
function refresh(): void {
  revalidatePath('/', 'layout');
}

// ================================================================== topics

export type TopicTextField = 'name' | 'notes' | 'drill' | 'source';

export async function updateTopicText(id: number, field: TopicTextField, value: string): Promise<void> {
  await db.topic.update({ where: { id }, data: { [field]: value } });
  refresh();
}

export async function setTopicTrack(id: number, track: Track): Promise<void> {
  await db.topic.update({ where: { id }, data: { track } });
  refresh();
}

/** Ручна зміна кольору в таблиці. Дати не чіпає: розклад міняє тільки recall-сесія. */
export async function setTopicConfidence(id: number, confidence: Confidence): Promise<void> {
  await db.topic.update({ where: { id }, data: { confidence } });
  refresh();
}

export async function setTopicCycle(id: number, cycleId: string): Promise<void> {
  await db.topic.update({ where: { id }, data: { cycleId: cycleId ? Number(cycleId) : null } });
  refresh();
}

export async function createTopic(formData: FormData): Promise<void> {
  const track = (formData.get('track') as Track | null) ?? 'NODE';
  const topic = await db.topic.create({ data: { name: 'Untitled', track } });
  refresh();
  redirect(`/topics/${topic.id}`);
}

/** Швидке додавання з рядка таблиці: назва + трек, без переходу на сторінку. */
export async function addTopicQuick(formData: FormData): Promise<void> {
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return;
  const track = (formData.get('track') as Track | null) ?? 'OTHER';
  const cycleId = formData.get('cycleId');
  await db.topic.create({ data: { name, track, cycleId: cycleId ? Number(cycleId) : null } });
  refresh();
}

export async function deleteTopic(id: number): Promise<void> {
  await db.topic.delete({ where: { id } });
  refresh();
  redirect('/topics');
}

// ================================================================== questions

export type QuestionTextField = 'question' | 'myAnswer' | 'reference';

export async function createQuestion(topicId: number | null, formData: FormData): Promise<void> {
  const question = String(formData.get('question') ?? '').trim();
  if (!question) return;
  const topicFromForm = formData.get('topicId');
  const resolvedTopicId = topicId ?? (topicFromForm ? Number(topicFromForm) : null);
  await db.question.create({ data: { question, topicId: resolvedTopicId } });
  refresh();
}

export async function updateQuestionText(id: number, field: QuestionTextField, value: string): Promise<void> {
  const question = await db.question.findUniqueOrThrow({ where: { id } });
  // на цих сторінках картки з репо тільки для читання (крім твоєї відповіді з пам'яті); їх текст міняється через All cards → Edit
  if (question.sourceId !== null && field !== 'myAnswer') return;
  await db.question.update({ where: { id }, data: { [field]: value } });
  refresh();
}


export async function deleteQuestion(id: number): Promise<void> {
  // через deleteCard: для питання з репо лишається запис, щоб Sync не створив його знову
  await deleteCard(id);
  refresh();
}

// ================================================================== daily

/** Галочка пункту Daily. refresh(): від неї залежать стрік і стан вузлів плану дня. */
export async function checkDailyItem(id: number, checked: boolean): Promise<void> {
  await setDailyItemChecked(id, checked);
  refresh();
}

// Правки списку Daily без refresh(): список на клієнті вже показує зміну,
// а перемальована сторінка збила б курсор у пункті, який саме пишеш.

/** Новий пункт після afterId (null = у кінець). Повертає його id. */
export async function addDailyItem(afterId: number | null, title: string): Promise<number> {
  return createDailyItem(afterId, title);
}

export async function saveDailyItemTitle(id: number, title: string): Promise<void> {
  await renameDailyItem(id, title);
}

export async function removeDailyItem(id: number): Promise<void> {
  await deleteDailyItem(id);
}

export async function saveDailyOrder(ids: number[]): Promise<void> {
  await reorderDailyItems(ids);
}

// ================================================================== inbox

export async function addInbox(formData: FormData): Promise<void> {
  const text = String(formData.get('text') ?? '').trim();
  if (!text) return;
  await db.inboxItem.create({ data: { text } });
  refresh();
}

export async function deleteInbox(id: number): Promise<void> {
  await db.inboxItem.delete({ where: { id } });
  refresh();
}

export async function inboxToTopic(id: number, track: Track): Promise<void> {
  const item = await db.inboxItem.delete({ where: { id } });
  await db.topic.create({ data: { name: item.text.slice(0, 200), track, notes: item.text.length > 200 ? item.text : '' } });
  refresh();
}

export async function inboxToQuestion(id: number): Promise<void> {
  const item = await db.inboxItem.delete({ where: { id } });
  await db.question.create({ data: { question: item.text } });
  refresh();
}

// ================================================================== cycles

export type CycleTextField = 'name' | 'goal' | 'retro';

export async function updateCycleText(id: number, field: CycleTextField, value: string): Promise<void> {
  await db.cycle.update({ where: { id }, data: { [field]: value } });
  refresh();
}

export async function createCycle(formData: FormData): Promise<void> {
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return;
  const last = await db.cycle.findFirst({ orderBy: { number: 'desc' } });
  const hasActive = await db.cycle.count({ where: { status: 'ACTIVE' } });
  await db.cycle.create({
    data: { name, number: (last?.number ?? 0) + 1, goal: String(formData.get('goal') ?? '').trim(), status: hasActive ? 'PLANNED' : 'ACTIVE' },
  });
  refresh();
}

export async function deleteCycle(id: number): Promise<void> {
  await db.cycle.delete({ where: { id } });
  refresh();
}

/** Активним може бути тільки один цикл: попередній активний стає Done. */
export async function setCycleStatus(id: number, status: CycleStatus): Promise<void> {
  await db.$transaction(async (tx) => {
    if (status === 'ACTIVE') {
      await tx.cycle.updateMany({ where: { status: 'ACTIVE', id: { not: id } }, data: { status: 'DONE' } });
    }
    await tx.cycle.update({ where: { id }, data: { status } });
  });
  refresh();
}

// ================================================================== recall

export type GradeResponse = { ok: true; result: GradeResult } | { ok: false; error: string };

/** jobId: клієнт питає /api/ai/status?job=<id>, поки чекає (модель, секунди, що впало). */
export async function gradeRecall(input: GradeInput, jobId?: string): Promise<GradeResponse> {
  if (!isGeminiConfigured()) return { ok: false, error: 'GEMINI_API_KEY не задано в .env' };
  if (!input.answer.trim()) return { ok: false, error: 'Спершу напиши відповідь з пам\'яті' };
  try {
    return { ok: true, result: await gradeAnswer(input, jobId) };
  } catch (error) {
    console.error(error);
    return { ok: false, error: `Gemini не оцінив: ${error instanceof Error ? error.message : 'помилка'}` };
  }
}

export interface SaveRecallInput {
  topicId: number;
  questionId: number | null;
  answer: string;
  feedback: string;
  confidence: Exclude<Confidence, 'NOT_STARTED'>;
  /** скільки тривала сесія: йде в лог часу */
  seconds: number;
}

/** Зберегти відтворення: лог, новий колір, наступна дата, відмітка в щоденному чеклісті. */
export async function saveRecall(input: SaveRecallInput): Promise<{ nextTopicId: number | null }> {
  const now = new Date();
  const topic = await db.topic.findUniqueOrThrow({ where: { id: input.topicId } });
  const { intervalDays, nextReviewAt } = schedule(topic.intervalDays, input.confidence, now);
  const day = dayKey(now);

  await db.$transaction([
    db.recallLog.create({
      data: {
        topicId: input.topicId,
        questionId: input.questionId,
        answer: input.answer,
        feedback: input.feedback,
        confidenceAfter: input.confidence,
      },
    }),
    db.topic.update({
      where: { id: input.topicId },
      data: { confidence: input.confidence, lastRecallAt: now, intervalDays, nextReviewAt },
    }),
    ...(input.questionId && input.answer.trim()
      ? [db.question.update({ where: { id: input.questionId }, data: { myAnswer: input.answer } })]
      : []),
    db.dailyLog.upsert({ where: { day }, create: { day, recallDone: true }, update: { recallDone: true } }),
  ]);
  await logActivity({ minutes: Math.max(1, Math.ceil(input.seconds / 60)), kind: 'RECALL', topicId: input.topicId, track: null, note: '', at: now });
  // перша спроба задачі з навчального плану зараховується сама
  await markAttemptDone(topic, now);

  refresh();
  // задача з плану: назад на Today (там наступний крок, еталон); звичайна тема: одразу наступне повторення
  const isPlanProblem =
    topic.sourceId !== null &&
    (await db.planStep.count({ where: { sourceId: topic.sourceId, topicPath: topic.sourcePath, kind: 'ATTEMPT' } })) > 0;
  if (isPlanProblem) return { nextTopicId: null };
  const next = (await getDueTopics(now)).find((dueTopic) => dueTopic.id !== input.topicId);
  return { nextTopicId: next?.id ?? null };
}

// ================================================================== mock interview

export async function startMock(formData: FormData): Promise<void> {
  const custom = String(formData.get('custom') ?? '').trim();
  const problem = custom || String(formData.get('problem') ?? '').trim();
  if (!problem) return;
  const session = await db.mockSession.create({ data: { problem } });
  refresh();
  redirect(`/mock/${session.id}`);
}

// ================================================================== AI plan for the day

export type PlanActionResult = { ok: true; note?: string } | { ok: false; error: string };

export interface PlanSetup {
  budget: number;
  /** фокус дня: '' (нема), 'levels' або 'plan:<sourceId>', див. day-focus.ts */
  focus: string;
  /** побажання на день вільним текстом */
  wish: string;
  /** статус запиту до Gemini наживо: /api/ai/status?job=<id> */
  jobId?: string;
}

/** Фокус з клієнта перевіряємо: тільки існуючий навчальний план або рівні, якщо вони є. Назва йде в промпт. */
async function resolveFocus(focus: string): Promise<{ key: string; name: string | null }> {
  if (focus === LEVELS_FOCUS) {
    const scan = await scanLevels();
    return scan.levels.length > 0 ? { key: LEVELS_FOCUS, name: 'Live code (рівні)' } : { key: NO_FOCUS, name: null };
  }
  const studyPlans = await getStudyPlans();
  const plan = studyPlans.find((studyPlan) => planFocus(studyPlan.source.id) === focus);
  return plan ? { key: focus, name: plan.source.planName || plan.source.repo } : { key: NO_FOCUS, name: null };
}

const MAX_WISH_LENGTH = 300;

/**
 * Скласти (або перескласти) план на сьогодні. Результат завжди чернетка: до "Start the day" її можна правити.
 * Перепланування після старту зберігає зроблені пункти. Без ключа або при помилці Gemini: план за правилами.
 */
export async function generatePlan(setup: PlanSetup): Promise<PlanActionResult> {
  const now = new Date();
  const day = dayKey(now);
  const minutesBudget = Math.min(720, Math.max(30, Math.round(setup.budget)));
  const wish = setup.wish.trim().slice(0, MAX_WISH_LENGTH);
  const focus = await resolveFocus(setup.focus);

  const candidates = await buildCandidates(now, { focus: focus.key, budget: minutesBudget });
  const yesterday = await db.dailyPlan.findUnique({ where: { day: dayKey(new Date(now.getTime() - 24 * 60 * 60 * 1000)) } });
  const yesterdayUndone = yesterday
    ? (await withStatus(parsePlanItems(yesterday.items), new Date(now.getTime() - 24 * 60 * 60 * 1000)))
        .filter((item) => !item.done)
        .map((item) => item.title)
    : [];

  let items: PlanItem[];
  let summary: string;
  let note: string | undefined;
  // чому Gemini не склав план: зберігаємо з планом, щоб червоний рядок не зник після перезавантаження
  let aiError = '';

  if (isGeminiConfigured()) {
    try {
      const result = await generateDayPlan({
        weekday: now.toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' }),
        minutesBudget,
        focus: focus.name,
        wish,
        candidates: candidates.map(({ id, kind, title, defaultMinutes, mandatory, hint }) => ({
          id,
          kind,
          title,
          defaultMinutes,
          mandatory: mandatory === true,
          // для справ примітка каже, скільки днів разова справа вже відкладається
          note: kind === 'TASK' ? hint ?? '' : '',
        })),
        yesterdayUndone,
      }, setup.jobId);
      const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
      // AI може вибирати тільки з кандидатів: невідомі id відкидаємо, дублікати теж
      const seen = new Set<string>();
      items = [];
      for (const picked of result.items) {
        const candidate = byId.get(picked.id);
        if (!candidate || seen.has(picked.id)) continue;
        seen.add(picked.id);
        items.push({ ...candidate, minutes: picked.minutes, why: picked.why, manualDone: false });
      }
      summary = result.summary;
      if (items.length === 0) throw new Error('Gemini вибрав пункти, яких нема серед кандидатів');
      items = enforceMandatory(items, candidates, minutesBudget);
    } catch (error) {
      console.error(error);
      ({ items, summary } = rulePlan(candidates, minutesBudget));
      aiError = error instanceof Error ? error.message : 'невідома помилка';
    }
  } else {
    ({ items, summary } = rulePlan(candidates, minutesBudget));
  }

  // план вийшов майже порожній: кажемо чому, а не лишаємо здогадуватись
  const hasStudyPlan = candidates.some((candidate) => candidate.mandatory === true);
  const hasCycle = candidates.some((candidate) => candidate.kind === 'CYCLE');
  const hasLevels = candidates.some((candidate) => candidate.kind === 'LEVEL');
  if (!hasStudyPlan && !hasCycle && !hasLevels) {
    const why = 'Мало пунктів: немає кроків навчального плану (додай репо з learn/plan.md на Sources) і немає активного циклу (Cycles).';
    note = note ? `${note} ${why}` : why;
  }

  // розминка першою, бос одразу після неї: це правило коду, AI його не переставить (у чернетці можна переставити руками)
  items = momentumOrder(items);
  // перепланування після старту: зроблене сьогодні лишається в плані
  const current = await getTodayPlan(now);
  if (current?.startedAt) items = keepDone(current.items, items);

  await db.dailyPlan.upsert({
    where: { day },
    create: { day, items: toJson(items), summary, focus: focus.key, wish, budget: minutesBudget, startedAt: null, aiError },
    update: { items: toJson(items), summary, review: '', focus: focus.key, wish, budget: minutesBudget, startedAt: null, aiError },
  });
  refresh();
  return { ok: true, note };
}

function toJson(items: PlanItem[]): object[] {
  return items.map((item) => ({ ...item }));
}

/** Правка чернетки. Після "Start the day" план не міняється: тільки галочки або перепланування. */
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

/** Перетягування в чернетці: пункт стає на позицію toIndex. */
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

/** Додати в чернетку кандидата, якого план не взяв (з тим самим фокусом і бюджетом, з якими план складали). */
export async function addPlanItem(candidateId: string): Promise<PlanActionResult> {
  const now = new Date();
  const plan = await db.dailyPlan.findUnique({ where: { day: dayKey(now) } });
  const candidates = await buildCandidates(now, {
    focus: plan?.focus ?? NO_FOCUS,
    budget: plan?.budget || DEFAULT_BUDGET,
  });
  return editDraft((items) => addToDraft(items, candidateId, candidates));
}

/** Нова разова справа прямо з чернетки: потрапляє в план і в Tasks (якщо не зробиш, план запропонує її завтра). */
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

/** Кнопка "+ 3 live coding": три разові справи на початок чернетки, без опису. */
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
    // разова справа закривається і в Tasks, повторювана живе тільки в плані дня
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

/** Ручна галочка в плані дня = запис часу в stats на minutes пункту; зняв галочку = запис зникає. */
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

// ================================================================== tasks (справи поза навчанням)

const TASK_REPEATS: readonly TaskRepeat[] = ['ONCE', 'DAILY', 'WEEKDAYS'];

/** "2026-10-19" з поля type="date" -> ключ дня для колонки DATE (як dayKey); порожнє або криве -> null */
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
  // з форми Tasks разова справа йде в беклог; повторювана одразу в роботі, бо беклог для неї не має сенсу
  const status: TaskStatus = repeat === 'ONCE' ? 'BACKLOG' : 'TODO';
  await db.task.create({ data: { title, minutes: clampMinutes(Number(formData.get('minutes') ?? 30)), repeat, target, until, status, priority } });
  refresh();
}

/** Перекинути справу між колонками борду. 'DONE' ставить doneAt, інший статус знімає його. */
export async function setTaskStatus(id: number, status: TaskStatus | 'DONE'): Promise<void> {
  await updateBacklogTask(id, { status });
  refresh();
}

export async function setTaskPriority(id: number, formData: FormData): Promise<void> {
  await db.task.update({ where: { id }, data: { priority: clampPriority(Number(formData.get('priority') ?? 3)) } });
  refresh();
}

/** Ціль на день: 0 = звичайна справа з галочкою, більше = сесія з лічильником і баштою. */
export async function setTaskTarget(id: number, formData: FormData): Promise<void> {
  await db.task.update({ where: { id }, data: { target: clampTarget(Number(formData.get('target') ?? 0)) } });
  refresh();
}

export type TickResult = { ok: true; count: number; target: number } | { ok: false; error: string };

const MAX_TICK_NOTE = 300;

/** Разова справа закривається, коли сьогодні дійшла до цілі, і відкривається, якщо -1 опустив нижче. */
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

/** +1 у сесії: відправив резюме. note = компанія або посилання, можна порожнє. */
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

/** +1 зі сторінки Tasks: форма без нотатки. */
export async function tickTaskForm(taskId: number): Promise<void> {
  await tickTask(taskId, '');
}

/** -1: прибрати останній сьогоднішній крок (клікнув зайве). */
export async function untickTask(taskId: number): Promise<TickResult> {
  const now = new Date();
  const last = await db.taskTick.findFirst({ where: { taskId, day: dayKey(now) }, orderBy: { createdAt: 'desc' } });
  if (last) await db.taskTick.delete({ where: { id: last.id } });
  const count = (await todayTickCounts([taskId], now)).get(taskId) ?? 0;
  const result = await syncOnceDone(taskId, count);
  refresh();
  return result;
}

export async function setTaskDone(id: number, done: boolean): Promise<void> {
  await db.task.update({ where: { id }, data: { doneAt: done ? new Date() : null } });
  refresh();
}

export async function deleteTask(id: number): Promise<void> {
  await db.task.delete({ where: { id } });
  refresh();
}

/** Пропустити поточний вузол карти: переносимо його в кінець дня. Кроки навчального плану (mandatory) не переставляються. */
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
  await db.dailyPlan.update({ where: { day }, data: { items: items.map((planItem) => ({ ...planItem })) } });
  refresh();
}

/** Вечірня перевірка: апка сама рахує виконане, Gemini пише короткий огляд. */
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

// ================================================================== Gemini: перевірка моделей

export type GeminiCheckResponse = { ok: true; results: ModelCheck[] } | { ok: false; error: string };

/** Кнопка "Перевірити Gemini" на Sources: по крихітному запиту на кожну модель з GEMINI_MODEL. */
export async function checkGeminiNow(): Promise<GeminiCheckResponse> {
  if (!isGeminiConfigured()) return { ok: false, error: 'GEMINI_API_KEY не задано в .env' };
  return { ok: true, results: await checkModels() };
}

// ================================================================== activity log

export async function addActivity(formData: FormData): Promise<void> {
  const minutes = Number(formData.get('minutes') ?? 0);
  const topicRaw = String(formData.get('topicId') ?? '');
  const trackRaw = String(formData.get('track') ?? '');
  await logActivity({
    minutes,
    kind: (formData.get('kind') as ActivityKind | null) ?? 'STUDY',
    topicId: topicRaw ? Number(topicRaw) : null,
    track: trackRaw ? (trackRaw as Track) : null,
    note: String(formData.get('note') ?? ''),
  });
  refresh();
}

export async function deleteActivity(id: number): Promise<void> {
  await db.activityLog.delete({ where: { id } });
  refresh();
}

// ================================================================== sources (repo -> app sync)

export async function addSource(formData: FormData): Promise<void> {
  const repo = normalizeRepo(String(formData.get('repo') ?? ''));
  if (!repo) return;
  const branch = String(formData.get('branch') ?? '').trim() || 'main';
  const source = await db.source.upsert({ where: { repo }, update: { branch }, create: { repo, branch } });
  await syncSource(source.id, { force: true });
  refresh();
}

/** Від'єднати репо. Тема і картки лишаються в апці як звичайні (їх можна редагувати руками). */
export async function removeSource(id: number): Promise<void> {
  await db.$transaction([
    db.question.updateMany({ where: { sourceId: id }, data: { sourceKey: null, editedInApp: false } }),
    db.source.delete({ where: { id } }),
  ]);
  refresh();
}

export async function syncSourceNow(id: number): Promise<SyncResult> {
  const result = await syncSource(id, { force: true });
  refresh();
  return result;
}

export async function syncAllNow(): Promise<SyncResult[]> {
  const results = await syncAll();
  refresh();
  return results;
}

// ================================================================== study plan (learn/plan.md)

export async function setPlanStepDone(stepId: number, done: boolean): Promise<void> {
  await db.planStep.update({ where: { id: stepId }, data: { doneAt: done ? new Date() : null } });
  refresh();
}

// ================================================================== cards (замість Anki)

/**
 * Оцінка картки. Без refresh(): інакше кожна картка перемальовувала б усю сторінку і сесія гальмувала.
 * Сторінка оновлюється один раз, коли сесія закінчилась (finishCardSession).
 */
export async function gradeCard(input: ReviewInput): Promise<{ remaining: number }> {
  const now = new Date();
  await reviewCard(input, now);
  const counts = await getCardCounts(now);
  const remaining = counts.due + counts.fresh;
  if (remaining === 0 && input.grade !== 'PRACTICE') {
    const day = dayKey(now);
    await db.dailyLog.upsert({ where: { day }, create: { day, cardsDone: true }, update: { cardsDone: true } });
  }
  return { remaining };
}

export async function finishCardSession(): Promise<void> {
  refresh();
}

/** All cards → New card. Повертає false, якщо питання порожнє і картку не створено. */
export async function addCard(input: NewCardInput): Promise<boolean> {
  const id = await createCard(input);
  if (id !== null) refresh();
  return id !== null;
}

/** Вибір категорії на картці. false = категорію не змінено (картка з репо або її вже нема). */
export async function chooseCardCategory(id: number, topicId: number | null): Promise<boolean> {
  const changed = await setCardCategory(id, topicId);
  if (changed) refresh();
  return changed;
}

/** "+ Add new" у виборі категорії: нова тема з цією назвою. null = порожня назва. */
export async function addCategory(name: string): Promise<CategoryChoice | null> {
  const category = await createCategory(name);
  if (category) refresh();
  return category;
}

/** All cards → Edit. Картка з репо після цього більше не оновлюється з questions.md. */
export async function editCard(id: number, input: CardTextInput): Promise<void> {
  await updateCard(id, input);
  refresh();
}

/** Сторінка категорії → Deadline. "" = прибрати. Дата як YYYY-MM-DD, зберігається без часу. */
export async function changeCategoryDeadline(topicId: number, value: string): Promise<boolean> {
  if (value && !isDateKey(value)) return false;
  await setCategoryDeadline(topicId, value ? new Date(`${value}T00:00:00Z`) : null);
  refresh();
  return true;
}

/** All cards → Delete. Картку з репо Sync не поверне. */
export async function removeCard(id: number): Promise<void> {
  await deleteCard(id);
  refresh();
}

// ================================================================== import (Q:/A: текст -> картки)

const MAX_IMPORT_CHARS = 500_000;

/** Import → передпоказ: скільки карток розпізнано і де помилки формату. */
export async function previewCardImport(text: string): Promise<ImportPreview> {
  return previewImport(text.slice(0, MAX_IMPORT_CHARS));
}

export type CardImportOutcome = { ok: true; result: ImportResult } | { ok: false; error: string };

/** Import → Import. Помилки формату і дедлайну повертаються текстом, не кидаються. */
export async function runCardImport(text: string, target: ImportTarget): Promise<CardImportOutcome> {
  try {
    const result = await importCards(text.slice(0, MAX_IMPORT_CHARS), target);
    await finishImport(result);
    refresh();
    return { ok: true, result };
  } catch (error) {
    if (error instanceof ImportError) return { ok: false, error: error.message };
    throw error;
  }
}

// ================================================================== levels (вправи live-code)

const MAX_CODE_CHARS = 200_000;

export type LevelRunResponse =
  | { ok: true; passed: boolean; timedOut: boolean; output: string; durationMs: number; reference: string | null }
  | { ok: false; error: string };

export type LevelGiveUpResponse = { ok: true; reference: string } | { ok: false; error: string };

/** Час на рівень пишемо в Stats один раз за день: на перший прохід або "здався". */
async function logLevelTime(levelKey: string, title: string, elapsedMinutes: number, maxMinutes: number, gaveUp: boolean): Promise<void> {
  const now = new Date();
  const earlier = await db.levelAttempt.count({
    where: { levelKey, createdAt: { gte: startOfDay(now), lte: endOfDay(now) }, OR: [{ passed: true }, { gaveUp: true }] },
  });
  if (earlier > 1) return; // щойно записана спроба вже в цьому числі
  await logActivity({
    minutes: Math.min(Math.max(elapsedMinutes, 1), maxMinutes),
    kind: 'DRILL',
    topicId: null,
    track: 'NODE',
    note: `${gaveUp ? 'Level (gave up)' : 'Level'}: ${title}`,
  });
}

/** Прогнати код рівня через тести вправи. Зелені тести = рівень пройдено. */
export async function runLevelAttempt(key: string, code: string, elapsedMinutes: number): Promise<LevelRunResponse> {
  const level = await findLevel(key);
  if (!level) return { ok: false, error: 'Level not found. Check LEVELS_DIR in .env.' };
  if (code.length > MAX_CODE_CHARS) return { ok: false, error: 'The code is too long.' };
  if (!code.trim()) return { ok: false, error: 'Write some code first.' };

  const result = await runLevel(levelsDir(), level, code);
  await db.levelAttempt.create({
    data: { levelKey: level.key, code, passed: result.passed, output: result.output, durationMs: result.durationMs },
  });
  if (result.passed) await logLevelTime(level.key, level.title, elapsedMinutes, level.minutes * 3, false);
  refresh();
  const reference = result.passed ? (await getLevelDetails(level)).reference : null;
  return { ok: true, passed: result.passed, timedOut: result.timedOut, output: result.output, durationMs: result.durationMs, reference };
}

/** Здатися: відкрити еталон до проходження. Рівень повернеться через 2 дні, рамка за сьогодні не росте. */
export async function giveUpLevel(key: string, code: string, elapsedMinutes: number): Promise<LevelGiveUpResponse> {
  const level = await findLevel(key);
  if (!level) return { ok: false, error: 'Level not found. Check LEVELS_DIR in .env.' };
  await db.levelAttempt.create({ data: { levelKey: level.key, code: code.slice(0, MAX_CODE_CHARS), passed: false, gaveUp: true } });
  await logLevelTime(level.key, level.title, elapsedMinutes, level.minutes * 3, true);
  refresh();
  return { ok: true, reference: (await getLevelDetails(level)).reference };
}
