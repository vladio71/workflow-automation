import { revalidatePath } from 'next/cache';
import type { PlanItem } from '@/lib/planner';

/** After any change every page is rebuilt: the app is small, this is simpler and avoids cache bugs. */
export function refresh(): void {
  revalidatePath('/', 'layout');
}

/** Plan items go into a JSON column; copy them into plain objects first. */
export function toJson(items: PlanItem[]): object[] {
  return items.map((item) => ({ ...item }));
}
