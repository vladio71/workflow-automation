'use server';

import { db } from '@/lib/db';
import { checkModels, isGeminiConfigured, type ModelCheck } from '@/lib/gemini';
import { normalizeRepo, syncAll, syncSource, type SyncResult } from '@/lib/sync';
import { refresh } from './shared';

// ─── Sources (repo -> app sync) ──────────────────────────────────────────────

export async function addSource(formData: FormData): Promise<void> {
  const repo = normalizeRepo(String(formData.get('repo') ?? ''));
  if (!repo) return;
  const branch = String(formData.get('branch') ?? '').trim() || 'main';
  const source = await db.source.upsert({ where: { repo }, update: { branch }, create: { repo, branch } });
  await syncSource(source.id, { force: true });
  refresh();
}

/** Detach a repo. Its topics and cards stay in the app as regular ones, editable by hand. */
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

// ─── Gemini health check ─────────────────────────────────────────────────────

export type GeminiCheckResponse = { ok: true; results: ModelCheck[] } | { ok: false; error: string };

/** The "check Gemini" button on Sources: one tiny request per model in GEMINI_MODEL. */
export async function checkGeminiNow(): Promise<GeminiCheckResponse> {
  if (!isGeminiConfigured()) return { ok: false, error: 'GEMINI_API_KEY не задано в .env' };
  return { ok: true, results: await checkModels() };
}
