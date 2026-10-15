import 'server-only';
import { timingSafeEqual } from 'node:crypto';

/**
 * Ендпоінти для скриптів на комп'ютері (/api/state, /api/handoff, /api/plan/generate): в апці нема
 * авторизації, а апка в інтернеті, тому ці ендпоінти пускають тільки з токеном.
 * Токен: AUTOMATION_TOKEN в env (Vercel і .env), той самий у desk.json і блокері.
 * Заголовок запиту: x-automation-token.
 */

export const AUTOMATION_HEADER = 'x-automation-token';

/** null = пускаємо; інакше готова відповідь з помилкою. */
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
