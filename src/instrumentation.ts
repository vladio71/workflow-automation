/**
 * Server time zone. "Today" in the app (cards, plans, streak, Daily) is computed in server time, which is UTC
 * on Vercel: without this the day would roll over at 03:00 Kyiv time instead of midnight.
 * Locally the machine's zone is kept. Another zone: APP_TZ in .env (Vercel does not allow setting TZ).
 */
const VERCEL_DEFAULT_TZ = 'Europe/Kyiv';

export function register(): void {
  const zone = process.env.APP_TZ || (process.env.VERCEL ? VERCEL_DEFAULT_TZ : '');
  if (zone) process.env.TZ = zone;
}
