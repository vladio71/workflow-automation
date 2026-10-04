import 'server-only';
import { createHash } from 'node:crypto';
import type { Source } from '@/generated/prisma/client';
import { db } from '@/lib/db';
import { isUrl, parsePlan, parseQuestions, parseTopic, type ParsedCard, type ParsedPlan, type ParsedTopic } from '@/lib/learn-format';

/**
 * Sync тягне з репо папку learn/ і робить з неї теми + картки.
 *
 * Дві розкладки (можна змішувати):
 *   learn/topic.md + learn/questions.md                  одна тема на все репо (graphql-base)
 *   learn/<module>/topic.md + learn/<module>/questions.md  тема на кожну папку (system-design-reps)
 *   learn/plan.md (необов'язково)                           навчальний план: кроки по порядку, прогрес живе в апці
 *
 * Правила:
 *   - спершу питаємо SHA останнього коміту гілки; не змінився з минулого успішного sync, тоді нічого не качаємо;
 *   - помилка формату в будь-якому файлі: не імпортується нічого (all-or-nothing), помилка видна на /sources;
 *   - картка впізнається за текстом питання: змінив відповідь, картка оновилась; змінив питання,
 *     це нова картка (стара видаляється, історія recall лишається в журналі без прив'язки);
 *   - змінилась відповідь картки: оновлюється текст, розклад картки (Cards) лишається;
 *   - твоя відповідь з пам'яті (myAnswer), колір теми і розклад Sync не чіпає ніколи;
 *   - папку теми видалили з репо: її картки зникають, сама тема лишається як звичайна (з історією);
 *   - питання, додані руками в апці, Sync не чіпає;
 *   - картку з репо змінили в апці (All cards → Edit): Sync більше не перезаписує її текст,
 *     а якщо питання зникло з репо, картка лишається в апці як звичайна;
 *   - картку з репо видалили в апці: Sync не створює її знову, поки це питання є в репо.
 */

const STALE_AFTER_MS = 10 * 60 * 1000;
/** скільки запитів до GitHub одночасно: послідовно 40 файлів це секунди очікування, 40 паралельних GitHub не любить */
const GITHUB_CONCURRENCY = 6;

export interface SyncResult {
  ok: boolean;
  summary: string;
}

class SyncError extends Error {}

export function repoUrl(source: Pick<Source, 'repo'>): string {
  return `https://github.com/${source.repo}`;
}

/** Ref:/Link: з репо -> посилання на GitHub; повний URL лишається як є. */
export function refUrl(source: Pick<Source, 'repo' | 'branch'>, ref: string): string {
  if (isUrl(ref)) return ref;
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

interface RepoTopicFiles {
  /** "" для learn/topic.md, інакше назва папки в learn/ */
  path: string;
  topic: ParsedTopic;
  notes: string;
  cards: ParsedCard[];
}

interface GitHubDirEntry {
  name: string;
  type: string;
}

async function github(source: Source, apiPath: string, accept: string): Promise<Response> {
  const headers: Record<string, string> = { accept, 'user-agent': 'learning-app' };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  const response = await fetch(`https://api.github.com/repos/${source.repo}/${apiPath}`, { headers, cache: 'no-store' });
  if (response.status === 401) throw new SyncError('GitHub 401: GITHUB_TOKEN is invalid or expired');
  if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
    throw new SyncError('GitHub rate limit (60 requests/hour without a token): wait or set GITHUB_TOKEN');
  }
  return response;
}

async function fetchLatestSha(source: Source): Promise<string> {
  const response = await github(source, `commits/${encodeURIComponent(source.branch)}`, 'application/vnd.github.sha');
  if (response.status === 404 || response.status === 422) {
    throw new SyncError(`${source.repo}@${source.branch} not found (private repo? set GITHUB_TOKEN; wrong branch?)`);
  }
  if (!response.ok) throw new SyncError(`GitHub ${response.status} for ${source.repo}@${source.branch}`);
  return (await response.text()).trim();
}

/** Файл з репо на конкретному коміті; null, якщо файлу немає. */
async function fetchFile(source: Source, sha: string, path: string): Promise<string | null> {
  const response = await github(source, `contents/${path}?ref=${sha}`, 'application/vnd.github.raw');
  if (response.status === 404) return null;
  if (!response.ok) throw new SyncError(`GitHub ${response.status} for ${path}`);
  return response.text();
}

async function listDir(source: Source, sha: string, path: string): Promise<GitHubDirEntry[] | null> {
  const response = await github(source, `contents/${path}?ref=${sha}`, 'application/vnd.github+json');
  if (response.status === 404) return null;
  if (!response.ok) throw new SyncError(`GitHub ${response.status} for ${path}/`);
  const body: unknown = await response.json();
  return Array.isArray(body) ? (body as GitHubDirEntry[]) : null;
}

async function readTopicFolder(source: Source, sha: string, path: string): Promise<RepoTopicFiles | null> {
  const base = path ? `learn/${path}` : 'learn';
  const [topicText, questionsText] = await Promise.all([
    fetchFile(source, sha, `${base}/topic.md`),
    fetchFile(source, sha, `${base}/questions.md`),
  ]);
  if (topicText === null) return null; // папка без topic.md не тема
  if (questionsText === null) throw new SyncError(`${base}/questions.md is missing`);

  const topic = parseTopic(topicText);
  const questions = parseQuestions(questionsText);
  const errors = [
    ...topic.errors.map((error) => `${base}/${error}`),
    ...questions.errors.map((error) => `${base}/questions.md ${error}`),
  ];
  if (errors.length > 0) throw new SyncError(errors.slice(0, 5).join('; '));

  let notes = topic.notes;
  if (topic.notesFile) {
    const notesText = await fetchFile(source, sha, topic.notesFile);
    if (notesText === null) throw new SyncError(`${base}/topic.md: notes file not found: ${topic.notesFile}`);
    notes = notesText.trim();
  }
  return { path, topic, notes, cards: questions.cards };
}

interface RepoLearn {
  folders: RepoTopicFiles[];
  plan: ParsedPlan | null;
}

async function readLearn(source: Source, sha: string): Promise<RepoLearn> {
  const entries = await listDir(source, sha, 'learn');
  if (entries === null) throw new SyncError(`learn/ not found in ${source.repo}@${source.branch}`);

  const paths: string[] = [];
  if (entries.some((entry) => entry.type === 'file' && entry.name === 'topic.md')) paths.push('');
  for (const entry of entries) {
    if (entry.type === 'dir') paths.push(entry.name);
  }

  const read = await mapWithLimit(paths, GITHUB_CONCURRENCY, (path) => readTopicFolder(source, sha, path));
  const folders: RepoTopicFiles[] = [];
  for (const folder of read) {
    if (folder) folders.push(folder);
  }
  if (folders.length === 0) throw new SyncError('learn/ has no topic.md (neither learn/topic.md nor learn/<module>/topic.md)');

  let plan: ParsedPlan | null = null;
  if (entries.some((entry) => entry.type === 'file' && entry.name === 'plan.md')) {
    const planText = await fetchFile(source, sha, 'learn/plan.md');
    if (planText !== null) {
      plan = parsePlan(planText);
      const errors = plan.errors.map((error) => `learn/plan.md ${error}`);
      const folderPaths = new Set(folders.map((folder) => folder.path));
      for (const step of plan.steps) {
        if (step.topic && !folderPaths.has(step.topic)) errors.push(`learn/plan.md line ${step.line}: Topic learn/${step.topic}/ not found`);
      }
      if (errors.length > 0) throw new SyncError(errors.slice(0, 5).join('; '));
    }
  }
  return { folders, plan };
}

/** Як Promise.all, але не більше `limit` задач одночасно. Порядок результатів = порядок items. */
async function mapWithLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await fn(item);
    }
  };
  const workers: Promise<void>[] = [];
  for (let count = 0; count < Math.min(limit, items.length); count += 1) workers.push(worker());
  await Promise.all(workers);
  return results;
}

/** Стабільний ключ картки: репо + папка теми + тип + текст питання без різниці в регістрі та пробілах. */
function cardKey(repo: string, path: string, card: ParsedCard): string {
  const normalized = card.question.toLowerCase().replace(/\s+/g, ' ').trim();
  // для кореневої теми path не додаємо, щоб ключі карток graphql-base не змінились
  const scope = path ? `${repo}/${path}` : repo;
  return createHash('sha1').update(`${scope}\n${card.kind}\n${normalized}`).digest('hex');
}

export async function syncSource(sourceId: number, options: { force?: boolean } = {}): Promise<SyncResult> {
  const source = await db.source.findUniqueOrThrow({ where: { id: sourceId } });
  try {
    const sha = await fetchLatestSha(source);
    if (!options.force && sha === source.lastSha && !source.lastError) {
      await db.source.update({ where: { id: source.id }, data: { lastSyncedAt: new Date() } });
      return { ok: true, summary: source.lastSummary };
    }

    const learn = await readLearn(source, sha);
    const summary = await applyLearn(source, learn);
    await db.source.update({
      where: { id: source.id },
      data: { lastSyncedAt: new Date(), lastError: '', lastSummary: summary, lastSha: sha },
    });
    return { ok: true, summary };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.source.update({ where: { id: source.id }, data: { lastSyncedAt: new Date(), lastError: message } });
    return { ok: false, summary: message };
  }
}

async function applyLearn(source: Source, learn: RepoLearn): Promise<string> {
  const { folders, plan } = learn;
  return db.$transaction(
    async (tx) => {
    const existing = await tx.question.findMany({ where: { sourceId: source.id } });
    const byKey = new Map(existing.map((question) => [question.sourceKey, question]));
    const deletedRows = await tx.deletedCard.findMany({ where: { sourceId: source.id }, select: { sourceKey: true } });
    const deletedInApp = new Set(deletedRows.map((row) => row.sourceKey));
    const keysInRepo = new Set<string>();
    let added = 0;
    let updated = 0;
    let concepts = 0;
    let tasks = 0;
    let keptEdited = 0;
    let keptDeleted = 0;

    for (const folder of folders) {
      const topicData = {
        name: folder.topic.name,
        track: folder.topic.track,
        ...(folder.notes ? { notes: folder.notes } : {}),
        ...(folder.topic.drill ? { drill: folder.topic.drill } : {}),
      };
      const topic = await tx.topic.upsert({
        where: { sourceId_sourcePath: { sourceId: source.id, sourcePath: folder.path } },
        update: topicData,
        create: { ...topicData, source: repoUrl(source), sourceId: source.id, sourcePath: folder.path },
      });

      for (const card of folder.cards) {
        if (card.kind === 'CONCEPT') concepts += 1;
        else tasks += 1;

        const sourceKey = cardKey(source.repo, folder.path, card);
        keysInRepo.add(sourceKey);
        // видалили в апці: не створюємо знову
        if (deletedInApp.has(sourceKey)) {
          keptDeleted += 1;
          continue;
        }
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
          await tx.question.create({ data: { ...data, sourceKey, sourceId: source.id } });
          added += 1;
          continue;
        }
        // змінили в апці: текст з репо більше не накладаємо
        if (current.editedInApp) {
          keptEdited += 1;
          continue;
        }

        const changed =
          current.question !== data.question ||
          current.reference !== data.reference ||
          current.ref !== data.ref ||
          current.check !== data.check ||
          current.topicId !== data.topicId;
        if (!changed) continue;

        // умова в самому запиті: якщо картку встигли змінити чи видалити в апці, поки йде Sync, її не чіпаємо
        const result = await tx.question.updateMany({ where: { id: current.id, editedInApp: false }, data });
        updated += result.count;
      }
    }

    const gone = existing.filter((question) => !keysInRepo.has(question.sourceKey ?? ''));
    const removedIds = gone.filter((question) => !question.editedInApp).map((question) => question.id);
    if (removedIds.length > 0) await tx.question.deleteMany({ where: { id: { in: removedIds }, editedInApp: false } });

    // змінена в апці картка, якої в репо вже нема: не видаляємо, далі вона живе як звичайна картка апки
    const detachedIds = gone.filter((question) => question.editedInApp).map((question) => question.id);
    if (detachedIds.length > 0) {
      await tx.question.updateMany({
        where: { id: { in: detachedIds } },
        data: { sourceId: null, sourceKey: null, editedInApp: false },
      });
    }

    // записи про видалені в апці картки, яких у репо вже нема, більше не потрібні
    const staleDeleted = [...deletedInApp].filter((sourceKey) => !keysInRepo.has(sourceKey));
    if (staleDeleted.length > 0) {
      await tx.deletedCard.deleteMany({ where: { sourceId: source.id, sourceKey: { in: staleDeleted } } });
    }

    // теми, чиї папки зникли з репо: від'єднуємо, історія і кольори лишаються
    const livePaths = folders.map((folder) => folder.path);
    await tx.topic.updateMany({
      where: { sourceId: source.id, sourcePath: { notIn: livePaths } },
      data: { sourceId: null, sourcePath: '' },
    });

    // навчальний план: кроки по Id; прогрес (doneAt) лишається, навіть якщо крок перейменували чи пересунули
    const planSteps = plan?.steps ?? [];
    for (const [position, step] of planSteps.entries()) {
      const data = {
        position,
        group: step.group,
        title: step.title,
        minutes: step.minutes,
        kind: step.kind,
        link: step.link,
        topicPath: step.topic,
      };
      await tx.planStep.upsert({
        where: { sourceId_key: { sourceId: source.id, key: step.key } },
        update: data,
        create: { ...data, sourceId: source.id, key: step.key },
      });
    }
    await tx.planStep.deleteMany({ where: { sourceId: source.id, key: { notIn: planSteps.map((step) => step.key) } } });
    await tx.source.update({
      where: { id: source.id },
      data: { planName: plan?.name ?? '', planDailyMinutes: plan?.dailyMinutes ?? 0 },
    });

    const topicsLabel = folders.length === 1 ? '' : `${folders.length} topics · `;
    const planLabel = plan ? ` · plan: ${plan.steps.length} steps` : '';
    const inAppParts: string[] = [];
    if (keptEdited > 0) inAppParts.push(`${keptEdited} edited in app`);
    if (keptDeleted > 0) inAppParts.push(`${keptDeleted} deleted in app`);
    if (detachedIds.length > 0) inAppParts.push(`${detachedIds.length} edited kept after leaving the repo`);
    const inAppLabel = inAppParts.length > 0 ? ` · ${inAppParts.join(', ')}` : '';
    return `${topicsLabel}${concepts} Q · ${tasks} tasks (+${added} new, ${updated} updated, ${removedIds.length} removed)${inAppLabel}${planLabel}`;
    },
    // багато дрібних upsert-ів (картки, кроки плану): дефолтних 5 с може не вистачити
    { timeout: 30_000 },
  );
}

/** Кнопка "Sync all": force, тобто перечитати файли навіть якщо коміт той самий. */
export async function syncAll(): Promise<SyncResult[]> {
  const sources = await db.source.findMany({ orderBy: { id: 'asc' } });
  const results: SyncResult[] = [];
  for (const source of sources) results.push(await syncSource(source.id, { force: true }));
  return results;
}

let staleSyncInFlight: Promise<number> | null = null;

/**
 * Автосинк при відкритті Today: не частіше, ніж раз на 10 хвилин; без нових комітів це 1 запит до GitHub.
 * Single-flight (як у дрілі 02): дві вкладки відкрили Today одночасно, а sync іде один.
 */
export function syncAllIfStale(): Promise<number> {
  if (staleSyncInFlight === null) {
    staleSyncInFlight = runStaleSync().finally(() => {
      staleSyncInFlight = null;
    });
  }
  return staleSyncInFlight;
}

async function runStaleSync(): Promise<number> {
  const threshold = new Date(Date.now() - STALE_AFTER_MS);
  const stale = await db.source.findMany({
    where: { OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: threshold } }] },
  });
  for (const source of stale) await syncSource(source.id);
  return stale.length;
}
