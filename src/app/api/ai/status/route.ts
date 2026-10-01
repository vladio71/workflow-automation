import { getJob } from '@/lib/ai-status';

/**
 * Статус поточного запиту до Gemini: GET /api/ai/status?job=<id>.
 * Кнопки "Plan my day", "Check the day" і "Check with Gemini" питають його раз на секунду, поки чекають відповіді.
 */
export const dynamic = 'force-dynamic';

export function GET(request: Request): Response {
  const id = new URL(request.url).searchParams.get('job') ?? '';
  const job = getJob(id);
  if (!job) return Response.json({ state: 'unknown' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  return Response.json({ ...job, now: Date.now() }, { headers: { 'Cache-Control': 'no-store' } });
}
