'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { dayKey } from '@/lib/queries';
import { schedule } from '@/lib/schedule';
import { generateDayPlan, gradeAnswer, isGeminiConfigured, reviewDay, type GradeInput, type GradeResult } from '@/lib/gemini';
import { buildCandidates, getTodayPlan, parsePlanItems, rulePlan, todayRecallSummary, withStatus, type PlanItem } from '@/lib/planner';
import { logActivity } from '@/lib/activity';
import { normalizeRepo, syncAll, syncAllIfStale, syncSource, type SyncResult } from '@/lib/sync';
import type { ActivityKind, Confidence, CycleStatus, Track } from '@/generated/prisma/enums';

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
  // картки з репо редагуються в репо; в апці тільки твоя відповідь з пам'яті
  if (question.sourceId !== null && field !== 'myAnswer') return;
  await db.question.update({ where: { id }, data: { [field]: value } });
  refresh();
}

export async function setQuestionInAnki(id: number, inAnki: boolean): Promise<void> {
  await db.question.update({ where: { id }, data: { inAnki } });
  refresh();
}

export async function deleteQuestion(id: number): Promise<void> {
  await db.question.delete({ where: { id } });
  refresh();
}

// ================================================================== daily

export type DailyField = 'ankiDone' | 'recallDone' | 'outLoud';

export async function setDaily(field: DailyField, value: boolean): Promise<void> {
  const day = dayKey(new Date());
  await db.dailyLog.upsert({ where: { day }, create: { day, [field]: value }, update: { [field]: value } });
  refresh();
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

export async function gradeRecall(input: GradeInput): Promise<GradeResponse> {
  if (!isGeminiConfigured()) return { ok: false, error: 'GEMINI_API_KEY не задано в .env' };
  if (!input.answer.trim()) return { ok: false, error: 'Спершу напиши відповідь з пам\'яті' };
  try {
    return { ok: true, result: await gradeAnswer(input) };
  } catch (error) {
    console.error(error);
    return { ok: false, error: error instanceof Error ? error.message : 'Gemini request failed' };
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

  const next = await db.topic.findFirst({
    where: {
      id: { not: input.topicId },
      OR: [{ nextReviewAt: { lte: now } }, { confidence: 'RED' }],
    },
    orderBy: [{ lastRecallAt: { sort: 'asc', nulls: 'first' } }],
    select: { id: true },
  });
  refresh();
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

/** Скласти (або перескласти) план на сьогодні. Без ключа або при помилці Gemini: план за правилами. */
export async function generatePlan(minutesBudget: number): Promise<PlanActionResult> {
  const now = new Date();
  const day = dayKey(now);
  const candidates = await buildCandidates(now);
  const yesterday = await db.dailyPlan.findUnique({ where: { day: dayKey(new Date(now.getTime() - 24 * 60 * 60 * 1000)) } });
  const yesterdayUndone = yesterday
    ? (await withStatus(parsePlanItems(yesterday.items), new Date(now.getTime() - 24 * 60 * 60 * 1000)))
        .filter((item) => !item.done)
        .map((item) => item.title)
    : [];

  let items: PlanItem[];
  let summary: string;
  let note: string | undefined;

  if (isGeminiConfigured()) {
    try {
      const result = await generateDayPlan({
        weekday: now.toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' }),
        minutesBudget,
        candidates: candidates.map(({ id, kind, title, defaultMinutes }) => ({ id, kind, title, defaultMinutes })),
        yesterdayUndone,
      });
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
      if (items.length === 0) throw new Error('Gemini returned no valid items');
    } catch (error) {
      console.error(error);
      ({ items, summary } = rulePlan(candidates, minutesBudget));
      note = `Gemini не відповів (${error instanceof Error ? error.message.slice(0, 120) : 'error'}), склав план за правилами.`;
    }
  } else {
    ({ items, summary } = rulePlan(candidates, minutesBudget));
  }

  const itemsJson = items.map((item) => ({ ...item }));
  await db.dailyPlan.upsert({
    where: { day },
    create: { day, items: itemsJson, summary },
    update: { items: itemsJson, summary, review: '' },
  });
  refresh();
  return { ok: true, note };
}

export async function setPlanItemDone(itemId: string, done: boolean): Promise<void> {
  const day = dayKey(new Date());
  const plan = await db.dailyPlan.findUnique({ where: { day } });
  if (!plan) return;
  const items = parsePlanItems(plan.items).map((item) => (item.id === itemId ? { ...item, manualDone: done } : item));
  await db.dailyPlan.update({ where: { day }, data: { items: items.map((item) => ({ ...item })) } });
  refresh();
}

/** Вечірня перевірка: апка сама рахує виконане, Gemini пише короткий огляд. */
export async function reviewToday(): Promise<PlanActionResult> {
  const now = new Date();
  const plan = await getTodayPlan(now);
  if (!plan) return { ok: false, error: 'Спершу склади план на сьогодні' };

  const done = plan.items.filter((item) => item.done);
  const undone = plan.items.filter((item) => !item.done);
  let review = `Зроблено ${done.length} з ${plan.items.length}.` +
    (undone.length ? ` Не зроблено: ${undone.map((item) => item.title).join('; ')}.` : ' Все виконано.');

  if (isGeminiConfigured()) {
    try {
      review = await reviewDay({
        items: plan.items.map((item) => ({ title: item.title, minutes: item.minutes, done: item.done })),
        recalls: await todayRecallSummary(now),
      });
    } catch (error) {
      console.error(error);
      review += ' (Gemini недоступний, огляд без AI.)';
    }
  }
  await db.dailyPlan.update({ where: { day: dayKey(now) }, data: { review } });
  refresh();
  return { ok: true };
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
  await syncSource(source.id);
  refresh();
}

/** Від'єднати репо. Тема і картки лишаються в апці як звичайні (їх можна редагувати руками). */
export async function removeSource(id: number): Promise<void> {
  await db.$transaction([
    db.question.updateMany({ where: { sourceId: id }, data: { sourceKey: null } }),
    db.source.delete({ where: { id } }),
  ]);
  refresh();
}

export async function syncSourceNow(id: number): Promise<SyncResult> {
  const result = await syncSource(id);
  refresh();
  return result;
}

export async function syncAllNow(): Promise<SyncResult[]> {
  const results = await syncAll();
  refresh();
  return results;
}

/** Викликається з Today при відкритті: тягне тільки ті репо, які не синкались 10+ хвилин. */
export async function autoSync(): Promise<number> {
  const synced = await syncAllIfStale();
  if (synced > 0) refresh();
  return synced;
}
