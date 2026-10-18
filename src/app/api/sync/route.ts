import { revalidatePath } from 'next/cache';
import { syncAllIfStale } from '@/lib/sync';

/**
 * Auto-sync triggered from Today. Deliberately a route handler, not a server action: Next.js runs a page's
 * server actions one at a time, so a slow sync would queue every button (Log time, Plan my day, checkboxes).
 */
export async function POST(): Promise<Response> {
  const synced = await syncAllIfStale();
  if (synced > 0) revalidatePath('/', 'layout');
  return Response.json({ synced });
}
