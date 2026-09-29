import 'server-only';
import { db } from './db';
import { findRestCards, isGeminiConfigured, type RestCardDraft, type SearchedRestKind } from './gemini';
import { INTERESTS, POOL_MINUTES, POOL_RARITY, POOL_TARGETS, POOL_TTL_DAYS, type PoolKind } from './loot.config';

/**
 * Наповнення пулу скрині. Запускається само при відкритті Today (не частіше ніж раз на 30 хв) і кнопкою Refill на /loot.
 *   - MEME: випадковий комікс xkcd (без AI і без ключа);
 *   - NEWS, ARTICLE, MUSIC, ANIME, FILM: Gemini з Google Search (один запит на всю партію);
 *   - без ключа Gemini або якщо він впав: новини і статті з Hacker News.
 * Протерміновані картки видаляються, той самий комікс чи статтю не додаємо двічі (dedupeKey).
 */
export interface RefillResult {
  at: string;
  added: Partial<Record<PoolKind, number>>;
  errors: string[];
  /** пропущено: останнє наповнення було нещодавно */
  skipped: boolean;
}

interface NewCard {
  kind: PoolKind;
  title: string;
  body: string;
  url: string;
  imageUrl: string;
  source: string;
  dedupeKey: string;
}

const REFILL_EVERY_MS = 30 * 60_000;
const FETCH_TIMEOUT_MS = 10_000;
const POOL_KINDS: readonly PoolKind[] = ['MEME', 'NEWS', 'ARTICLE', 'MUSIC', 'ANIME', 'FILM'];
const SEARCHED_KINDS: readonly SearchedRestKind[] = ['NEWS', 'ARTICLE', 'MUSIC', 'ANIME', 'FILM'];

// стан живе в процесі next start: цього досить, щоб не смикати мережу на кожне відкриття Today
let lastRefillAt = 0;
let lastResult: RefillResult | null = null;
let running: Promise<RefillResult> | null = null;

export function lastRefill(): RefillResult | null {
  return lastResult;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { 'user-agent': 'learning-app (personal study tool)' } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return (await response.json()) as T;
}

interface XkcdComic {
  num: number;
  safe_title: string;
  alt: string;
  img: string;
}

/** n випадкових коміксів xkcd. #404 не існує (жарт автора), його пропускаємо. */
async function xkcdCards(count: number): Promise<NewCard[]> {
  if (count <= 0) return [];
  const latest = await fetchJson<XkcdComic>('https://xkcd.com/info.0.json');
  const numbers = new Set<number>();
  while (numbers.size < count * 2 && numbers.size < latest.num - 1) {
    const number = 1 + Math.floor(Math.random() * latest.num);
    if (number !== 404) numbers.add(number);
  }
  const cards: NewCard[] = [];
  for (const number of numbers) {
    if (cards.length >= count) break;
    try {
      const comic = await fetchJson<XkcdComic>(`https://xkcd.com/${number}/info.0.json`);
      cards.push({
        kind: 'MEME',
        title: `xkcd #${comic.num}: ${comic.safe_title}`,
        body: comic.alt,
        url: `https://xkcd.com/${comic.num}/`,
        imageUrl: comic.img.replace(/^http:/, 'https:'),
        source: 'xkcd',
        dedupeKey: `xkcd:${comic.num}`,
      });
    } catch {
      // один комікс не завантажився: беремо наступний номер
    }
  }
  return cards;
}

interface HnItem {
  id: number;
  type: string;
  title?: string;
  url?: string;
  score?: number;
}

/** Запасні новини й статті: випадкові історії з топу Hacker News (тільки з посиланням на статтю). */
async function hackerNewsCards(counts: { news: number; articles: number }): Promise<NewCard[]> {
  const wanted = counts.news + counts.articles;
  if (wanted <= 0) return [];
  const top = await fetchJson<number[]>('https://hacker-news.firebaseio.com/v0/topstories.json');
  const shuffled = top.slice(0, 60).sort(() => Math.random() - 0.5);
  const cards: NewCard[] = [];
  for (const id of shuffled) {
    if (cards.length >= wanted) break;
    try {
      const item = await fetchJson<HnItem>(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
      if (item.type !== 'story' || !item.url || !item.title || !item.url.startsWith('https://')) continue;
      const kind: PoolKind = cards.filter((card) => card.kind === 'NEWS').length < counts.news ? 'NEWS' : 'ARTICLE';
      cards.push({
        kind,
        title: item.title,
        body: `З топу Hacker News${item.score ? `, ${item.score} балів` : ''}.`,
        url: item.url,
        imageUrl: '',
        source: 'hn',
        dedupeKey: `hn:${item.id}`,
      });
    } catch {
      // одна історія не завантажилась: беремо наступну
    }
  }
  return cards;
}

function fromDraft(draft: RestCardDraft): NewCard {
  return {
    kind: draft.kind,
    title: draft.title.trim(),
    body: draft.body.trim(),
    url: draft.url.trim(),
    imageUrl: '',
    source: 'gemini',
    dedupeKey: `url:${draft.url.trim().replace(/\/+$/, '').toLowerCase()}`,
  };
}

async function doRefill(now: Date): Promise<RefillResult> {
  const errors: string[] = [];
  await db.restCard.deleteMany({ where: { expiresAt: { lt: now } } });
  const live = await db.restCard.groupBy({ by: ['kind'], where: { pulledAt: null, expiresAt: { gt: now } }, _count: { _all: true } });
  const liveByKind = new Map(live.map((row) => [row.kind, row._count._all]));
  const need = (kind: PoolKind): number => Math.max(0, POOL_TARGETS[kind] - (liveByKind.get(kind) ?? 0));

  const cards: NewCard[] = [];
  try {
    cards.push(...(await xkcdCards(need('MEME'))));
  } catch (error) {
    errors.push(`xkcd: ${error instanceof Error ? error.message : 'error'}`);
  }

  const counts: Record<SearchedRestKind, number> = { NEWS: 0, ARTICLE: 0, MUSIC: 0, ANIME: 0, FILM: 0 };
  for (const kind of SEARCHED_KINDS) counts[kind] = need(kind);
  const searchedTotal = SEARCHED_KINDS.reduce((sum, kind) => sum + counts[kind], 0);

  let fromGemini: NewCard[] = [];
  if (searchedTotal > 0 && isGeminiConfigured()) {
    try {
      const drafts = await findRestCards({
        today: now.toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
        interests: INTERESTS,
        counts,
      });
      // не більше, ніж просили, кожного виду
      const taken: Record<SearchedRestKind, number> = { NEWS: 0, ARTICLE: 0, MUSIC: 0, ANIME: 0, FILM: 0 };
      fromGemini = drafts.filter((draft) => {
        if (taken[draft.kind] >= counts[draft.kind]) return false;
        taken[draft.kind] += 1;
        return true;
      }).map(fromDraft);
      if (fromGemini.length === 0) errors.push('Gemini: no usable cards in the answer (no https links or an empty list).');
    } catch (error) {
      errors.push(`Gemini: ${error instanceof Error ? error.message : 'error'}`);
    }
  }
  cards.push(...fromGemini);

  // новин і статей не вистачило (немає ключа, Gemini впав або дав мало): добираємо з Hacker News
  const gotNews = fromGemini.filter((card) => card.kind === 'NEWS').length;
  const gotArticles = fromGemini.filter((card) => card.kind === 'ARTICLE').length;
  const missing = { news: Math.max(0, counts.NEWS - gotNews), articles: Math.max(0, counts.ARTICLE - gotArticles) };
  if (missing.news + missing.articles > 0) {
    try {
      cards.push(...(await hackerNewsCards(missing)));
    } catch (error) {
      errors.push(`Hacker News: ${error instanceof Error ? error.message : 'error'}`);
    }
  }

  // той самий комікс чи стаття вже є в пулі (або двічі в цій партії): не додаємо
  const existing = await db.restCard.findMany({
    where: { dedupeKey: { in: cards.map((card) => card.dedupeKey) } },
    select: { dedupeKey: true },
  });
  const seen = new Set(existing.map((row) => row.dedupeKey));
  const fresh = cards.filter((card) => {
    if (seen.has(card.dedupeKey)) return false;
    seen.add(card.dedupeKey);
    return true;
  });

  await db.restCard.createMany({
    data: fresh.map((card) => ({
      ...card,
      rarity: POOL_RARITY[card.kind],
      minutes: POOL_MINUTES[card.kind],
      // afterBoss лишається false: фільм відкривається за видом, коли вся карта пройдена (POOL_AFTER_DAY)
      afterBoss: false,
      expiresAt: new Date(now.getTime() + POOL_TTL_DAYS[card.kind] * 24 * 60 * 60_000),
    })),
    skipDuplicates: true,
  });
  const added: Partial<Record<PoolKind, number>> = {};
  for (const kind of POOL_KINDS) {
    const count = fresh.filter((card) => card.kind === kind).length;
    if (count > 0) added[kind] = count;
  }
  return { at: now.toISOString(), added, errors, skipped: false };
}

/** force = кнопка Refill на /loot; без force не частіше ніж раз на 30 хв. Два одночасні виклики чекають один результат. */
export async function refillPool(options: { force: boolean }): Promise<RefillResult> {
  const now = new Date();
  if (running) return running;
  if (!options.force && now.getTime() - lastRefillAt < REFILL_EVERY_MS) {
    return { at: now.toISOString(), added: {}, errors: [], skipped: true };
  }
  lastRefillAt = now.getTime();
  running = doRefill(now)
    .then((result) => {
      lastResult = result;
      return result;
    })
    .catch((error: unknown) => {
      const result: RefillResult = { at: now.toISOString(), added: {}, errors: [error instanceof Error ? error.message : 'refill failed'], skipped: false };
      lastResult = result;
      return result;
    })
    .finally(() => {
      running = null;
    });
  return running;
}
