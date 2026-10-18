import 'server-only';
import { timingSafeEqual } from 'node:crypto';

/**
 * Endpoints for scripts on the desktop (/api/state, /api/handoff, /api/plan/generate): the app has no
 * auth but is public on the internet, so these endpoints only accept requests with a token.
 * Token: AUTOMATION_TOKEN in env (Vercel and .env), the same one in desk.json and the blocker.
 * Request header: x-automation-token.
 */

export const AUTOMATION_HEADER = 'x-automation-token';

/** null = allowed; otherwise a ready error response. */
export function rejectUnlessAutomation(request: Request): Response | null {
  const expected = process.env.AUTOMATION_TOKEN ?? '';
  if (!expected) return Response.json({ error: 'AUTOMATION_TOKEN не заданий в env' }, { status: 503 });
  const given = request.headers.get(AUTOMATION_HEADER) ?? '';
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return Response.json({ error: 'bad token' }, { status: 401 });
  }
  return null;
}
