'use server';

import { createDailyItem, deleteDailyItem, renameDailyItem, reorderDailyItems, setDailyItemChecked } from '@/lib/daily';
import { refresh } from './shared';

/** A Daily checkbox. refresh(): the streak and the day-plan nodes depend on it. */
export async function checkDailyItem(id: number, checked: boolean): Promise<void> {
  await setDailyItemChecked(id, checked);
  refresh();
}

// Edits of the Daily list run without refresh(): the client list already shows the change,
// and a re-rendered page would throw the cursor out of the item being typed.

/** A new item after `afterId` (null = at the end). Returns its id. */
export async function addDailyItem(afterId: number | null, title: string): Promise<number> {
  return createDailyItem(afterId, title);
}

export async function saveDailyItemTitle(id: number, title: string): Promise<void> {
  await renameDailyItem(id, title);
}

export async function removeDailyItem(id: number): Promise<void> {
  await deleteDailyItem(id);
}

export async function saveDailyOrder(ids: number[]): Promise<void> {
  await reorderDailyItems(ids);
}
