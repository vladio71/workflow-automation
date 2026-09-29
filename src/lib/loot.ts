import 'server-only';
import type { RestPull } from '@/generated/prisma/client';
import { db } from './db';
import { LOOT_RULES, STATIC_CARDS, type LootRarity } from './loot.config';
import { chestGate, guaranteeFor, pickCard, rollRarity, ticketsEarned, type GuaranteeReason, type LootCandidate } from './loot-rules';
import { findBossId } from './plan-order';
import { getTodayPlan } from './planner';
import { dayKey } from './queries';
import { endOfDay, startOfDay } from './schedule';

/**
 * Скриня на карті дня. Квитки не зберігаються: щоразу рахуються з плану на сьогодні мінус уже відкриті скрині.
 * Правила (квитки, ліміти, pity, бос) у loot-rules.ts, картки і шанси в loot.config.ts.
 */
export interface RestPullView {
  id: number;
  rarity: LootRarity;
  kind: string;
  title: string;
  body: string;
  url: string;
  imageUrl: string;
  minutes: number;
  guarantee: string;
  /** ISO: клієнт рахує таймер сам */
  openedAt: string;
  finishedAt: string | null;
}

export interface ChestState {
  open: boolean;
  tickets: number;
  reason: string | null;
  /** ISO: коли відкриється, якщо зачинено інтервалом */
  retryAt: string | null;
  pullsToday: number;
  maxPullsPerDay: number;
  /** скільки ще пулів до гарантованого epic */
  pityLeft: number;
  bossCleared: boolean;
  /** наступна скриня після боса дасть rare+ */
  bossBonusReady: boolean;
  /** відпочинок, який іде зараз (таймер не скінчився і не натиснув "Назад на карту") */
  active: RestPullView | null;
  todayPulls: RestPullView[];
}

function toView(pull: RestPull): RestPullView {
  return {
    id: pull.id,
    rarity: pull.rarity,
    kind: pull.kind,
    title: pull.title,
    body: pull.body,
    url: pull.url,
    imageUrl: pull.imageUrl,
    minutes: pull.minutes,
    guarantee: pull.guarantee,
    openedAt: pull.openedAt.toISOString(),
    finishedAt: pull.finishedAt ? pull.finishedAt.toISOString() : null,
  };
}

/** Пулів поспіль без epic/legendary, рахуючи через дні. */
async function pullsSinceEpic(): Promise<number> {
  const lastEpic = await db.restPull.findFirst({
    where: { rarity: { in: ['EPIC', 'LEGENDARY'] } },
    orderBy: { openedAt: 'desc' },
    select: { openedAt: true },
  });
  return db.restPull.count({ where: lastEpic ? { openedAt: { gt: lastEpic.openedAt } } : {} });
}

interface ChestFacts {
  state: ChestState;
  pullsSinceEpic: number;
  bossPullUsed: boolean;
}

async function loadChest(now: Date): Promise<ChestFacts> {
  const [plan, pulls, gaveUp, sinceEpic] = await Promise.all([
    getTodayPlan(now),
    db.restPull.findMany({ where: { day: dayKey(now) }, orderBy: { openedAt: 'asc' } }),
    db.levelAttempt.findMany({
      where: { gaveUp: true, createdAt: { gte: startOfDay(now), lte: endOfDay(now) } },
      select: { levelKey: true },
    }),
    pullsSinceEpic(),
  ]);
  const items = plan?.items ?? [];
  const gaveUpLevels = new Set(gaveUp.map((attempt) => attempt.levelKey));
  const bossId = findBossId(items);
  const earned = ticketsEarned(
    items.map((item) => ({
      id: item.id,
      done: item.done,
      assisted: item.kind === 'LEVEL' && gaveUpLevels.has(item.id.replace('level:', '')),
    })),
    bossId,
  );
  const lastPull = pulls[pulls.length - 1] ?? null;
  const gate = chestGate({ earned, pullsToday: pulls.length, lastPullAt: lastPull?.openedAt ?? null, now, rules: LOOT_RULES });
  const bossCleared = items.some((item) => item.id === bossId && item.done);
  const bossPullUsed = pulls.some((pull) => pull.guarantee === 'boss');
  const active = lastPull && !lastPull.finishedAt && lastPull.openedAt.getTime() + lastPull.minutes * 60_000 > now.getTime()
    ? toView(lastPull)
    : null;

  return {
    pullsSinceEpic: sinceEpic,
    bossPullUsed,
    state: {
      open: gate.open,
      tickets: gate.tickets,
      reason: gate.open ? null : gate.reason,
      retryAt: !gate.open && gate.retryAt ? gate.retryAt.toISOString() : null,
      pullsToday: pulls.length,
      maxPullsPerDay: LOOT_RULES.maxPullsPerDay,
      pityLeft: Math.max(1, LOOT_RULES.pityEvery - sinceEpic),
      bossCleared,
      bossBonusReady: bossCleared && !bossPullUsed,
      active,
      todayPulls: pulls.map(toView),
    },
  };
}

export async function getChestState(now: Date = new Date()): Promise<ChestState> {
  return (await loadChest(now)).state;
}

interface Candidate extends LootCandidate {
  title: string;
  body: string;
  url: string;
  imageUrl: string;
  minutes: number;
  source: string;
  restCardId: number | null;
}

export type OpenChestResult = { ok: true; pull: RestPullView } | { ok: false; error: string };

export async function openChest(now: Date = new Date(), random: () => number = Math.random): Promise<OpenChestResult> {
  const { state, pullsSinceEpic: sinceEpic, bossPullUsed } = await loadChest(now);
  if (!state.open) return { ok: false, error: state.reason ?? 'The chest is closed.' };

  const guarantee = guaranteeFor(sinceEpic, state.bossCleared, bossPullUsed, LOOT_RULES);
  const rarity = rollRarity(random, LOOT_RULES.weights, guarantee.minRarity);

  const poolCards = await db.restCard.findMany({ where: { pulledAt: null, expiresAt: { gt: now } } });
  const candidates: Candidate[] = [
    ...STATIC_CARDS.map((card) => ({
      key: `static:${card.id}`,
      kind: card.kind,
      rarity: card.rarity,
      afterBoss: card.afterBoss === true,
      fallback: card.fallback === true,
      title: card.title,
      body: card.body,
      url: card.url ?? '',
      imageUrl: '',
      minutes: card.minutes,
      source: 'static',
      restCardId: null,
    })),
    ...poolCards.map((card) => ({
      key: `db:${card.id}`,
      kind: card.kind,
      rarity: card.rarity,
      afterBoss: card.afterBoss,
      fallback: false,
      title: card.title,
      body: card.body,
      url: card.url,
      imageUrl: card.imageUrl,
      minutes: card.minutes,
      source: card.source,
      restCardId: card.id,
    })),
  ];
  const picked = pickCard(candidates, rarity, state.bossCleared, random);
  if (!picked) return { ok: false, error: 'The pool is empty. Check src/lib/loot.config.ts.' };

  // гарантія записується, тільки якщо вона справді спрацювала (картки потрібної рідкості могло не бути)
  const reason: GuaranteeReason = guarantee.reason !== '' && picked.rarity === rarity ? guarantee.reason : '';
  const { card } = picked;
  const pull = await db.$transaction(async (tx) => {
    if (card.restCardId !== null) {
      // умова pulledAt: null: одну картку пулу не можна витягнути двічі
      const taken = await tx.restCard.updateMany({ where: { id: card.restCardId, pulledAt: null }, data: { pulledAt: now } });
      if (taken.count === 0) throw new Error('This card was just taken, open the chest again.');
    }
    return tx.restPull.create({
      data: {
        day: dayKey(now),
        rarity: picked.rarity,
        kind: card.kind,
        title: card.title,
        body: card.body,
        url: card.url,
        imageUrl: card.imageUrl,
        minutes: card.minutes,
        source: card.source,
        guarantee: reason,
        restCardId: card.restCardId,
        openedAt: now,
      },
    });
  });
  return { ok: true, pull: toView(pull) };
}

export async function finishRest(pullId: number, now: Date = new Date()): Promise<void> {
  await db.restPull.updateMany({ where: { id: pullId, finishedAt: null }, data: { finishedAt: now } });
}

export interface LootStats {
  byRarity: Record<LootRarity, number>;
  total: number;
  poolByKind: Record<string, number>;
  recent: RestPullView[];
}

/** Для сторінки /loot: колекція за рідкістю, що зараз лежить у пулі, останні пули. */
export async function getLootStats(now: Date = new Date()): Promise<LootStats> {
  const [grouped, pool, recent] = await Promise.all([
    db.restPull.groupBy({ by: ['rarity'], _count: { _all: true } }),
    db.restCard.groupBy({ by: ['kind'], where: { pulledAt: null, expiresAt: { gt: now } }, _count: { _all: true } }),
    db.restPull.findMany({ orderBy: { openedAt: 'desc' }, take: 40 }),
  ]);
  const byRarity: Record<LootRarity, number> = { COMMON: 0, UNCOMMON: 0, RARE: 0, EPIC: 0, LEGENDARY: 0 };
  for (const row of grouped) byRarity[row.rarity] = row._count._all;
  const poolByKind: Record<string, number> = {};
  for (const row of pool) poolByKind[row.kind] = row._count._all;
  return {
    byRarity,
    total: Object.values(byRarity).reduce((sum, count) => sum + count, 0),
    poolByKind,
    recent: recent.map(toView),
  };
}
