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

