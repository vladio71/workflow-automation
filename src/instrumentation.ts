/**
 * Часовий пояс сервера. "Сьогодні" в апці (картки, плани, стрік, Daily) рахується за часом сервера,
 * а на Vercel це UTC: без цього день перемикався б о 03:00 за Києвом, а не опівночі.
 * Локально лишається час комп'ютера. Інший пояс: APP_TZ в .env (на Vercel змінну TZ задати не можна).
 */
const VERCEL_DEFAULT_TZ = 'Europe/Kyiv';

export function register(): void {
  const zone = process.env.APP_TZ || (process.env.VERCEL ? VERCEL_DEFAULT_TZ : '');
  if (zone) process.env.TZ = zone;
}
