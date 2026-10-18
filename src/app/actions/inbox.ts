'use server';

import { db } from '@/lib/db';
import type { Track } from '@/generated/prisma/enums';
import { refresh } from './shared';

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
