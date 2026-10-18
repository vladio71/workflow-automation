/**
 * Ordering and editing of the day plan. Pure logic, no DB: kept in its own file so it can be tested
 * on its own and imported from the client (the `import type` from planner is erased at compile time,
 * so `server-only` does not leak in here).
 *
 * Three groups of rules:
 *   mandatory items   pickMandatory, enforceMandatory: what the LLM may not drop or reorder
 *   momentum order    findBossId, momentumOrder: warm-up first, the biggest item while the head is fresh
 *   draft editing     add, remove, move, set minutes, keep what is already done
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
 * Which mandatory study items (plan steps, redos) go into the plan, in candidate order.
 * - A plan step that does not fit cuts the rest of that plan; other plans may still fit.
 * - The first study item is taken even when it is longer than the budget, otherwise the plan would never advance.
 * - `keep`: items the LLM already placed; they stay unless their plan was cut earlier.
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
 * A plan from the LLM -> a plan with the mandatory items in place.
 * Study-plan steps cannot be dropped or reordered by the model: they take the slots where the model put
 * mandatory items, in their own order, and the ones it skipped are appended while they fit the budget.
 * Recurring tasks (TASK) must always be present, but where is up to the model; unplaced ones go to the end.
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
    // A mandatory slot is filled by the next study item in plan order.
    const inOrder = required[next];
    if (inOrder) result.push(inOrder);
    next += 1;
  }
  // Mandatory items the model did not place go right after the last mandatory one (or to the end).
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

/** The minimal shape the ordering rules need; fits both PlanItem and PlanItemWithStatus. */
export interface OrderableItem {
  id: string;
  kind: string;
  minutes: number;
  mandatory?: boolean;
}

/** The boss of the day is the longest item, the first one on a tie. Used on the server for ordering and on the map for the crown. */
export function findBossId(items: readonly OrderableItem[]): string | null {
  if (items.length < 2) return null;
  let boss: OrderableItem | null = null;
  for (const item of items) {
    if (!boss || item.minutes > boss.minutes) boss = item;
  }
  return boss ? boss.id : null;
}

/** Warm-up is the cards; without cards today, the shortest optional item of up to 10 minutes. */
const WARM_UP_MAX_MINUTES = 10;

/**
 * Order for the start of the day: warm-up, then the boss (the frog, while the head is fresh), then the rest.
 * Study-plan steps keep their relative order: a boss step never overtakes a mandatory step that stood before it.
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
    // The last mandatory item before the boss stays before it.
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

// ─── Draft editing, before "Start the day" ──────────────────────────────────

function isLaterStepOfSamePlan(item: PlanItem, removed: PlanItem): boolean {
  return item.kind === 'PLAN'
    && removed.kind === 'PLAN'
    && item.group !== undefined
    && item.group === removed.group
    && (item.order ?? 0) > (removed.order ?? 0);
}

/** Remove an item. Removing a plan step also removes the later steps of that plan: step 5 cannot be done without step 4. */
export function removeFromDraft(items: PlanItem[], itemId: string): PlanItem[] {
  const removed = items.find((item) => item.id === itemId);
  if (!removed) return items;
  return items.filter((item) => item.id !== itemId && !isLaterStepOfSamePlan(item, removed));
}

/** Two steps of the same plan never swap: the plan defines their order. */
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

/** Step sequence of each study plan: "plan:3" -> step ids in list order. */
function planStepOrder(items: PlanItem[]): Map<string, string[]> {
  const order = new Map<string, string[]>();
  for (const item of items) {
    if (item.kind !== 'PLAN' || item.group === undefined) continue;
    const steps = order.get(item.group) ?? [];
    steps.push(item.id);
    order.set(item.group, steps);
  }
  return order;
}

/**
 * Drag an item to position `toIndex` (an index in the resulting list).
 * null = not allowed: steps of one plan would swap places.
 */
export function moveToIndex(items: PlanItem[], itemId: string, toIndex: number): PlanItem[] | null {
  const from = items.findIndex((item) => item.id === itemId);
  const moved = items[from];
  if (!moved) return items;
  const target = Math.min(items.length - 1, Math.max(0, Math.round(toIndex)));
  if (target === from) return items;
  const result = [...items];
  result.splice(from, 1);
  result.splice(target, 0, moved);

  const before = planStepOrder(items);
  const after = planStepOrder(result);
  for (const [group, steps] of before) {
    if ((after.get(group) ?? []).join('|') !== steps.join('|')) return null;
  }
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
 * Append a candidate to the draft. A plan step brings along the earlier steps of its plan that are
 * not in the draft yet, so the plan order stays intact.
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
 * What can still be added to the draft: candidates not in it yet.
 * Of one plan's steps only the earliest, since a later one would bring it along anyway.
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

/** Re-planning after the start: done items stay at the top so the day's progress is not lost. */
export function keepDone(previous: PlanItemWithStatus[], fresh: PlanItem[]): PlanItem[] {
  const kept: PlanItem[] = previous
    .filter((item) => item.done)
    .map(({ done: _done, autoDone: _autoDone, progress: _progress, ...item }) => item);
  const keptIds = new Set(kept.map((item) => item.id));
  return [...kept, ...fresh.filter((item) => !keptIds.has(item.id))];
}
