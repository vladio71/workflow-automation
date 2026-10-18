import 'server-only';
import { createHash } from 'node:crypto';
import type { Prisma, Question, Source } from '@/generated/prisma/client';
import { db } from '@/lib/db';
import { isUrl, parsePlan, parseQuestions, parseTopic, type ParsedCard, type ParsedPlan, type ParsedTopic } from '@/lib/learn-format';

/**
 * Sync pulls the learn/ folder of a GitHub repo and turns it into topics and cards.
 *
 * Two layouts, which may be mixed:
 *   learn/topic.md + learn/questions.md                     one topic for the whole repo
 *   learn/<module>/topic.md + learn/<module>/questions.md   one topic per folder
 *   learn/plan.md (optional)                                 a study plan: ordered steps, progress lives in the app
 *
 * Rules:
 *   - the branch's latest commit SHA is checked first; unchanged since the last good sync means nothing is downloaded;
 *   - a format error in any file imports nothing (all or nothing), the error is shown on /sources;
 *   - a card is recognised by its question text: a changed answer updates the card, a changed question is a new card
 *     (the old one is deleted, its recall history stays in the log unattached);
 *   - a changed answer updates the text only; the card's schedule stays;
 *   - the user's own answer from memory (myAnswer), topic colors and schedules are never touched;
 *   - a topic folder removed from the repo: its cards disappear, the topic itself stays as a regular one with history;
 *   - questions added by hand in the app are never touched;
 *   - a repo card edited in the app (All cards -> Edit) is no longer overwritten, and if its question leaves the repo
 *     the card stays in the app as a regular one;
 *   - a repo card deleted in the app is not recreated while that question is still in the repo.
 *
 * Flow: syncSource -> fetchLatestSha -> readLearn (GitHub) -> applyLearn (one DB transaction).
 */

const STALE_AFTER_MS = 10 * 60 * 1000;
/** Parallel GitHub requests: 40 files one by one is seconds of waiting, 40 at once GitHub does not like. */
const GITHUB_CONCURRENCY = 6;
/** Many small upserts (cards, plan steps): the default 5 s transaction timeout can be too short. */
const APPLY_TIMEOUT_MS = 30_000;

export interface SyncResult {
  ok: boolean;
  summary: string;
}

class SyncError extends Error {}

type Tx = Prisma.TransactionClient;

// ─── Entry points ────────────────────────────────────────────────────────────

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

/** The "Sync all" button: force, so the files are re-read even when the commit is the same. */
export async function syncAll(): Promise<SyncResult[]> {
  const sources = await db.source.findMany({ orderBy: { id: 'asc' } });
  const results: SyncResult[] = [];
  for (const source of sources) results.push(await syncSource(source.id, { force: true }));
  return results;
}

let staleSyncInFlight: Promise<number> | null = null;

/**
 * Auto-sync when Today opens: at most once per 10 minutes; with no new commits that is one GitHub request.
 * Single-flight: two tabs opening Today at once still run one sync.
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

// ─── Repo addresses ──────────────────────────────────────────────────────────

export function repoUrl(source: Pick<Source, 'repo'>): string {
  return `https://github.com/${source.repo}`;
}

/** Ref:/Link: from the repo -> a GitHub link; a full URL is kept as is. */
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

// ─── Reading learn/ from GitHub ──────────────────────────────────────────────

interface RepoTopicFiles {
  /** "" for learn/topic.md, otherwise the folder name inside learn/ */
  path: string;
  topic: ParsedTopic;
  notes: string;
  cards: ParsedCard[];
}

interface RepoLearn {
  folders: RepoTopicFiles[];
  plan: ParsedPlan | null;
}

interface GitHubDirEntry {
  name: string;
  type: string;
}

async function readLearn(source: Source, sha: string): Promise<RepoLearn> {
  const entries = await listDir(source, sha, 'learn');
  if (entries === null) throw new SyncError(`learn/ not found in ${source.repo}@${source.branch}`);

  const folders = await readTopicFolders(source, sha, entries);
  const hasPlan = entries.some((entry) => entry.type === 'file' && entry.name === 'plan.md');
  const plan = hasPlan ? await readPlan(source, sha, folders) : null;
  return { folders, plan };
}

async function readTopicFolders(source: Source, sha: string, entries: GitHubDirEntry[]): Promise<RepoTopicFiles[]> {
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
  return folders;
}

async function readTopicFolder(source: Source, sha: string, path: string): Promise<RepoTopicFiles | null> {
  const base = path ? `learn/${path}` : 'learn';
  const [topicText, questionsText] = await Promise.all([
    fetchFile(source, sha, `${base}/topic.md`),
    fetchFile(source, sha, `${base}/questions.md`),
  ]);
  // A folder without topic.md is not a topic.
  if (topicText === null) return null;
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

async function readPlan(source: Source, sha: string, folders: RepoTopicFiles[]): Promise<ParsedPlan | null> {
  const planText = await fetchFile(source, sha, 'learn/plan.md');
  if (planText === null) return null;
  const plan = parsePlan(planText);
  const errors = plan.errors.map((error) => `learn/plan.md ${error}`);
  const folderPaths = new Set(folders.map((folder) => folder.path));
  for (const step of plan.steps) {
    if (step.topic && !folderPaths.has(step.topic)) errors.push(`learn/plan.md line ${step.line}: Topic learn/${step.topic}/ not found`);
  }
  if (errors.length > 0) throw new SyncError(errors.slice(0, 5).join('; '));
  return plan;
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

/** A file at a specific commit; null when it does not exist. */
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

/** Like Promise.all, but at most `limit` tasks at a time. Result order = item order. */
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

// ─── Applying learn/ to the database ─────────────────────────────────────────

/** What the DB already holds for this source, read once at the start of the transaction. */
interface ExistingCards {
  /** Repo cards currently in the DB, by their source key. */
  byKey: Map<string | null, Question>;
  all: Question[];
  /** Source keys of repo cards the user deleted in the app. */
  deletedInApp: Set<string>;
}

interface SyncCounts {
  concepts: number;
  tasks: number;
  added: number;
  updated: number;
  keptEdited: number;
  keptDeleted: number;
  /** Every source key seen in the repo this time. */
  keysInRepo: Set<string>;
}

interface GoneCards {
  removedIds: number[];
  detachedIds: number[];
}

async function applyLearn(source: Source, learn: RepoLearn): Promise<string> {
  return db.$transaction(
    async (tx) => {
      const existing = await loadExistingCards(tx, source);
      const counts: SyncCounts = { concepts: 0, tasks: 0, added: 0, updated: 0, keptEdited: 0, keptDeleted: 0, keysInRepo: new Set() };

      for (const folder of learn.folders) {
        const topic = await upsertTopic(tx, source, folder);
        for (const card of folder.cards) await upsertCard(tx, source, folder, card, topic.id, existing, counts);
      }
      const gone = await handleCardsGoneFromRepo(tx, existing, counts.keysInRepo);
      await forgetStaleDeletions(tx, source, existing, counts.keysInRepo);
      await detachTopicsGoneFromRepo(tx, source, learn.folders);
      await replacePlanSteps(tx, source, learn.plan);
      return summarize(learn, counts, gone);
    },
    { timeout: APPLY_TIMEOUT_MS },
  );
}

async function loadExistingCards(tx: Tx, source: Source): Promise<ExistingCards> {
  const all = await tx.question.findMany({ where: { sourceId: source.id } });
  const deletedRows = await tx.deletedCard.findMany({ where: { sourceId: source.id }, select: { sourceKey: true } });
  return {
    byKey: new Map(all.map((question) => [question.sourceKey, question])),
    all,
    deletedInApp: new Set(deletedRows.map((row) => row.sourceKey)),
  };
}

async function upsertTopic(tx: Tx, source: Source, folder: RepoTopicFiles): Promise<{ id: number }> {
  const topicData = {
    name: folder.topic.name,
    track: folder.topic.track,
    ...(folder.notes ? { notes: folder.notes } : {}),
    ...(folder.topic.drill ? { drill: folder.topic.drill } : {}),
    // The deadline in topic.md is the source of truth: removed from the file, removed in the app.
    deadline: folder.topic.deadline ? new Date(`${folder.topic.deadline}T00:00:00Z`) : null,
  };
  return tx.topic.upsert({
    where: { sourceId_sourcePath: { sourceId: source.id, sourcePath: folder.path } },
    update: topicData,
    create: { ...topicData, source: repoUrl(source), sourceId: source.id, sourcePath: folder.path },
  });
}

/** Stable card key: repo + topic folder + kind + question text, ignoring case and whitespace. */
function cardKey(repo: string, path: string, card: ParsedCard): string {
  const normalized = card.question.toLowerCase().replace(/\s+/g, ' ').trim();
  // The root topic has no path in the scope, so keys of single-topic repos never changed.
  const scope = path ? `${repo}/${path}` : repo;
  return createHash('sha1').update(`${scope}\n${card.kind}\n${normalized}`).digest('hex');
}

async function upsertCard(
  tx: Tx,
  source: Source,
  folder: RepoTopicFiles,
  card: ParsedCard,
  topicId: number,
  existing: ExistingCards,
  counts: SyncCounts,
): Promise<void> {
  if (card.kind === 'CONCEPT') counts.concepts += 1;
  else counts.tasks += 1;

  const sourceKey = cardKey(source.repo, folder.path, card);
  counts.keysInRepo.add(sourceKey);
  if (existing.deletedInApp.has(sourceKey)) {
    counts.keptDeleted += 1;
    return;
  }
  const data = {
    kind: card.kind,
    question: card.question,
    reference: card.answer,
    ref: card.ref,
    check: card.check,
    topicId,
  };

  const current = existing.byKey.get(sourceKey);
  if (!current) {
    await tx.question.create({ data: { ...data, sourceKey, sourceId: source.id } });
    counts.added += 1;
    return;
  }
  if (current.editedInApp) {
    counts.keptEdited += 1;
    return;
  }

  const changed =
    current.question !== data.question ||
    current.reference !== data.reference ||
    current.ref !== data.ref ||
    current.check !== data.check ||
    current.topicId !== data.topicId;
  if (!changed) return;

  // The condition sits in the query: a card edited or deleted in the app while Sync runs is left alone.
  const result = await tx.question.updateMany({ where: { id: current.id, editedInApp: false }, data });
  counts.updated += result.count;
}

/** Repo cards whose question left the repo: delete them, except the ones edited in the app, which become regular cards. */
async function handleCardsGoneFromRepo(tx: Tx, existing: ExistingCards, keysInRepo: Set<string>): Promise<GoneCards> {
  const gone = existing.all.filter((question) => !keysInRepo.has(question.sourceKey ?? ''));
  const removedIds = gone.filter((question) => !question.editedInApp).map((question) => question.id);
  if (removedIds.length > 0) await tx.question.deleteMany({ where: { id: { in: removedIds }, editedInApp: false } });

  const detachedIds = gone.filter((question) => question.editedInApp).map((question) => question.id);
  if (detachedIds.length > 0) {
    await tx.question.updateMany({
      where: { id: { in: detachedIds } },
      data: { sourceId: null, sourceKey: null, editedInApp: false },
    });
  }
  return { removedIds, detachedIds };
}

/** Deletion records for cards that are no longer in the repo are not needed any more. */
async function forgetStaleDeletions(tx: Tx, source: Source, existing: ExistingCards, keysInRepo: Set<string>): Promise<void> {
  const staleDeleted = [...existing.deletedInApp].filter((sourceKey) => !keysInRepo.has(sourceKey));
  if (staleDeleted.length > 0) {
    await tx.deletedCard.deleteMany({ where: { sourceId: source.id, sourceKey: { in: staleDeleted } } });
  }
}

/** Topics whose folder disappeared from the repo are detached; history and colors stay. */
async function detachTopicsGoneFromRepo(tx: Tx, source: Source, folders: RepoTopicFiles[]): Promise<void> {
  const livePaths = folders.map((folder) => folder.path);
  await tx.topic.updateMany({
    where: { sourceId: source.id, sourcePath: { notIn: livePaths } },
    data: { sourceId: null, sourcePath: '' },
  });
}

/** Plan steps are matched by their Id, so progress (doneAt) survives a renamed or moved step. */
async function replacePlanSteps(tx: Tx, source: Source, plan: ParsedPlan | null): Promise<void> {
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
}

function summarize(learn: RepoLearn, counts: SyncCounts, gone: GoneCards): string {
  const topicsLabel = learn.folders.length === 1 ? '' : `${learn.folders.length} topics · `;
  const planLabel = learn.plan ? ` · plan: ${learn.plan.steps.length} steps` : '';
  const inAppParts: string[] = [];
  if (counts.keptEdited > 0) inAppParts.push(`${counts.keptEdited} edited in app`);
  if (counts.keptDeleted > 0) inAppParts.push(`${counts.keptDeleted} deleted in app`);
  if (gone.detachedIds.length > 0) inAppParts.push(`${gone.detachedIds.length} edited kept after leaving the repo`);
  const inAppLabel = inAppParts.length > 0 ? ` · ${inAppParts.join(', ')}` : '';
  return `${topicsLabel}${counts.concepts} Q · ${counts.tasks} tasks (+${counts.added} new, ${counts.updated} updated, ${gone.removedIds.length} removed)${inAppLabel}${planLabel}`;
}
