'use server';

import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { dayKey, getDueTopics } from '@/lib/queries';
import { schedule } from '@/lib/schedule';
import { gradeAnswer, isGeminiConfigured, type GradeInput, type GradeResult } from '@/lib/gemini';
import { markAttemptDone } from '@/lib/study-plan';
import { logActivity } from '@/lib/activity';
import type { Confidence } from '@/generated/prisma/enums';
import { refresh } from './shared';

// ─── Recall session ──────────────────────────────────────────────────────────

export type GradeResponse = { ok: true; result: GradeResult } | { ok: false; error: string };

/** jobId: the client polls /api/ai/status?job=<id> while it waits (model, seconds, what failed). */
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
  /** Session length, goes into the time log. */
  seconds: number;
}

/** Save a recall: the log, the new color, the next date, the tick in the daily checklist. */
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
  // The first attempt at a study-plan problem counts on its own.
  await markAttemptDone(topic, now);

  refresh();
  // A plan problem sends the user back to Today (next step, the reference); a regular topic goes straight to the next review.
  const isPlanProblem =
    topic.sourceId !== null &&
    (await db.planStep.count({ where: { sourceId: topic.sourceId, topicPath: topic.sourcePath, kind: 'ATTEMPT' } })) > 0;
  if (isPlanProblem) return { nextTopicId: null };
  const next = (await getDueTopics(now)).find((dueTopic) => dueTopic.id !== input.topicId);
  return { nextTopicId: next?.id ?? null };
}

// ─── Mock interview ──────────────────────────────────────────────────────────

export async function startMock(formData: FormData): Promise<void> {
  const custom = String(formData.get('custom') ?? '').trim();
  const problem = custom || String(formData.get('problem') ?? '').trim();
  if (!problem) return;
  const session = await db.mockSession.create({ data: { problem } });
  refresh();
  redirect(`/mock/${session.id}`);
}
