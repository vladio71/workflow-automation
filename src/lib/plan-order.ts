/**
 * Порядок плану дня. Чиста логіка без БД: окремий файл, щоб її можна було перевірити окремо
 * (import type з planner стирається при компіляції, server-only сюди не тягнеться).
 */
import type { PlanCandidate, PlanItem } from './planner';

/**
 * Кроки навчального плану AI не може викинути чи переставити: докладаємо пропущені (поки влазять у бюджет)
 * і ставимо обов'язкові пункти в їхньому порядку на ті місця, де AI їх розмістив.
 */
export function enforceMandatory(items: PlanItem[], candidates: PlanCandidate[], minutesBudget: number): PlanItem[] {
  const mandatory = candidates.filter((candidate) => candidate.mandatory === true);
  const picked = new Set(items.map((item) => item.id));
  const byId = new Map(items.map((item) => [item.id, item]));

  let used = mandatory.filter((candidate) => picked.has(candidate.id)).reduce((sum, candidate) => sum + candidate.defaultMinutes, 0);
  const requiredOrder: PlanItem[] = [];
  for (const candidate of mandatory) {
    const existing = byId.get(candidate.id);
    if (existing) {
      requiredOrder.push({ ...existing, minutes: candidate.defaultMinutes });
      continue;
    }
    if (used + candidate.defaultMinutes > minutesBudget) break;
    used += candidate.defaultMinutes;
    requiredOrder.push({ ...candidate, minutes: candidate.defaultMinutes, why: candidate.hint ?? '', manualDone: false });
  }

  const mandatoryIds = new Set(mandatory.map((candidate) => candidate.id));
  const result: PlanItem[] = [];
  let next = 0;
  for (const item of items) {
    if (!mandatoryIds.has(item.id)) {
      result.push(item);
      continue;
    }
    // слот обов'язкового пункту займає наступний за порядком плану
    const inOrder = requiredOrder[next];
    if (inOrder) result.push(inOrder);
    next += 1;
  }
  // обов'язкові, яких AI не поставив, ідуть одразу після останнього обов'язкового (або в кінець)
  const rest = requiredOrder.slice(next);
  if (rest.length > 0) {
    let insertAt = result.length;
    for (let index = result.length - 1; index >= 0; index -= 1) {
      const item = result[index];
      if (item && mandatoryIds.has(item.id)) {
        insertAt = index + 1;
        break;
      }
    }
    result.splice(insertAt, 0, ...rest);
  }
  return result;
}


/** Мінімальний спільний вигляд пункту плану для правил порядку (підходить і PlanItem, і PlanItemWithStatus). */
export interface OrderableItem {
  id: string;
  kind: string;
  minutes: number;
  mandatory?: boolean;
}

/** Бос дня = найдовший пункт; при рівності перший з них. Та сама функція на сервері (порядок) і на карті (корона). */
export function findBossId(items: readonly OrderableItem[]): string | null {
  if (items.length < 2) return null;
  let boss: OrderableItem | null = null;
  for (const item of items) {
    if (!boss || item.minutes > boss.minutes) boss = item;
  }
  return boss ? boss.id : null;
}

/** розминка = картки; якщо карток сьогодні немає, найкоротший не обов'язковий пункт до 10 хв */
const WARM_UP_MAX_MINUTES = 10;

/**
 * Порядок дня під старт: розминка → бос (жаба, поки свіжа голова) → решта, легше до вечора.
 * Кроки навчального плану між собою не переставляються: бос-крок не обганяє обов'язковий крок, що стояв перед ним.
 */
export function momentumOrder<T extends OrderableItem>(items: readonly T[]): T[] {
  const result = [...items];

  const cards = result.find((item) => item.kind === 'CARDS');
  const shortest = [...result]
    .filter((item) => item.mandatory !== true && item.minutes <= WARM_UP_MAX_MINUTES)
    .sort((a, b) => a.minutes - b.minutes)[0];
  const warmUp = cards ?? shortest ?? null;
  if (warmUp) {
    result.splice(result.indexOf(warmUp), 1);
    result.unshift(warmUp);
  }

  const bossId = findBossId(result);
  const bossIndex = result.findIndex((item) => item.id === bossId);
  const boss = result[bossIndex];
  if (!boss || bossIndex <= 0) return result;

  let target = warmUp ? 1 : 0;
  if (boss.mandatory === true) {
    // останній обов'язковий пункт перед босом лишається перед ним
    for (let index = bossIndex - 1; index >= 0; index -= 1) {
      if (result[index]?.mandatory === true) {
        target = Math.max(target, index + 1);
        break;
      }
    }
  }
  if (target >= bossIndex) return result;
  result.splice(bossIndex, 1);
  result.splice(target, 0, boss);
  return result;
}
