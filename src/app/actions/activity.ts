'use server';

import { db } from '@/lib/db';
import { logActivity } from '@/lib/activity';
import type { ActivityKind, Track } from '@/generated/prisma/enums';
import { refresh } from './shared';

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
