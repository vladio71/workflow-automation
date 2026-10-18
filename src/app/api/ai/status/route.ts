import { getJob } from '@/lib/ai-status';

/**
 * Status of a running Gemini request: GET /api/ai/status?job=<id>.
 * The "Plan my day", "Check the day" and "Check with Gemini" buttons poll it once a second while waiting.
 */
export const dynamic = 'force-dynamic';

export function GET(request: Request): Response {
  const id = new URL(request.url).searchParams.get('job') ?? '';
  const job = getJob(id);
  if (!job) return Response.json({ state: 'unknown' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  return Response.json({ ...job, now: Date.now() }, { headers: { 'Cache-Control': 'no-store' } });
}
