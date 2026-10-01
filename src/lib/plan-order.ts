/**
 * Порядок і редагування плану дня. Чиста логіка без БД: окремий файл, щоб її можна було перевірити окремо
 * і викликати з клієнта (import type з planner стирається при компіляції, server-only сюди не тягнеться).
 */
import type { PlanCandidate, PlanItem, PlanItemWithStatus } from './planner';

export type MoveDirection = -1 | 1;

export const MIN_ITEM_MINUTES = 5;
export const MAX_ITEM_MINUTES = 480;

export function toPlanItem(candidate: PlanCandidate): PlanItem {
  return { ...candidate, minutes: candidate.defaultMinutes, why: candidate.hint ?? '', manualDone: false };
}

function minutesOf(candidates: PlanCandidate[]): number {
  return candidates.reduce((sum, candidate) => sum + candidate.defaultMinutes, 0);
}

/**
 * Які навчальні обов'язкові пункти (кроки планів, переробки) йдуть у план, у порядку кандидатів.
 * - Не вліз крок плану: наступні кроки цього плану теж не беремо, а інші плани ще можуть влізти.
 * - Перший навчальний пункт беремо навіть довшим за бюджет, інакше план застрягне.
 * - keep: пункти, які AI вже поставив сам; вони лишаються, якщо їхній план не обрізаний раніше.
 */
export function pickMandatory(
  mandatory: PlanCandidate[],
  minutesBudget: number,
  keep: (candidate: PlanCandidate) => boolean = () => false,
): PlanCandidate[] {
  const picked: PlanCandidate[] = [];
  const cutGroups = new Set<string>();
  let used = 0;
  for (const candidate of mandatory) {
    const group = candidate.group ?? candidate.id;
    if (candidate.kind === 'PLAN' && cutGroups.has(group)) continue;
    const fits = used + candidate.defaultMinutes <= minutesBudget;
    if (!fits && picked.length > 0 && !keep(candidate)) {
      if (candidate.kind === 'PLAN') cutGroups.add(group);
      continue;
    }
    used += candidate.defaultMinutes;
    picked.push(candidate);
  }
  return picked;
}

/**
 * План від AI -> план, у якому обов'язкове на місці.
 * Кроки навчальних планів AI не може викинути чи переставити: вони стають на місця, де AI поставив обов'язкові пункти,
 * у своєму порядку, а пропущені докладаються, поки влазять у бюджет.
 * Повторювані справи (TASK) мають бути в плані завжди, але де саме, вирішує AI: якщо він їх не поставив, вони йдуть у кінець.
 */
export function enforceMandatory(items: PlanItem[], candidates: PlanCandidate[], minutesBudget: number): PlanItem[] {
  const tasks = candidates.filter((candidate) => candidate.mandatory === true && candidate.kind === 'TASK');
  const study = candidates.filter((candidate) => candidate.mandatory === true && candidate.kind !== 'TASK');
  const byId = new Map(items.map((item) => [item.id, item]));

  const required: PlanItem[] = pickMandatory(study, minutesBudget - minutesOf(tasks), (candidate) => byId.has(candidate.id))
    .map((candidate) => {
      const existing = byId.get(candidate.id);
      return existing ? { ...existing, minutes: candidate.defaultMinutes } : toPlanItem(candidate);
    });

  const studyIds = new Set(study.map((candidate) => candidate.id));
  const result: PlanItem[] = [];
  let next = 0;
  for (const item of items) {
    if (!studyIds.has(item.id)) {
      result.push(item);
      continue;
    }
    // слот обов'язкового пункту займає наступний за порядком плану
    const inOrder = required[next];
    if (inOrder) result.push(inOrder);
    next += 1;
  }
  // обов'язкові, яких AI не поставив, ідуть одразу після останнього обов'язкового (або в кінець)
  const rest = required.slice(next);
  if (rest.length > 0) {
    let insertAt = result.length;
    for (let index = result.length - 1; index >= 0; index -= 1) {
      const item = result[index];
      if (item && studyIds.has(item.id)) {
        insertAt = index + 1;
        break;
      }
    }
    result.splice(insertAt, 0, ...rest);
  }

  const present = new Set(result.map((item) => item.id));
  for (const task of tasks) {
    if (!present.has(task.id)) result.push(toPlanItem(task));
  }
  return result;
}

// ------------------------------------------------------------------ чернетка: правки до "Start the day"

function isLaterStepOfSamePlan(item: PlanItem, removed: PlanItem): boolean {
  return item.kind === 'PLAN'
    && removed.kind === 'PLAN'
    && item.group !== undefined
    && item.group === removed.group
    && (item.order ?? 0) > (removed.order ?? 0);
}

/** Прибрати пункт. Прибраний крок плану забирає і наступні кроки того ж плану: робити крок 5 без кроку 4 не можна. */
export function removeFromDraft(items: PlanItem[], itemId: string): PlanItem[] {
  const removed = items.find((item) => item.id === itemId);
  if (!removed) return items;
  return items.filter((item) => item.id !== itemId && !isLaterStepOfSamePlan(item, removed));
}

/** Два кроки одного плану місцями не міняємо: їхній порядок задає план. */
export function canMove(items: PlanItem[], index: number, direction: MoveDirection): boolean {
  const current = items[index];
  const neighbour = items[index + direction];
  if (!current || !neighbour) return false;
  return !(current.kind === 'PLAN' && neighbour.kind === 'PLAN' && current.group !== undefined && current.group === neighbour.group);
}

export function moveInDraft(items: PlanItem[], itemId: string, direction: MoveDirection): PlanItem[] {
  const index = items.findIndex((item) => item.id === itemId);
  const current = items[index];
  const neighbour = items[index + direction];
  if (!current || !neighbour || !canMove(items, index, direction)) return items;
  const result = [...items];
  result[index] = neighbour;
  result[index + direction] = current;
  return result;
}

export function clampMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return MIN_ITEM_MINUTES;
  return Math.min(MAX_ITEM_MINUTES, Math.max(MIN_ITEM_MINUTES, Math.round(minutes)));
}

export function setMinutesInDraft(items: PlanItem[], itemId: string, minutes: number): PlanItem[] {
  const value = clampMinutes(minutes);
  return items.map((item) => (item.id === itemId ? { ...item, minutes: value } : item));
}

/**
 * Додати кандидата в кінець чернетки. Крок плану тягне за собою раніші кроки того ж плану, яких у чернетці нема,
 * щоб порядок плану не зламався.
 */
export function addToDraft(items: PlanItem[], candidateId: string, candidates: PlanCandidate[]): PlanItem[] {
  if (items.some((item) => item.id === candidateId)) return items;
  const candidate = candidates.find((entry) => entry.id === candidateId);
  if (!candidate) return items;
  const present = new Set(items.map((item) => item.id));
  const toAdd = candidate.kind === 'PLAN' && candidate.group !== undefined
    ? candidates
        .filter((entry) => entry.kind === 'PLAN'
          && entry.group === candidate.group
          && (entry.order ?? 0) <= (candidate.order ?? 0)
          && !present.has(entry.id))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    : [candidate];
  return [...items, ...toAdd.map(toPlanItem)];
}

/**
 * Що ще можна додати в чернетку: кандидати, яких у ній нема.
 * З кроків одного плану тільки найраніший, бо пізніший без нього все одно потягне його за собою.
 */
export function addableCandidates(items: PlanItem[], candidates: PlanCandidate[]): PlanCandidate[] {
  const present = new Set(items.map((item) => item.id));
  const firstPlanStep = new Map<string, PlanCandidate>();
  const result: PlanCandidate[] = [];
  for (const candidate of candidates) {
    if (present.has(candidate.id)) continue;
    if (candidate.kind === 'PLAN' && candidate.group !== undefined) {
      const known = firstPlanStep.get(candidate.group);
      if (!known || (candidate.order ?? 0) < (known.order ?? 0)) firstPlanStep.set(candidate.group, candidate);
      continue;
    }
    result.push(candidate);
  }
  return [...firstPlanStep.values(), ...result];
}

/** Перепланування після старту: зроблене лишається на початку плану, щоб прогрес дня не губився. */
export function keepDone(previous: PlanItemWithStatus[], fresh: PlanItem[]): PlanItem[] {
  const kept: PlanItem[] = previous
    .filter((item) => item.done)
    .map(({ done: _done, autoDone: _autoDone, ...item }) => item);
  const keptIds = new Set(kept.map((item) => item.id));
  return [...kept, ...fresh.filter((item) => !keptIds.has(item.id))];
}
