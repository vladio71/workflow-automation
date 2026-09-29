/**
 * Правила скрині. Чиста логіка без БД і без мережі, як plan-order.ts: так її легко перевірити окремо.
 *   - квитки: +1 за кожен пройдений вузол, бос дає +2; рівень, пройдений після "здався", квитка не дає;
 *   - ліміти: не більше N пулів на день і не частіше ніж раз на M хвилин (як сувої на Mangabuff);
 *   - гарантії: кожен 6-й пул поспіль без epic = epic+ (pity); перший пул після боса = rare+; після common = uncommon+;
 *   - legendary: після кожної за день її шанс падає вчетверо, друга можлива, але рідко;
 *   - картка: рідкість кидається за вагами, потім випадкова картка цієї рідкості; немає такої, беремо нижчу.
 */
import type { LootRarity, LootRules } from './loot.config';

export const RARITY_ORDER: readonly LootRarity[] = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY'];

export function rarityRank(rarity: LootRarity): number {
  return RARITY_ORDER.indexOf(rarity);
}

export interface TicketItem {
  id: string;
  done: boolean;
  /** рівень закрито тільки після "здався": пункт плану виконано, але квитка немає */
  assisted: boolean;
}

export function ticketsEarned(items: readonly TicketItem[], bossId: string | null): number {
  let tickets = 0;
  for (const item of items) {
    if (!item.done || item.assisted) continue;
    tickets += item.id === bossId ? 2 : 1;
  }
  return tickets;
}

export interface GateInput {
  earned: number;
  pullsToday: number;
  lastPullAt: Date | null;
  now: Date;
  rules: LootRules;
}

export type Gate =
  | { open: true; tickets: number }
  | { open: false; tickets: number; reason: string; retryAt: Date | null };

export function chestGate(input: GateInput): Gate {
  const { earned, pullsToday, lastPullAt, now, rules } = input;
  const tickets = Math.max(0, Math.min(earned, rules.maxPullsPerDay) - pullsToday);
  if (pullsToday >= rules.maxPullsPerDay) {
    return { open: false, tickets: 0, reason: `Сьогодні вже ${rules.maxPullsPerDay} скринь. Нові будуть завтра.`, retryAt: null };
  }
  if (tickets === 0) {
    return { open: false, tickets, reason: 'Пройди поточний вузол карти, і буде квиток.', retryAt: null };
  }
  if (lastPullAt) {
    const retryAt = new Date(lastPullAt.getTime() + rules.minMinutesBetweenPulls * 60_000);
    if (now < retryAt) return { open: false, tickets, reason: 'Спершу трохи попрацюй: скриня ще закрита.', retryAt };
  }
  return { open: true, tickets };
}

export type GuaranteeReason = '' | 'pity' | 'boss' | 'streak';

export interface Guarantee {
  minRarity: LootRarity;
  reason: GuaranteeReason;
}

export interface GuaranteeInput {
  /** скільки пулів поспіль без epic/legendary (через дні) */
  pullsSinceEpic: number;
  bossCleared: boolean;
  bossPullUsed: boolean;
  /** рідкість попередньої скрині сьогодні; null = сьогодні ще не відкривав */
  lastRarityToday: LootRarity | null;
}

/** Найсильніша гарантія перемагає: pity (epic+) > бос (rare+) > після common (uncommon+). */
export function guaranteeFor(input: GuaranteeInput, rules: LootRules): Guarantee {
  if (input.pullsSinceEpic + 1 >= rules.pityEvery) return { minRarity: 'EPIC', reason: 'pity' };
  if (input.bossCleared && !input.bossPullUsed) return { minRarity: 'RARE', reason: 'boss' };
  if (rules.noCommonTwiceInRow && input.lastRarityToday === 'COMMON') return { minRarity: 'UNCOMMON', reason: 'streak' };
  return { minRarity: 'COMMON', reason: '' };
}

/**
 * Ваги на сьогодні: після кожної legendary за день її вага множиться на repeatFactor (0.25: 10% → 2.5% → 0.6%).
 * Друга legendary можлива, але рідко.
 */
export function todayWeights(weights: Record<LootRarity, number>, legendaryToday: number, repeatFactor: number): Record<LootRarity, number> {
  return { ...weights, LEGENDARY: weights.LEGENDARY * repeatFactor ** legendaryToday };
}

/** Кидок рідкості за вагами серед рідкостей не нижче minRarity. random() повертає [0, 1). */
export function rollRarity(random: () => number, weights: Record<LootRarity, number>, minRarity: LootRarity): LootRarity {
  const allowed = RARITY_ORDER.filter((rarity) => rarityRank(rarity) >= rarityRank(minRarity));
  const total = allowed.reduce((sum, rarity) => sum + weights[rarity], 0);
  let roll = random() * total;
  for (const rarity of allowed) {
    roll -= weights[rarity];
    if (roll < 0) return rarity;
  }
  return allowed[allowed.length - 1] ?? 'COMMON';
}

export interface LootCandidate {
  key: string;
  kind: string;
  rarity: LootRarity;
  afterBoss: boolean;
  fallback: boolean;
}

export interface Picked<T extends LootCandidate> {
  card: T;
  rarity: LootRarity;
}

/** Випадкова картка вибраної рідкості; якщо таких немає, крок вниз. Запасні картки тільки коли немає справжньої того ж виду. */
export function pickCard<T extends LootCandidate>(candidates: readonly T[], rarity: LootRarity, bossCleared: boolean, random: () => number): Picked<T> | null {
  for (let rank = rarityRank(rarity); rank >= 0; rank -= 1) {
    const current = RARITY_ORDER[rank];
    if (!current) continue;
    const available = candidates.filter((card) => card.rarity === current && (bossCleared || !card.afterBoss));
    const realKinds = new Set(available.filter((card) => !card.fallback).map((card) => card.kind));
    const pool = available.filter((card) => !card.fallback || !realKinds.has(card.kind));
    if (pool.length === 0) continue;
    const card = pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
    if (card) return { card, rarity: current };
  }
  return null;
}
