import 'server-only';
import type { CellProgress, DrillAttempt, ParkingItem, SpokenAnswer } from '@/generated/prisma/client';
import { db } from '@/lib/db';
import { dayKey } from '@/lib/queries';
import { cellOrder, drillOrder, getCell, getDrill, type Cell, type Drill } from '@/lib/content';

/**
 * Прогрес по матеріалу: клітинки карти, дрили, відповіді вголос, парковка.
 * Контент незмінний (src/content), тут тільки те, що зробив ти.
 */

// ------------------------------------------------------------------ клітинки

export interface CellStatus {
  cellId: string;
  derived: boolean;
  checked: boolean;
  summarized: boolean;
  /** скільки з трьох кроків закрито */
  steps: number;
  done: boolean;
}

export function cellStatus(cellId: string, progress: CellProgress | null): CellStatus {
  const derived = progress?.derivedAt !== null && progress?.derivedAt !== undefined;
  const checked = progress?.checkedAt !== null && progress?.checkedAt !== undefined;
  const summarized = progress?.summarizedAt !== null && progress?.summarizedAt !== undefined;
  const steps = [derived, checked, summarized].filter(Boolean).length;
  return { cellId, derived, checked, summarized, steps, done: steps === 3 };
}

export async function getCellProgress(cellId: string): Promise<CellProgress | null> {
  return db.cellProgress.findUnique({ where: { cellId } });
}

export async function getAllCellStatuses(): Promise<Map<string, CellStatus>> {
  const rows = await db.cellProgress.findMany();
  const byId = new Map(rows.map((row) => [row.cellId, row]));
  return new Map(cellOrder().map((cell) => [cell.id, cellStatus(cell.id, byId.get(cell.id) ?? null)]));
}

/** Клітинки по порядку проходження (A1, B1, C1, D1, A2, …), обмежені групами, якщо задано. */
export async function nextCell(groups: string[] | null = null): Promise<Cell | null> {
  const statuses = await getAllCellStatuses();
  for (const cell of cellOrder()) {
    if (groups !== null && !groups.includes(cell.group)) continue;
    if (!statuses.get(cell.id)?.done) return cell;
  }
  return null;
}

export async function saveCellDerived(cellId: string, text: string, now: Date): Promise<void> {
  if (!getCell(cellId)) throw new Error(`unknown cell ${cellId}`);
  const trimmed = text.trim();
  await db.cellProgress.upsert({
    where: { cellId },
    create: { cellId, derived: trimmed, derivedAt: trimmed ? now : null },
    update: { derived: trimmed, ...(trimmed ? { derivedAt: now } : {}) },
  });
}

export async function markCellChecked(cellId: string, now: Date): Promise<void> {
  if (!getCell(cellId)) throw new Error(`unknown cell ${cellId}`);
  await db.cellProgress.upsert({
    where: { cellId },
    create: { cellId, checkedAt: now },
    update: { checkedAt: now },
  });
}

export async function saveCellSummary(cellId: string, text: string, now: Date): Promise<void> {
  if (!getCell(cellId)) throw new Error(`unknown cell ${cellId}`);
  const trimmed = text.trim();
  await db.cellProgress.upsert({
    where: { cellId },
    create: { cellId, summary: trimmed, summarizedAt: trimmed ? now : null },
    update: { summary: trimmed, ...(trimmed ? { summarizedAt: now } : {}) },
  });
}

// ------------------------------------------------------------------ дрили

export async function getDrillAttempts(drillId: string): Promise<DrillAttempt[]> {
  return db.drillAttempt.findMany({ where: { drillId }, orderBy: { createdAt: 'desc' } });
}

/** Остання спроба кожного дрилу: для списку модуля і для вибору наступного дрилу. */
export async function getLatestAttempts(): Promise<Map<string, DrillAttempt>> {
  const rows = await db.drillAttempt.findMany({ orderBy: { createdAt: 'desc' } });
  const latest = new Map<string, DrillAttempt>();
  for (const row of rows) if (!latest.has(row.drillId)) latest.set(row.drillId, row);
  return latest;
}

/** Наступний дрил без жодної спроби, по порядку модулів. */
export async function nextDrill(moduleIds: string[] | null = null): Promise<Drill | null> {
  const latest = await getLatestAttempts();
  for (const drill of drillOrder()) {
    const moduleId = drill.id.slice(0, drill.id.lastIndexOf('-'));
    if (moduleIds !== null && !moduleIds.includes(moduleId)) continue;
    if (!latest.has(drill.id)) return drill;
  }
  return null;
}

export async function saveDrillAttempt(drillId: string, answer: string): Promise<DrillAttempt> {
  if (!getDrill(drillId)) throw new Error(`unknown drill ${drillId}`);
  return db.drillAttempt.create({ data: { drillId, answer: answer.trim() } });
}

export async function setDrillChecked(attemptId: number, checked: number[]): Promise<void> {
  const attempt = await db.drillAttempt.findUnique({ where: { id: attemptId } });
  if (!attempt) return;
  const found = getDrill(attempt.drillId);
  const max = found ? found.drill.check.length : 0;
  const clean = [...new Set(checked.filter((index) => Number.isInteger(index) && index >= 0 && index < max))].sort((a, b) => a - b);
  await db.drillAttempt.update({ where: { id: attemptId }, data: { checked: clean } });
}

// ------------------------------------------------------------------ вголос

export interface SpokenSubject {
  /** "cell:A3" або "drill:mon-2" */
  key: string;
  title: string;
  href: string;
}

export function spokenSubject(key: string): SpokenSubject | null {
  const [kind, id] = key.split(':');
  if (kind === 'cell' && id) {
    const cell = getCell(id);
    return cell ? { key, title: `${cell.id} · ${cell.scale[0]}`, href: `/map/${cell.id}` } : null;
  }
  if (kind === 'drill' && id) {
    const found = getDrill(id);
    return found ? { key, title: `${found.module.short} · ${found.drill.q}`, href: `/minimum/${found.module.id}#${id}` } : null;
  }
  return null;
}

export async function getSpokenToday(now: Date): Promise<SpokenAnswer[]> {
  return db.spokenAnswer.findMany({ where: { day: dayKey(now) }, orderBy: { createdAt: 'asc' } });
}

/**
 * Що розповідати вголос сьогодні: найдавніше не розказана з пройдених клітинок і дрилів зі спробою.
 * Поки нічого не пройдено, розповідати нема чого.
 */
export async function nextSpokenSubject(now: Date): Promise<SpokenSubject | null> {
  const [statuses, latest, spoken] = await Promise.all([
    getAllCellStatuses(),
    getLatestAttempts(),
    db.spokenAnswer.findMany({ orderBy: { createdAt: 'desc' } }),
  ]);
  const lastSpokenAt = new Map<string, Date>();
  for (const row of spoken) if (!lastSpokenAt.has(row.subject)) lastSpokenAt.set(row.subject, row.createdAt);
  const today = dayKey(now).getTime();
  const candidates: { key: string; at: number }[] = [];
  for (const cell of cellOrder()) {
    const status = statuses.get(cell.id);
    if (!status || status.steps < 2) continue; // вивів і звірив: уже є що розповідати
    candidates.push({ key: `cell:${cell.id}`, at: lastSpokenAt.get(`cell:${cell.id}`)?.getTime() ?? 0 });
  }
  for (const drill of drillOrder()) {
    if (!latest.has(drill.id)) continue;
    candidates.push({ key: `drill:${drill.id}`, at: lastSpokenAt.get(`drill:${drill.id}`)?.getTime() ?? 0 });
  }
  const fresh = candidates.filter((candidate) => candidate.at < today);
  fresh.sort((a, b) => a.at - b.at);
  const pick = fresh[0] ?? null;
  return pick ? spokenSubject(pick.key) : null;
}

export async function addSpokenAnswer(subject: string, stuck: string, now: Date): Promise<void> {
  if (!spokenSubject(subject)) throw new Error(`unknown subject ${subject}`);
  await db.spokenAnswer.create({ data: { day: dayKey(now), subject, stuck: stuck.trim() } });
}

// ------------------------------------------------------------------ парковка

export async function getParking(): Promise<{ open: ParkingItem[]; picked: ParkingItem | null; done: ParkingItem[] }> {
  const items = await db.parkingItem.findMany({ orderBy: { createdAt: 'desc' } });
  return {
    open: items.filter((item) => item.doneAt === null && item.pickedAt === null),
    picked: items.find((item) => item.doneAt === null && item.pickedAt !== null) ?? null,
    done: items.filter((item) => item.doneAt !== null).slice(0, 20),
  };
}
