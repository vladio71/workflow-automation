import 'server-only';
import { createHash } from 'node:crypto';
import type { Source } from '@/generated/prisma/client';
import { db } from '@/lib/db';
import { parseQuestions, parseTopic, type ParsedCard } from '@/lib/learn-format';

/**
 * Sync = одна тема на репо. Апка читає з репо два файли:
 *   learn/topic.md      назва, трек, (необов'язково) нотатки
 *   learn/questions.md  картки Q/A і T
 * і робить з них тему + питання. Правила:
 *   - файл з помилками формату не імпортується взагалі (all-or-nothing), помилка видна на /sources;
 *   - картка впізнається за текстом питання: змінив відповідь, картка оновилась; змінив питання,
 *     це нова картка (стара видаляється, історія recall лишається в журналі без прив'язки);
 *   - змінилась відповідь CONCEPT-картки, тоді inAnki = false, щоб оновлена картка пішла в наступний експорт;
 *   - твоя відповідь з пам'яті (myAnswer), колір теми і розклад Sync не чіпає ніколи;
 *   - питання, додані руками в апці, Sync не чіпає.
 */

const STALE_AFTER_MS = 10 * 60 * 1000;

export interface SyncResult {
  ok: boolean;
  summary: string;
}

class SyncError extends Error {}

export function repoUrl(source: Pick<Source, 'repo'>): string {
  return `https://github.com/${source.repo}`;
}

export function refUrl(source: Pick<Source, 'repo' | 'branch'>, ref: string): string {
  return `https://github.com/${source.repo}/blob/${source.branch}/${ref}`;
}

/** "owner/name", "https://github.com/owner/name", ".../name.git", ".../tree/branch" -> "owner/name". */
export function normalizeRepo(input: string): string | null {
  const cleaned = input
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '');
  const match = cleaned.match(/^([\w.-]+)\/([\w.-]+)/);
  return match ? `${match[1]}/${match[2]}` : null;
}

async function fetchRepoFile(source: Source, path: string): Promise<string> {
  const url = `https://api.github.com/repos/${source.repo}/contents/${path}?ref=${encodeURIComponent(source.branch)}`;
  const headers: Record<string, string> = {
    accept: 'application/vnd.github.raw',
    'user-agent': 'learning-app',
  };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  const response = await fetch(url, { headers, cache: 'no-store' });
  if (response.status === 404) {
    throw new SyncError(`${path} not found in ${source.repo}@${source.branch} (private repo? set GITHUB_TOKEN)`);
  }
  if (response.status === 401) throw new SyncError('GitHub 401: GITHUB_TOKEN is invalid or expired');
  if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
    throw new SyncError('GitHub rate limit (60 requests/hour without a token): wait or set GITHUB_TOKEN');
  }
  if (!response.ok) throw new SyncError(`GitHub ${response.status} for ${path}`);
  return response.text();
}

/** Стабільний ключ картки: репо + тип + текст питання без різниці в регістрі та пробілах. */
function cardKey(repo: string, card: ParsedCard): string {
  const normalized = card.question.toLowerCase().replace(/\s+/g, ' ').trim();
  return createHash('sha1').update(`${repo}\n${card.kind}\n${normalized}`).digest('hex');
}

export async function syncSource(sourceId: number): Promise<SyncResult> {
  const source = await db.source.findUniqueOrThrow({ where: { id: sourceId } });
  try {
    const summary = await pullSource(source);
    await db.source.update({
      where: { id: source.id },
      data: { lastSyncedAt: new Date(), lastError: '', lastSummary: summary },
    });
    return { ok: true, summary };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.source.update({ where: { id: source.id }, data: { lastSyncedAt: new Date(), lastError: message } });
    return { ok: false, summary: message };
  }
}

async function pullSource(source: Source): Promise<string> {
  const [topicText, questionsText] = await Promise.all([
    fetchRepoFile(source, 'learn/topic.md'),
    fetchRepoFile(source, 'learn/questions.md'),
  ]);

  const topicFile = parseTopic(topicText);
  const questionsFile = parseQuestions(questionsText);
  const errors = [...topicFile.errors, ...questionsFile.errors.map((error) => `questions.md ${error}`)];
  if (errors.length > 0) throw new SyncError(errors.slice(0, 5).join('; '));

  return db.$transaction(async (tx) => {
    const topicData = {
      name: topicFile.name,
      track: topicFile.track,
      ...(topicFile.notes ? { notes: topicFile.notes } : {}),
    };
    const existingTopic = await tx.topic.findUnique({ where: { sourceId: source.id } });
    const topic = existingTopic
      ? await tx.topic.update({ where: { id: existingTopic.id }, data: topicData })
      : await tx.topic.create({ data: { ...topicData, source: repoUrl(source), sourceId: source.id } });

    const existing = await tx.question.findMany({ where: { sourceId: source.id } });
    const byKey = new Map(existing.map((question) => [question.sourceKey, question]));
    const keysInFile = new Set<string>();
    let added = 0;
    let updated = 0;

    for (const card of questionsFile.cards) {
      const sourceKey = cardKey(source.repo, card);
      keysInFile.add(sourceKey);
      const data = {
        kind: card.kind,
        question: card.question,
        reference: card.answer,
        ref: card.ref,
        check: card.check,
        topicId: topic.id,
      };

      const current = byKey.get(sourceKey);
      if (!current) {
        // TASK-картки в Anki не йдуть, тому одразу позначені як "не для експорту"
        await tx.question.create({ data: { ...data, sourceKey, sourceId: source.id, inAnki: card.kind === 'TASK' } });
        added += 1;
        continue;
      }

      const changed =
        current.question !== data.question ||
        current.reference !== data.reference ||
        current.ref !== data.ref ||
        current.check !== data.check ||
        current.topicId !== data.topicId;
      if (!changed) continue;

      const answerChanged = current.reference !== data.reference && card.kind === 'CONCEPT';
      await tx.question.update({
        where: { id: current.id },
        data: answerChanged ? { ...data, inAnki: false } : data,
      });
      updated += 1;
    }

    const removedIds = existing.filter((question) => !keysInFile.has(question.sourceKey ?? '')).map((question) => question.id);
    if (removedIds.length > 0) await tx.question.deleteMany({ where: { id: { in: removedIds } } });

    const concepts = questionsFile.cards.filter((card) => card.kind === 'CONCEPT').length;
    const tasks = questionsFile.cards.length - concepts;
    return `${concepts} Q · ${tasks} tasks (+${added} new, ${updated} updated, ${removedIds.length} removed)`;
  });
}

export async function syncAll(): Promise<SyncResult[]> {
  const sources = await db.source.findMany({ orderBy: { id: 'asc' } });
  const results: SyncResult[] = [];
  for (const source of sources) results.push(await syncSource(source.id));
  return results;
}

/** Для автосинку при відкритті Today: не частіше, ніж раз на 10 хвилин на джерело. */
export async function syncAllIfStale(): Promise<number> {
  const threshold = new Date(Date.now() - STALE_AFTER_MS);
  const stale = await db.source.findMany({
    where: { OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: threshold } }] },
  });
  for (const source of stale) await syncSource(source.id);
  return stale.length;
}
