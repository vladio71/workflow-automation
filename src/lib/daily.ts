import 'server-only';
import { db } from './db';
import { dayKey, getTodayLog } from './queries';

/**
 * Daily на Today: список пунктів, який правиш сам (як to-do в Notion).
 * Пункти одні на всі дні, галочки окремі на кожен день.
 * Три старі пункти (cards, recall, out loud) мають auto: їхня галочка живе в DailyLog,
 * бо її ставить сама апка (черга карток порожня, recall збережено) і читає план дня.
 */
export type DailyAutoField = 'cardsDone' | 'recallDone' | 'outLoud';

const AUTO_FIELDS: readonly DailyAutoField[] = ['cardsDone', 'recallDone', 'outLoud'];
const MAX_TITLE = 300;

export interface DailyItemView {
  id: number;
  title: string;
  checked: boolean;
  /** галочку цього пункту апка ставить і сама */
  auto: boolean;
}

function autoField(value: string): DailyAutoField | null {
  return AUTO_FIELDS.find((field) => field === value) ?? null;
}

export async function getDailyItems(now: Date = new Date()): Promise<DailyItemView[]> {
  const day = dayKey(now);
  const [items, checks, log] = await Promise.all([
    db.dailyItem.findMany({ orderBy: [{ position: 'asc' }, { id: 'asc' }] }),
    db.dailyCheck.findMany({ where: { day }, select: { itemId: true } }),
    getTodayLog(now),
  ]);
  const checkedIds = new Set(checks.map((check) => check.itemId));
  return items.map((item) => {
    const field = autoField(item.auto);
    return {
      id: item.id,
      title: item.title,
      checked: field ? log[field] : checkedIds.has(item.id),
      auto: field !== null,
    };
  });
}

export async function setDailyItemChecked(id: number, checked: boolean, now: Date = new Date()): Promise<void> {
  const item = await db.dailyItem.findUnique({ where: { id } });
  if (!item) return;
  const day = dayKey(now);
  const field = autoField(item.auto);
  if (field) {
    await db.dailyLog.upsert({ where: { day }, create: { day, [field]: checked }, update: { [field]: checked } });
    return;
  }
  if (checked) {
    await db.dailyCheck.upsert({ where: { itemId_day: { itemId: id, day } }, create: { itemId: id, day }, update: {} });
  } else {
    await db.dailyCheck.deleteMany({ where: { itemId: id, day } });
  }
}

/** Новий пункт одразу після afterId (null = у кінець). Повертає id, щоб клієнт поставив у нього курсор. */
export async function createDailyItem(afterId: number | null, title: string): Promise<number> {
  const items = await db.dailyItem.findMany({ orderBy: [{ position: 'asc' }, { id: 'asc' }], select: { id: true } });
  const afterIndex = afterId === null ? -1 : items.findIndex((item) => item.id === afterId);
  const insertAt = afterIndex === -1 ? items.length : afterIndex + 1;
  const created = await db.dailyItem.create({ data: { title: title.trim().slice(0, MAX_TITLE), position: insertAt } });
  const order = items.map((item) => item.id);
  order.splice(insertAt, 0, created.id);
  await saveOrder(order);
  return created.id;
}

export async function renameDailyItem(id: number, title: string): Promise<void> {
  await db.dailyItem.updateMany({ where: { id }, data: { title: title.trim().slice(0, MAX_TITLE) } });
}

export async function deleteDailyItem(id: number): Promise<void> {
  await db.dailyItem.deleteMany({ where: { id } });
}

/** Новий порядок цілком: id, яких у списку вже нема, пропускаємо, а не згадані лишаються в кінці. */
export async function reorderDailyItems(ids: number[]): Promise<void> {
  const items = await db.dailyItem.findMany({ orderBy: [{ position: 'asc' }, { id: 'asc' }], select: { id: true } });
  const known = new Set(items.map((item) => item.id));
  const wanted = ids.filter((id, index) => known.has(id) && ids.indexOf(id) === index);
  const mentioned = new Set(wanted);
  await saveOrder([...wanted, ...items.map((item) => item.id).filter((id) => !mentioned.has(id))]);
}

async function saveOrder(ids: number[]): Promise<void> {
  await db.$transaction(ids.map((id, position) => db.dailyItem.update({ where: { id }, data: { position } })));
}
