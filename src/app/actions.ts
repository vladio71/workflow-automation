'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { dayKey } from '@/lib/queries';
import { schedule } from '@/lib/schedule';
import { gradeAnswer, isGeminiConfigured, type GradeInput, type GradeResult } from '@/lib/gemini';
import type { Confidence, CycleStatus, Track } from '@/generated/prisma/enums';

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
