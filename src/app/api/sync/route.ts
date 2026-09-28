import { revalidatePath } from 'next/cache';
import { syncAllIfStale } from '@/lib/sync';

/**
 * Автосинк з Today. Навмисно route handler, а не server action: server actions на сторінці
 * Next.js виконує по одному, тож повільний sync тримав би в черзі всі кнопки (Log time, Plan my day, галочки).
 */
export async function POST(): Promise<Response> {
  const synced = await syncAllIfStale();
  if (synced > 0) revalidatePath('/', 'layout');
  return Response.json({ synced });
}
