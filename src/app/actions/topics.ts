'use server';

import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { deleteCard } from '@/lib/cards';
import type { Confidence, Track } from '@/generated/prisma/enums';
import { refresh } from './shared';

// ─── Topics ──────────────────────────────────────────────────────────────────

export type TopicTextField = 'name' | 'notes' | 'drill' | 'source';

export async function updateTopicText(id: number, field: TopicTextField, value: string): Promise<void> {
  await db.topic.update({ where: { id }, data: { [field]: value } });
  refresh();
}

export async function setTopicTrack(id: number, track: Track): Promise<void> {
  await db.topic.update({ where: { id }, data: { track } });
  refresh();
}

/** A manual color change in the table. Dates stay: only a recall session moves the schedule. */
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

/** Quick add from the table row: name and track, without leaving the page. */
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

// ─── Questions ───────────────────────────────────────────────────────────────

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
  // On these pages repo cards are read-only except the answer from memory; their text changes through All cards -> Edit.
  if (question.sourceId !== null && field !== 'myAnswer') return;
  await db.question.update({ where: { id }, data: { [field]: value } });
  refresh();
}

/** Through deleteCard, so a repo question leaves a record and Sync does not recreate it. */
export async function deleteQuestion(id: number): Promise<void> {
  await deleteCard(id);
  refresh();
}
