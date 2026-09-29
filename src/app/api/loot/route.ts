import { refillPool } from '@/lib/loot-refill';

/**
 * Наповнення пулу скрині з Today. Route handler, а не server action, як /api/sync:
 * пошук Gemini йде десятки секунд і не має тримати в черзі кнопки на сторінці.
 */
export async function POST(): Promise<Response> {
  const result = await refillPool({ force: false });
  return Response.json(result);
}
